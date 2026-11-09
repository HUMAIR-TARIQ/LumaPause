# Pre-submission checklist

Run every automated gate from a clean checkout on the target Windows x64 machine. Do not check a
box from memory; attach the command output or artifact path.

## 1. Automated gates

- [x] `npm run typecheck` — strict TypeScript passes.
- [x] `npm run lint` — ESLint passes with `--max-warnings 0`.
- [x] `npm run format:check` — Prettier reports all checked files conform.
- [x] `npm test` — 113 unit/integration tests pass.
- [x] `npm run build` — main, preload, and renderer bundles build.
- [x] `npm run test:e2e` — 6 Playwright Electron journeys pass on the current build.
- [x] `npm run scan:secrets` — project files, `out/`/`release-final/`, and Git history are clean.
- [x] `npm run verify` — full sequence rerun on the final tree (2026-11-09): typecheck, lint,
  formatting, 113/113 tests, production build, and credential scan all passed.

## 2. Credential and repository hygiene

- [x] `.env.example` contains only `SMARTSPECTRA_API_KEY=` with no value.
- [x] `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, recordings, and logs are ignored.
- [x] The API key is read only in the main process and never crosses the preload bridge.
- [x] Error messages and logs are redacted; the key is never logged.
- [x] `git status` contains no `.env`, key file, recording, or build artifact that should be
  ignored; `release/`, `release-build/`, `out/`, and the legacy backup are ignored.
- [ ] Full source is committed (only when the repository owner authorizes the commit).
- [ ] The public repository contains no key in any branch or tag (`npm run scan:secrets` after the
  final commit).
- [ ] If any key was ever exposed, it has been revoked in the Presage portal and replaced.

## 3. Security review

- [x] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- [x] Production CSP allows only self-hosted scripts and connections; no inline script; workers are
  `blob:`/self; media is `blob:`/`mediastream:`.
- [x] Camera permission is video-only, self-only, and denied for audio and all other permissions.
- [x] Navigation, redirects, pop-ups, and webviews are blocked.
- [x] IPC validates the sender frame and every payload with zod.
- [x] Frame packets validate format, dimensions, stride, length, timestamp, and a 64 MiB ceiling.
- [x] The frame port is private to the preload bridge and replaced safely on reattach.
- [x] DevTools are disabled in packaged builds; the menu is removed.
- [x] Single-instance lock, shutdown teardown, and IPC disposal are wired.
- [x] E2E checks the sentinel key is absent from HTML, storage, and the bridge.

## 4. Privacy and responsible language

- [x] The camera starts only after consent, never on launch.
- [x] No recording, upload, localStorage, analytics, or crash reporting.
- [x] Stop clears samples; finish clears the session; a window close stops first.
- [x] `PRIVACY.md` matches the implementation and states the Presage authentication network path.
- [x] No diagnosis, treatment, prevention, health score, stress score, readiness score, or
  emotional-truth label.
- [x] No identity, demographic, personality, intent, deception, or mental-health inference.
- [x] The UI never labels a reading good, bad, calm, stressed, or ready.
- [x] The simulator banner is permanent and demo mode cannot be entered during live measurement.
- [ ] A human has read every user-facing string and the submission article for medical overclaim.

## 5. Hardware verification

- [ ] `docs/HARDWARE_TEST_REPORT.md` is filled in by a human with a valid key, camera, and network.
- [ ] Every manual matrix row is marked Pass/Fail with observed evidence.
- [ ] Camera indicator turns off on stop, finish, close, and quit.
- [ ] Native runtime loads in the packaged build.
- [ ] The report no longer says "NOT EXECUTED" before any live claim is made.

## 6. Packaging

- [x] Windows icon sources exist (`build/icon.png`, multi-frame `build/icon.ico`).
- [x] electron-builder config targets NSIS and portable x64, with the native runtime copied to
  `resources/smartspectra/`.
- [x] electron-builder NSIS + portable x64 build succeeded on Windows. The default `release/`
  output was held by a stale local lock, so the final artifacts were written to `release-final/`;
  the configured output path in `package.json` is still `release/`.
- [ ] Installer launches, creates a shortcut, and runs without a development server.
- [ ] Portable executable launches from a clean folder.
- [ ] Packaged app loads `smartspectra_capi.dll` from resources and completes a live session.
- [ ] Installed app can be uninstalled without leaving camera access or background processes.
- [x] Release artifacts contain no `.env`, key, or test key. The asar was inspected directly and
  the credential scan covers `release-final/`; oversized binaries are skipped by the scanner.
- [x] Release artifact paths and SHA-256 checksums are recorded below and in the final report.

| Artifact | Size | SHA-256 |
|---|---|---|
| `release-final/LumaPause-1.0.0-x64-setup.exe` | 249 MB | `bbb30e9131c56ec69e85f606fb5c013535d807eea3eac66a5e132088c7031cb2` |
| `release-final/LumaPause-1.0.0-x64-portable.exe` | 249 MB | `a43c5a8f8bd08f20b9938edf09cf11abeb2eff5516bf20124904fe4a8096adc0` |
| `release-final/LumaPause-1.0.0-x64-setup.exe.blockmap` | 227 KB | — |

The build is unsigned; Windows SmartScreen may warn on first launch.

## 7. Challenge readiness

- [x] Required challenge tag confirmed as `presagechallenge`.
- [x] Submission is positioned for Best Overall, Most Creative or Delightful Use, and Best
  Thoughtful Real-World Use; organizer acceptance remains their decision.
- [x] Interactive companion website is published at
  https://lumapause-human-sensing-2026.clearpause1.chatgpt.site and permanently labels its signals
  as simulated.
- [ ] Public repository URL is added and accessible.
- [ ] Demo video is recorded, uploaded, and linked; no API key or personal data is visible.
- [ ] Screenshots are final; simulator captures are labeled as simulator captures.
- [ ] `CHALLENGE_SUBMISSION.md` placeholders are replaced.
- [ ] AI-assistance disclosure matches the current DEV rules.
- [ ] The article and project are **not** published or submitted without explicit owner approval.

## 8. Final sign-off

| Item | Owner | Date | Evidence |
|---|---|---|---|
| Automated gates | | | |
| Security review | | | |
| Privacy review | | | |
| Hardware test | | | |
| Packaging | | | |
| Article approval | | | |
| Submission | | | |

**Do not submit while any required box is unchecked. Do not describe live SmartSpectra support as
verified until Section 5 is complete.**
