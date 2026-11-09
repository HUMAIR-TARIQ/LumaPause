# LumaPause privacy and data handling

LumaPause is a local-first wellness experience. It uses the camera to measure breathing and pulse
while you explicitly run a session, turns those measurements into light, and then forgets them.

It is **not** a medical device and does not diagnose, treat, prevent, monitor, or score any
condition.

## Data-flow summary

| Data                                                                                               | Purpose                                             | Processing location                                                              | Stored?                                                               | Shared?                                   | Retention                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Camera frames (`RGBA`, downsampled)                                                                | Signal input for SmartSpectra                       | Electron renderer → preload MessagePort → main process → SDK, all on this device | No                                                                    | No                                        | The current frame only; each frame is overwritten as the next arrives                      |
| Metric samples (pulse, breathing rate, breathing waveform, expression probabilities)               | Drive the room's light and factual reflection       | Main process (SDK output), copied to renderer snapshots                          | Memory only                                                           | No                                        | Current session; samples are cleared when you stop; the session is cleared when you finish |
| Validation codes and processing status                                                             | Framing guidance and honest "still learning" states | SDK → main process → renderer                                                    | Memory only                                                           | No                                        | Current session                                                                            |
| `SMARTSPECTRA_API_KEY`                                                                             | Authenticate the SDK and validate the subscription  | Electron main process only                                                       | Process environment or a development `.env`; never written by the app | Sent to Presage over HTTPS for validation | Process lifetime; never sent to the renderer or written to logs/build output               |
| SDK authentication and subscription metadata                                                       | Confirm the key is valid and entitled               | Sent by the SDK to Presage                                                       | No app-side storage                                                   | Presage (network request)                 | The validation request only                                                                |
| User intention text                                                                                | Shown back on the reflection screen                 | Renderer memory                                                                  | No                                                                    | No                                        | Current session; cleared on finish or start-another                                        |
| Self-report (1–5, voluntary)                                                                       | Shown back on the reflection screen                 | Renderer memory                                                                  | No                                                                    | No                                        | Current session; cleared on finish or start-another                                        |
| Session facts (durations, which signals were available, approximate stable coverage, frame counts) | Factual reflection                                  | Main process → renderer                                                          | Memory only                                                           | No                                        | Cleared when the session is cleared                                                        |
| Developer overlay diagnostics                                                                      | Development troubleshooting                         | Renderer memory                                                                  | No                                                                    | No                                        | While the overlay is open and the session exists                                           |
| Console warnings                                                                                   | Error diagnosis                                     | Process console only                                                             | No app-managed log file                                               | No                                        | Terminal/session log, controlled by the OS or launcher                                     |

No localStorage, sessionStorage, IndexedDB, cookies, analytics, crash-reporting SDK, or upload
endpoint is used. There is no account system and no server operated by LumaPause.

### The one network path

SmartSpectra requires a network request to authenticate the API key and validate the subscription.
That request is made by the SDK to Presage. Like any HTTPS request, Presage will see standard
connection metadata such as the source IP address. LumaPause does not add any telemetry of its own
and constructs the SDK with `enableTelemetry: false`.

Metric computation happens on-device. **No camera frames, metric samples, intention text, or
self-report values are sent to Presage or anyone else.**

See the official documentation for the SDK's authentication behavior:
<https://smartspectra.presagetech.com/docs/nodejs/api-reference>.

## Consent

- The app opens on a welcome screen. It does not request the camera until you choose **Begin
  privately**, review the consent screen, and press the button that enables the camera.
- Consent records the consent-copy version, a timestamp, whether the camera is enabled, whether
  expression responsiveness is enabled, and whether the session is simulated. The record exists in
  memory for that session only.
- Facial-expression probabilities are optional. If you do not enable them, the SDK is not asked for
  the expression metric and the palette never responds to expression.
- Demo mode uses a separate consent record (`simulator: true`) and never requests the camera.
- The consent-copy version is stored with the record. If the copy changes, old consent cannot be
  reused.

### Withdrawing consent

You can withdraw at any time by:

- Pressing **Stop and see reflection** during calibration or the room.
- Leaving a camera stage with the back action.
- Turning off **Expression light** in the room controls.
- Revoking camera permission in Windows Settings → Privacy & security → Camera.
- Closing the window or quitting the app.

Stopping releases the camera tracks immediately and stops the SDK. Data retention after each path
is described below.

## Camera behavior

- Camera access is requested only from LumaPause's own page, only for video, and only after the
  consent action. Audio, notifications, geolocation, HID, USB, serial, and every other permission
  are denied by the Electron permission handlers.
- There is no self-view preview. A small, hidden video element feeds the frame pump; the interface
  shows a status chip such as `Camera on · processed locally`, not a mirror.
- The operating system's camera-in-use indicator (for example, the Windows camera LED or privacy
  indicator) remains the authoritative hardware signal. LumaPause does not attempt to suppress it.
- Stop, error, room completion, window close, and quit all stop the media tracks. The SDK is stopped
  and destroyed through the main-process service.

## Retention and deletion

| Action              | What is cleared                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop                | Camera tracks, SDK session, metric samples, waveform buffers, the latest snapshot; session facts and the voluntary self-report remain for the reflection screen |
| Finish / clear      | Session facts, intention, self-report, all renderer state, SDK instance, credentials cached in the service (not the process environment)                        |
| Start another       | Same as finish, then returns to consent (live) or demo setup (simulated)                                                                                        |
| Window close / quit | Stop plus a full service shutdown; the process exits                                                                                                            |
| Crash               | Memory dies with the process; nothing was written to disk                                                                                                       |

A transient confirmation reads **"Session cleared from memory"** after finishing. It contains no
data.

## No covert monitoring

LumaPause never starts the camera on launch, in the background, while minimized, or after a
session ends. There is no tray mode, startup hook, scheduled capture, or remote trigger. Closing
the window stops the session before the process quits.

## No consequential use

Do not use LumaPause or its signals for employment screening, insurance decisions, education
grading, surveillance, identity inference, deception detection, or any other consequential
decision about a person. The application intentionally avoids identity, demographic, personality,
intent, and mental-health inference, and it produces no readiness, stress, or health score.

## No medical use

LumaPause is a general-wellness reflection experience. It does not diagnose, treat, prevent, cure,
or clinically reduce any condition, and it is not a substitute for professional care. If you feel
unwell, stop the session and seek appropriate care. Do not use LumaPause to make medication,
treatment, or emergency decisions.

## Reporting a privacy or security issue

Please report issues privately to the project maintainer rather than opening a public issue with
sensitive details. Include the app version, platform, and a description of the behavior. Do **not**
include API keys, camera images, or personal health information in a report. If a key may have been
exposed, revoke it in the Presage developer portal and issue a replacement.

## Changes

This document describes LumaPause 1.0.0. Material changes to data handling require a new consent
version so previously recorded consent cannot silently cover a different practice.
