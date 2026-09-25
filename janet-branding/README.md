# Janet branding overlay

Forest & Brass branding for the `janet-chat.joel.center` LibreChat instance,
applied without editing a single upstream file.

## Why it works this way

The fork deploys upstream LibreChat unmodified so an upstream sync can never
conflict. LibreChat's visual identity is baked into its build — the logo and
favicons under `client/public/assets/`, the title and meta in `client/index.html`,
the PWA manifest — and its deployment theme variables (`REACT_APP_THEME_*`) are
Vite build-time values that a Render **Docker** build cannot supply without
declaring `ARG`s in the Dockerfile.

So the branding rides in as **new files only**, and a container-start script
rewrites the _built output_ in place:

- `apply.mjs` — run from the Render Docker Command before the server starts.
  Copies the Janet icons over the stock ones in `client/dist`, injects
  `brand.css` and the brand fonts into `client/dist/index.html`, patches
  `manifest.webmanifest`, and refreshes the pre-compressed `index.html.br/.gz`.
  It always exits 0, so a cosmetic failure never keeps the chat from starting.
- `brand.css` — remaps LibreChat's CSS custom properties onto the Forest &
  Brass tokens, light and dark. Source of truth is the `preferred-design-system`
  skill's `tokens/colors.css`.
- `assets/` — the Janet mark, favicons and app icons.

Nothing under `src/`, `client/src/`, `api/` or the vendor `Dockerfile` is
touched, so `git rebase`/`git merge` against upstream is always clean.

## Render wiring (operator config, not repo)

On the `LibreChat` service (`srv-d7gho8u7r5hc73bad06g`):

- **Docker Command**: `node janet-branding/apply.mjs`
- **Environment**: `JANET_BRANDING_SERVE=true`, `APP_TITLE=Janet`, `CUSTOM_FOOTER=…`
- **Branch**: the branch that carries this directory.

The command is a single token on purpose. Render runs the Docker Command through
`sh -c`, and nesting another `/bin/sh -c "…"` inside it gets mangled into a
lookup for a file whose name is the whole string. With `JANET_BRANDING_SERVE`
set, `apply.mjs` starts `api/server/index.js` itself, forwards SIGTERM/SIGINT to
it, and exits with its code — so there is no shell in the path at all.

## Updating the brand

1. Change files here.
2. Commit on `janet-branding`, fast-forward `deploy` to it.
3. Render redeploys on the push.

## Upgrading upstream LibreChat

Keep `main` a pristine mirror. To move the deployment to a newer upstream
release:

```sh
git fetch origin main
git checkout janet-branding
git rebase --onto origin/main <old-base> janet-branding   # only new files, never conflicts
git checkout deploy && git merge --ff-only janet-branding
git push fork deploy janet-branding
```

Because every path here is additive, the rebase is a no-op resolution every time.
