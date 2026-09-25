#!/usr/bin/env node
/**
 * Janet branding overlay — applied at container start, before the server reads
 * its index.html into memory.
 *
 * Why this exists: the fork deploys upstream LibreChat unmodified so an
 * upstream sync can never conflict. LibreChat's visual identity is baked into
 * its build (client/public/assets, client/index.html, the PWA manifest), and
 * the deployment theme env vars are Vite build-time values a Render Docker
 * build cannot pass without editing the Dockerfile. So instead of editing
 * vendor files, this script rewrites the *built output* in place: it copies the
 * Janet icons over the stock ones and injects brand.css plus the brand fonts
 * into dist/index.html. Nothing under src/ is touched.
 *
 * Runs from Render's Docker Command as `node janet-branding/apply.mjs`, then
 * `npm run backend`. It always exits 0: a branding failure must never keep the
 * chat from starting.
 */
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = join(HERE, 'assets');

/** Where the built client lives. Render's image has the repo at /app. */
function resolveDist() {
  const override = process.env.JANET_BRANDING_DIST;
  if (override) {
    return resolve(override);
  }
  return resolve(HERE, '..', 'client', 'dist');
}

/** Source in janet-branding/assets → destination under dist/. */
const ASSETS = {
  'logo.svg': 'assets/logo.svg',
  'favicon-16x16.png': 'assets/favicon-16x16.png',
  'favicon-32x32.png': 'assets/favicon-32x32.png',
  'apple-touch-icon-180x180.png': 'assets/apple-touch-icon-180x180.png',
  'icon-192x192.png': 'assets/icon-192x192.png',
  'icon-512x512.png': 'assets/icon-512x512.png',
  'maskable-icon.png': 'assets/maskable-icon.png',
  'favicon.ico': 'favicon.ico',
};

const FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap">',
].join('\n    ');

const MARKER = '<!-- janet-branding -->';

const HEAD_INJECTION = `${MARKER}
    ${FONTS}
    <link rel="stylesheet" href="janet-brand.css">`;

function copyAssets(dist) {
  let copied = 0;
  for (const [source, destination] of Object.entries(ASSETS)) {
    const from = join(ASSET_DIR, source);
    const to = join(dist, destination);
    if (!existsSync(from)) {
      console.warn(`[janet-branding] missing asset ${from}, skipping`);
      continue;
    }
    copyFileSync(from, to);
    copied += 1;
  }
  const css = join(HERE, 'brand.css');
  if (existsSync(css)) {
    copyFileSync(css, join(dist, 'janet-brand.css'));
  } else {
    console.warn('[janet-branding] brand.css missing');
  }
  return copied;
}

function patchHtml(dist) {
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) {
    console.warn('[janet-branding] no index.html, skipping');
    return;
  }
  let html = readFileSync(indexPath, 'utf8');
  const before = html;

  html = html.replace(/<title>[^<]*<\/title>/, '<title>Janet</title>');
  html = html.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/,
    '$1A quiet front door to Janet.$2',
  );
  html = html.replace(/(<meta name="theme-color" content=")[^"]*(")/, '$1#004225$2');

  if (!html.includes(MARKER)) {
    html = html.replace('</head>', `  ${HEAD_INJECTION}\n  </head>`);
  }

  if (html !== before) {
    writeFileSync(indexPath, html);
    writeFileSync(`${indexPath}.br`, brotliCompressSync(Buffer.from(html)));
    writeFileSync(`${indexPath}.gz`, gzipSync(Buffer.from(html)));
  }
}

function patchManifest(dist) {
  const manifestPath = join(dist, 'manifest.webmanifest');
  if (!existsSync(manifestPath)) {
    return;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.name = 'Janet';
    manifest.short_name = 'Janet';
    manifest.description = 'A quiet front door to Janet.';
    manifest.theme_color = '#004225';
    manifest.background_color = '#131714';
    writeFileSync(manifestPath, JSON.stringify(manifest));
  } catch (error) {
    console.warn(`[janet-branding] could not patch manifest: ${error.message}`);
  }
}

function main() {
  const dist = resolveDist();
  if (!existsSync(dist)) {
    console.warn(`[janet-branding] dist not found at ${dist}; leaving the app stock`);
    return;
  }
  const copied = copyAssets(dist);
  patchHtml(dist);
  patchManifest(dist);
  console.log(`[janet-branding] applied to ${dist} (${copied} assets)`);
}

/**
 * Render's Docker Command is run through `sh -c`, and nesting another
 * `/bin/sh -c "…"` inside it gets mangled, so the command is a single token:
 * `node janet-branding/apply.mjs`. With JANET_BRANDING_SERVE set, this process
 * becomes the server's parent and hands the backend its own PID-1 lifecycle.
 */
function serve() {
  const child = spawn(process.execPath, ['api/server/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
  child.on('error', (error) => {
    console.error(`[janet-branding] could not start the backend: ${error.message}`);
    process.exit(1);
  });
}

try {
  main();
} catch (error) {
  // Never take the chat down for a cosmetic failure.
  console.error(`[janet-branding] failed: ${error?.stack ?? error}`);
}

if (process.env.JANET_BRANDING_SERVE) {
  serve();
} else {
  process.exit(0);
}
