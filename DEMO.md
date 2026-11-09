# LumaPause demo guide

This is a 90-second walkthrough for judges, plus the setup needed to make a live session
trustworthy. Demo mode is a labeled backup, not a substitute for live verification.

## Before the demo

### Live setup

1. Install the packaged app, or run `npm run dev` from a checkout with Node 20+.
2. Set `SMARTSPECTRA_API_KEY` in the process environment, or put it in a development `.env` file.
   Do not paste the key into the renderer or a slide.
3. In Windows Settings → Privacy & security → Camera, allow desktop apps to use the camera.
4. Close Teams, Zoom, OBS, and any virtual-camera software. A busy camera produces a clear error,
   but it costs demo time.
5. Check the network. SmartSpectra needs connectivity to validate the key and subscription;
   metric computation is local.

### Framing

- Camera at eye level, roughly 50–80 cm away.
- Face the light. Avoid a bright window behind you.
- Keep your whole face in frame, including the forehead and chin.
- Sit reasonably still and avoid talking during calibration.
- Plain background, no strong flicker or strobing light.

### Expected timing

| Stage                      | Normal duration                                                     |
| -------------------------- | ------------------------------------------------------------------- |
| Consent and camera request | 10–20 seconds                                                       |
| Camera and signal check    | as long as you need                                                 |
| Calibration                | at least 30 seconds; partial-signal option appears after 45 seconds |
| Responsive room            | 2 minutes total: Arrive 35 s, Settle 50 s, Choose 35 s              |
| Reflection                 | as long as you need                                                 |

Breathing often takes around 30 seconds to stabilize. That is why calibration is not instant and
why the partial-signal path exists.

## 90-second judge walkthrough

| Time | Action                                                                  | What to point out                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Launch the app on **Welcome**                                           | Nothing has started. The OS camera indicator is off. Copy says the camera stays on this device.                                                                                                                      |
| 0:08 | Press **Begin privately**                                               | Setup guidance or consent appears. No camera request has happened yet.                                                                                                                                               |
| 0:12 | On **Consent**, read the camera and expression sections                 | Expression responsiveness is optional. The camera starts only after the explicit button.                                                                                                                             |
| 0:20 | Enable the camera; choose a camera if prompted                          | The OS indicator turns on now. The signal check shows framing guidance, validation codes in plain language, and device selection.                                                                                    |
| 0:28 | Press **Start calibration**                                             | The room shows "still learning" states instead of fake numbers.                                                                                                                                                      |
| 0:40 | Open the developer overlay: **Ctrl+Shift+D** (**Cmd+Shift+D** on macOS) | Show phase, SDK revision, latest samples, confidence, stability, validation code, frame FPS, stable coverage, and the derived visual parameters. The key is absent by design.                                        |
| 0:48 | Close the overlay                                                       | The overlay is never on by default.                                                                                                                                                                                  |
| 0:52 | Once **Continue to the room** enables, enter the room                   | Calibration completes after at least 30 seconds.                                                                                                                                                                     |
| 1:00 | **Arrive → Settle**                                                     | Watch the orb scale with the breathing waveform, the ring brighten and pulse with pulse confidence, particles drift faster with signal confidence, and the palette warm only if expression is enabled and confident. |
| 1:15 | Open **Show live signals**                                              | Values appear only while fresh and stable. Missing signals say "No stable sample" or "Ambient animation, not measured".                                                                                              |
| 1:25 | Press **Stop and see reflection**                                       | The camera indicator goes off. The reflection shows durations, which signals were available, and approximate coverage — no score or judgement.                                                                       |
| 1:35 | Finish and clear                                                        | The session clears from memory. The welcome screen returns without assuming camera permission.                                                                                                                       |

If a signal never stabilizes, do not fake it. Continue through the partial-signal path and show
that the room stays ambient and honest.

## What each signal changes

| Signal                   | What the judge can see                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Breathing waveform       | Orb grows and shrinks between 0.9× and 1.1×, easing toward the current waveform position                                      |
| Breathing rate           | Visible breathing tempo (60 s ÷ rate, clamped to 3.5–9 s), particle drift speed, and the "measured breathing" state           |
| Pulse rate               | Pulse-ring brightness and slow expansion; visual frequency is clamped to 0.20–0.45 Hz and is not a literal heart-rate display |
| Expression probabilities | Subtle mint ↔ amber palette temperature, only with consent, high confidence, and the room toggle on                          |
| Validation code          | Framing guidance: move closer, add light, hold still, and so on                                                               |
| Frame pipeline           | FPS, accepted/rejected counts, and coverage in the developer overlay                                                          |

## Verify the camera actually stops

Do at least two of these:

1. **OS indicator:** the Windows camera LED or in-use indicator turns off on stop, on finish, on
   window close, and on quit.
2. **Windows camera settings:** Settings → Privacy & security → Camera shows no active use by
   LumaPause after stopping.
3. **Reflection copy:** the reflection screen says **Camera off**.
4. **Leave it stopped:** wait 30 seconds; the indicator does not return until you explicitly start
   another live session.

If the indicator stays on, stop the demo and treat it as a release blocker.

## Simulator backup

Use this when no key, camera, or supported hardware is available. It is useful for reviewing the
interface and the failure paths. It is **not** evidence that the SmartSpectra integration works,
and its screenshots must not be presented as live measurements.

1. Launch without a key, press **Begin privately**, and choose **Explore demo mode**.
2. The permanent banner appears: **SIMULATED SIGNALS — NOT SMARTSPECTRA DATA**.
3. Choose a scenario:
   - **Stable signals** — the complete journey.
   - **Poor lighting** — confidence never reaches the official thresholds; the room stays ambient.
   - **Movement** — signals flicker between learning and available.
   - **Breathing only** — the partial-signal screen and a breathing-shaped room.
   - **Signal loss** — stable signals disappear mid-session and the room falls back to ambient.
4. Press **Enter demo room**, wait for calibration, enter the room, and use the room controls to
   switch scenarios live.
5. Open the developer overlay with **Ctrl+Shift+D** to show that the mode reads
   `SIMULATED — NOT SMARTSPECTRA DATA`.

The simulator exposes the same FSM, the same IPC boundary, and the same visual mapping as live
mode. The difference is only the sample source. Automated tests use the simulator and must never
be described as live verification.

## Troubleshooting

| Symptom                          | What it means                       | What to do                                                                                                                       |
| -------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Setup screen instead of consent  | No usable key or native runtime     | Check `SMARTSPECTRA_API_KEY`, the platform package, and restart. Demo mode remains available.                                    |
| Permission screen                | The OS or user denied the camera    | Allow camera access for LumaPause in Windows Settings, then retry.                                                               |
| "Still learning" for a long time | Low light, motion, or framing       | Add front light, center the face, hold still; after 45 s use the partial path if it is honest.                                   |
| Camera busy                      | Another app owns the device         | Close other camera apps and retry.                                                                                               |
| Authentication error             | Network or key/subscription problem | Check connectivity and the key's subscription in the Presage portal. Metrics cannot be computed without a successful validation. |
| No metrics after validation      | Frames are not reaching the SDK     | Watch FPS and rejected frames in the overlay; retry or choose another camera.                                                    |
