# LumaPause Website

Public companion site for the LumaPause Electron application.

The hosted experience is an interactive simulator. It never represents simulated values as SmartSpectra measurements. Genuine camera-derived sensing remains in the desktop application because SmartSpectra's Node runtime is integrated through Electron.

## Verify

```bash
node --test tests/site.test.mjs
```

Open `dist/index.html` through an HTTP server for local browser testing.
