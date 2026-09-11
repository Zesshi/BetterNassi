# BetterNassi

A simple web editor for creating Nassi-Shneiderman diagrams.

## Features

- Drag process, input/output, decision, and loop blocks into the diagram.
- Reorder blocks directly on the diagram canvas.
- Edit selected block text and details in the inspector.
- Nest blocks inside decisions and loops.
- Export the finished diagram as a PNG image.

No login, authentication, or server-side storage is required.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
```

## GitHub Pages

The deployment workflow is `.github/workflows/deploy-pages.yml`.

1. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
2. Commit and push the workflow and the accompanying Pages build files to `main`.
3. Open **Actions > Deploy GitHub Pages** and wait for both jobs to complete. To deploy manually, select **Run workflow** on `main`.
4. Open <https://zesshi.github.io/BetterNassi/>.

The workflow runs `npm ci` and `npm run build:pages`, then publishes `dist-pages`.
Do not publish the repository root or the server build in `dist`.
The static build uses the same editor component as the local app; no server or secrets are needed.

The Pages build files are `vite.pages.config.ts`, `github-pages/index.html`, and
`github-pages/main.tsx`, plus the `build:pages` script in `package.json` and
the asset-path support in `app/NassiEditor.tsx`. Push these together with the workflow.
The old starter workflow that only prints "Hello, world!" is not needed for deployment.

To check the static build locally:

```bash
npm run build:pages
npx vite preview --config vite.pages.config.ts
```

The preview URL includes `/BetterNassi/`. If the repository is renamed or a custom
domain is added, update `base` in `vite.pages.config.ts` to match the new URL.
