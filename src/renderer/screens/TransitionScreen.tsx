import type { ReactNode } from 'react';
import { BusyVeil, Eyebrow, PrivacyLine } from '../components/ui';

const COPY = {
  requesting_camera: {
    eyebrow: 'Camera',
    title: 'Opening a private camera session',
    detail:
      'The camera indicator will turn on. Frames stay inside LumaPause and are used only for on-device measurement.',
    busy: 'Waiting for the camera',
  },
  stopping: {
    eyebrow: 'Stopping',
    title: 'Releasing the camera and stopping the sensor',
    detail:
      'The camera track is stopped before reflection appears. Final metric samples are discarded, not stored.',
    busy: 'Stopping the session',
  },
  clearing: {
    eyebrow: 'Clearing',
    title: 'Clearing this session from memory',
    detail:
      'Metric samples, frame statistics, the intention, and the self-report are removed. The sensor session is destroyed.',
    busy: 'Clearing memory',
  },
} as const;

export function TransitionScreen({ kind }: { kind: keyof typeof COPY }): ReactNode {
  const copy = COPY[kind];

  return (
    <div className="screen screen--narrow transition-screen">
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <h1 className="title">{copy.title}</h1>
      <p className="lede lede--small">{copy.detail}</p>
      <BusyVeil label={copy.busy} />
      <PrivacyLine>No video is recorded. No metric history is saved.</PrivacyLine>
    </div>
  );
}
