import type { ReactNode } from 'react';
import { Dialog } from './ui';

export function HowItWorksDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog title="How LumaPause works" open={open} onClose={onClose}>
      <ol className="how-list">
        <li>
          <strong>Consent, then the camera.</strong> Nothing is captured before you deliberately
          enable the camera. Demo mode is always available without one.
        </li>
        <li>
          <strong>A short signal check.</strong> SmartSpectra validates framing, lighting, and
          stillness. Guidance comes from the sensor's own validation events.
        </li>
        <li>
          <strong>Calibration.</strong> Breathing can take around thirty seconds to settle. Low
          confidence is shown as “still learning”, never as a personal failure.
        </li>
        <li>
          <strong>A two-minute light room.</strong> Measured breathing moves the orb, a stable pulse
          adds a gentle ring, and expression probabilities can warm the palette if you opted in.
          Missing signals fall back to ambient light and say so.
        </li>
        <li>
          <strong>Reflection, then clearing.</strong> Stopping releases the camera. Session facts
          stay in memory until you finish, then LumaPause clears them and destroys the sensor
          session.
        </li>
      </ol>
      <div className="dialog-note">
        <p>
          SmartSpectra computes metrics on this device. Presage is contacted only to validate the
          API key and subscription. LumaPause constructs the SDK with telemetry disabled, does not
          record or upload video, and stores no metric history.
        </p>
        <p>
          LumaPause is a general-wellness reflection experience, not a medical device. It does not
          diagnose, treat, prevent, or monitor any condition, and it never labels a reading as good,
          bad, calm, or stressed.
        </p>
      </div>
    </Dialog>
  );
}
