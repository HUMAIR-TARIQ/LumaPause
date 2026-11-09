import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OVERLAY_THROTTLE_MS } from '../../shared/constants';
import type {
  EnvironmentInfo,
  Mode,
  ProcessingState,
  SessionPhase,
  SignalSample,
  SignalSnapshot,
} from '../../shared/contracts';
import { timeAgo } from '../lib/format';

interface OverlayView {
  snapshot: SignalSnapshot | null;
  processing: ProcessingState | null;
  phase: SessionPhase;
  mode: Mode;
  env: EnvironmentInfo | null;
}

function SampleLine({
  label,
  sample,
  unit,
  now,
}: {
  label: string;
  sample: SignalSample | null;
  unit: string;
  now: number;
}): ReactNode {
  if (!sample) {
    return (
      <div>
        <dt>{label}</dt>
        <dd>absent</dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {sample.value.toFixed(2)} {unit} · conf {Math.round(sample.confidence)} ·{' '}
        {sample.stable ? 'stable' : 'unstable'} · {timeAgo(sample.timestamp, now)}
      </dd>
    </div>
  );
}

/**
 * Development-only diagnostics. Toggled with Ctrl/Cmd+Shift+D and off by default.
 * It is intentionally excluded from the public narrative: raw probabilities and
 * official validation codes live here so the room can stay non-clinical.
 */
export function DeveloperOverlay({
  snapshot,
  processing,
  phase,
  mode,
  env,
  onClose,
}: OverlayView & { onClose: () => void }): ReactNode {
  const latest = useRef<OverlayView>({ snapshot, processing, phase, mode, env });
  latest.current = { snapshot, processing, phase, mode, env };
  const [view, setView] = useState<OverlayView>(latest.current);

  useEffect(() => {
    const id = window.setInterval(() => setView(latest.current), OVERLAY_THROTTLE_MS);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  const snap = view.snapshot;
  const visual = snap?.visual ?? null;
  const expressionEntries = snap?.expression
    ? Object.entries(snap.expression.probabilities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
    : [];

  return (
    <aside className="dev-overlay" aria-label="Developer overlay">
      <header className="dev-overlay__head">
        <div>
          <strong>LumaPause developer overlay</strong>
          <span className="dev-overlay__mode">
            {view.mode === 'live' ? 'LIVE — SMARTSPECTRA' : 'SIMULATED — NOT SMARTSPECTRA DATA'}
          </span>
        </div>
        <button
          type="button"
          className="dev-overlay__close"
          onClick={onClose}
          aria-label="Close developer overlay"
        >
          Close
        </button>
      </header>

      <section>
        <h2>Session</h2>
        <dl className="dev-grid">
          <div>
            <dt>phase</dt>
            <dd>{view.phase}</dd>
          </div>
          <div>
            <dt>mode</dt>
            <dd>{view.mode}</dd>
          </div>
          <div>
            <dt>processing</dt>
            <dd>
              {view.processing ? `${view.processing.label} (${view.processing.code})` : 'unknown'}
            </dd>
          </div>
          <div>
            <dt>SDK revision</dt>
            <dd>{snap?.revision ?? '—'}</dd>
          </div>
          <div>
            <dt>session elapsed</dt>
            <dd>{(snap?.sessionElapsedMs ?? 0).toFixed(0)} ms</dd>
          </div>
          <div>
            <dt>room elapsed</dt>
            <dd>{(snap?.roomElapsedMs ?? 0).toFixed(0)} ms</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>Samples</h2>
        <dl className="dev-grid">
          <SampleLine label="pulse" sample={snap?.pulse ?? null} unit="bpm" now={now} />
          <SampleLine
            label="breathing"
            sample={snap?.breathingRate ?? null}
            unit="br/min"
            now={now}
          />
          <SampleLine
            label="waveform"
            sample={snap?.upperBreathingWaveform ?? null}
            unit="rel"
            now={now}
          />
          <div>
            <dt>waveform norm</dt>
            <dd>{snap?.upperBreathingWaveform?.normalized?.toFixed(3) ?? '—'}</dd>
          </div>
          <div>
            <dt>expression</dt>
            <dd>
              {snap?.expression
                ? `${Math.round(snap.expression.dominantConfidence)} · ${
                    snap.expression.stable ? 'stable' : 'unstable'
                  } · ${timeAgo(snap.expression.timestamp, now)}`
                : 'absent'}
            </dd>
          </div>
          {expressionEntries.map(([name, value]) => (
            <div key={name}>
              <dt>prob {name}</dt>
              <dd>{value.toFixed(1)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>Validation</h2>
        {snap?.validation ? (
          <dl className="dev-grid">
            <div>
              <dt>code</dt>
              <dd>{snap.validation.code}</dd>
            </div>
            <div>
              <dt>label</dt>
              <dd>{snap.validation.label}</dd>
            </div>
            <div>
              <dt>level</dt>
              <dd>{snap.validation.level}</dd>
            </div>
            <div>
              <dt>timestamp µs</dt>
              <dd>{snap.validation.timestampUs}</dd>
            </div>
            <div className="dev-grid__wide">
              <dt>official hint</dt>
              <dd>{snap.validation.officialHint || '—'}</dd>
            </div>
          </dl>
        ) : (
          <p>No validation event yet.</p>
        )}
      </section>

      <section>
        <h2>Derived visual state</h2>
        <dl className="dev-grid">
          <div>
            <dt>breathScale</dt>
            <dd>{visual?.breathScale.toFixed(3) ?? '—'}</dd>
          </div>
          <div>
            <dt>pulseGlow</dt>
            <dd>{visual?.pulseGlow.toFixed(3) ?? '—'}</dd>
          </div>
          <div>
            <dt>paletteWarmth</dt>
            <dd>{visual?.paletteWarmth.toFixed(3) ?? '—'}</dd>
          </div>
          <div>
            <dt>particleVelocity</dt>
            <dd>{visual?.particleVelocity.toFixed(3) ?? '—'}</dd>
          </div>
          <div>
            <dt>breathingPeriodMs</dt>
            <dd>{visual?.breathingPeriodMs?.toFixed(0) ?? 'ambient'}</dd>
          </div>
          <div>
            <dt>availability</dt>
            <dd>{visual?.signalAvailability ?? '—'}</dd>
          </div>
          <div>
            <dt>measured breath</dt>
            <dd>{String(visual?.measuredBreathing ?? false)}</dd>
          </div>
          <div>
            <dt>measured pulse</dt>
            <dd>{String(visual?.measuredPulse ?? false)}</dd>
          </div>
          <div>
            <dt>expression light</dt>
            <dd>{String(snap?.expressionResponsiveness ?? false)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>Frames and coverage</h2>
        <dl className="dev-grid">
          <div>
            <dt>received</dt>
            <dd>{snap?.frameStats.received ?? 0}</dd>
          </div>
          <div>
            <dt>accepted</dt>
            <dd>{snap?.frameStats.accepted ?? 0}</dd>
          </div>
          <div>
            <dt>rejected</dt>
            <dd>{snap?.frameStats.rejected ?? 0}</dd>
          </div>
          <div>
            <dt>fps</dt>
            <dd>{snap?.frameStats.fps.toFixed(1) ?? '0.0'}</dd>
          </div>
          <div>
            <dt>stable coverage</dt>
            <dd>{snap?.stableCoverage.percent.toFixed(1) ?? '0.0'}%</dd>
          </div>
          <div>
            <dt>stable seconds</dt>
            <dd>{snap?.stableCoverage.stableSeconds.toFixed(1) ?? '0.0'}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>Environment</h2>
        <dl className="dev-grid">
          <div>
            <dt>app</dt>
            <dd>{view.env?.appVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>SDK</dt>
            <dd>{view.env?.sdkVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>platform</dt>
            <dd>{view.env ? `${view.env.platform}-${view.env.arch}` : '—'}</dd>
          </div>
          <div>
            <dt>key source</dt>
            <dd>{view.env?.keySource ?? '—'}</dd>
          </div>
          <div>
            <dt>telemetry</dt>
            <dd>{view.env?.telemetryDisabled ? 'disabled' : 'unknown'}</dd>
          </div>
          <div>
            <dt>timing scale</dt>
            <dd>{view.env?.timingScale ?? 1}</dd>
          </div>
        </dl>
        <p className="dev-overlay__note">
          The API key is never available to the renderer, so it cannot appear here. Validation codes
          and timestamps are preserved for troubleshooting.
        </p>
      </section>
    </aside>
  );
}
