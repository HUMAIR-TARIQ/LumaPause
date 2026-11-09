# LumaPause Website

Public companion site for the LumaPause Electron application.

The hosted experience is an interactive simulator. It never represents simulated values as SmartSpectra measurements. Genuine camera-derived sensing remains in the desktop application because SmartSpectra's Node runtime is integrated through Electron.

## Verify

```bash
npm run site:test
```

Open `dist/index.html` through an HTTP server for local browser testing.

## Deploying with Vercel

The repository root contains `vercel.json`, which publishes `website/dist` as a static site after running `npm run site:test`. Vercel cannot run the Electron application itself; this deployment is the companion website and browser-side simulator only.

`website/dist/index.html` must be committed. The root `.gitignore` makes an explicit exception for it because other `dist/` directories are build output.
