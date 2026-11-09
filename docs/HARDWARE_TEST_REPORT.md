# Live hardware test report

**Status: DEVELOPMENT LIVE STARTUP PASS; FULL APP MATRIX NOT EXECUTED.** On 2026-11-09, the
key-safe `npm run smoke:smartspectra` test discovered the Windows camera, authenticated, reached
SmartSpectra `Running`, and emitted metrics. After fixing frame-rate negotiation, media-clock
timestamps, and renderer frame throughput, `npm run diagnose:live` also sustained LumaPause's
real renderer-to-main camera path for 45 seconds without SDK error 8. The full room journey,
camera-release matrix, five-minute resource test, and packaged build still require manual testing.

This report is intentionally blunt. Automated simulator and Electron tests are listed separately
because they cannot prove that camera capture, SDK authentication, native loading, and metric
delivery work on real hardware.

## Environment used for the automated build

| Item | Value |
|---|---|
| Date | 2026-11-09 |
| OS | Windows 10/11 x64 development host |
| Node.js | 20+ (project engine) |
| Electron | 33.4.11 |
| SmartSpectra SDK | `@smartspectra/node-sdk` 3.4.0 |
| Native runtime package | `@smartspectra/node-sdk-win32-x64` installed, DLL present |
| SmartSpectra API key | Available locally; value not logged or retained in this report |
| Camera | One camera discovered and exercised by the SDK smoke test |
| Network to Presage | Exercised successfully by the SDK smoke test |

The presence of the native runtime package and a successful production bundle only show that the
build resolves the SDK and its DLLs. They do not show that a session runs.

## What was actually executed

| Check | Result | Notes |
|---|---|---|
| Strict TypeScript check | Passed | `npm run typecheck` |
| ESLint (zero warnings) | Passed | `npm run lint` |
| Unit + integration tests | Passed | 113/113 across 11 files |
| Playwright Electron journeys | Passed | 6/6; simulator, setup, permission denied, partial signal, keyboard, sandbox/CSP |
| Production build | Passed | Main, preload, renderer |
| Credential scan | Passed | Project files, build output, Git history |
| Windows packaging | Passed (build only) | `release-final/LumaPause-1.0.0-x64-setup.exe` and `-portable.exe`, SHA-256 recorded in `docs/PRE_SUBMISSION.md`; unpacked app smoke-launched, but no installer run and no live packaged session |
| **Native SDK camera smoke** | **Passed** | SDK 3.4.0 reached Running and emitted validation events and metrics with all four requested metrics |
| **LumaPause live SmartSpectra startup** | **Passed (45 s development test)** | Real renderer camera frames reached SmartSpectra without SDK error 8; normal framing guidance remained active |
| **Live camera release check** | **Not run** | Covered by code paths and E2E permission tests only |

The Playwright permission-denied test uses a sentinel key and a test-only environment flag
(`LUMAPAUSE_E2E_DENY_CAMERA=1`) to exercise the denial path without contacting Presage. It is not
live verification.

## Manual hardware matrix

Every row below is **not run**. Do not mark any row passed without performing it with a valid key,
a real camera, and the packaged or development build.

| # | Scenario | Expected evidence | Result |
|---|---|---|---|
| 1 | Windows x64, integrated webcam, bright front light | Stable breathing and pulse; orb and ring visibly change | Not run |
| 2 | Windows x64, USB webcam | Device picker lists both cameras; switching works | Not run |
| 3 | Low light | Validation guidance asks for light; "still learning"; no invented numbers | Not run |
| 4 | Face partially out of frame | Framing guidance; signals degrade honestly | Not run |
| 5 | Talking and body movement | Stability drops; room falls back to ambient; guidance is non-judgemental | Not run |
| 6 | Camera permission denied | Permission screen; no SDK session; demo remains available | Automated E2E only |
| 7 | Camera already in use | "Camera is busy" guidance; retry works after closing the other app | Not run |
| 8 | Network unavailable during authentication | Typed authentication error; retry; no fabricated metrics | Not run |
| 9 | Stop during calibration | Camera releases; reflection appears; samples clear | Automated simulator only |
| 10 | Stop during Arrive / Settle / Choose | Camera releases; no late samples; reflection facts correct | Automated simulator only |
| 11 | Window close during a session | Camera releases; process exits; no background capture | Not run on hardware |
| 12 | Quit during a session | SDK destroyed; process exits | Not run on hardware |
| 13 | Five-minute CPU and memory observation | Near-60 fps animation; bounded memory | Not run |
| 14 | Partial-signal path on hardware | Breathing-only room; pulse never shown as valid | Automated simulator only |
| 15 | Expression toggle off | SDK not asked for expressions when declined; palette stays stable | Automated integration only |
| 16 | Key isolation | Key absent from renderer HTML, storage, bridge, logs | Automated E2E with sentinel only |

## What must be verified before claiming live support

1. A real key validates and the SDK reaches `Running`.
2. Camera frames reach `sendFrame()` and FPS is non-zero in the overlay.
3. Breathing and pulse samples appear with real confidence and stability values.
4. The orb scale visibly follows the breathing waveform, the ring follows pulse, and the palette
   responds only with high-confidence expression and consent.
5. Stop releases the OS camera indicator in every phase.
6. Authentication failure, low light, motion, camera busy, and missing network produce the intended
   guidance.
7. Five-minute CPU and memory behavior is acceptable.
8. The packaged NSIS/portable build loads the native runtime from `resources/smartspectra/` and can
   run a live session without a development server.

## Sign-off

| Role | Name | Date | Result |
|---|---|---|---|
| Build author | — | 2026-11-09 | Automated gates only; no live claim |
| Human hardware tester | `[ADD NAME]` | `[ADD DATE]` | `[PASS/FAIL + notes]` |

Until the human hardware tester fills this table with real observations, the project must describe
live SmartSpectra support as **unverified in this environment**, not as working.
