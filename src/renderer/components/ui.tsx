import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

export function Button({
  variant = 'secondary',
  full = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      className={`btn btn--${variant}${full ? ' btn--full' : ''}${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <section className={`panel${className ? ` ${className}` : ''}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }): ReactNode {
  return <p className="eyebrow">{children}</p>;
}

export function PrivacyLine({ children }: { children?: ReactNode }): ReactNode {
  return (
    <p className="privacy-line">
      <span className="privacy-line__mark" aria-hidden="true" />
      {children ?? 'Your camera stays on this device. No video is recorded.'}
    </p>
  );
}

export type Tone = 'neutral' | 'good' | 'learning' | 'warn' | 'danger';

export function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}): ReactNode {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}

export function SignalRow({
  label,
  status,
  tone,
  detail,
}: {
  label: string;
  status: string;
  tone: Tone;
  detail?: string;
}): ReactNode {
  return (
    <div className="signal-row">
      <span className={`signal-row__dot signal-row__dot--${tone}`} aria-hidden="true" />
      <span className="signal-row__label">{label}</span>
      <span className="signal-row__status">{status}</span>
      {detail ? <span className="signal-row__detail">{detail}</span> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}): ReactNode {
  return (
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`}>
      <span className="toggle__copy">
        <span className="toggle__label">{label}</span>
        {description ? <span className="toggle__description">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`toggle__switch${checked ? ' toggle__switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" aria-hidden="true" />
      </button>
    </label>
  );
}

export function BusyVeil({ label }: { label: string }): ReactNode {
  return (
    <div className="busy-veil" role="status" aria-live="polite">
      <span className="busy-veil__pulse" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function CameraOffBadge({ simulated = false }: { simulated?: boolean }): ReactNode {
  return (
    <div className="camera-off" role="status">
      <span className="camera-off__icon" aria-hidden="true" />
      <span>
        <strong>Camera off</strong>
        <span className="camera-off__detail">
          {simulated
            ? 'This reflection came from simulated signals.'
            : 'The camera track was stopped before this screen appeared.'}
        </span>
      </span>
    </div>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

export function Dialog({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const first = container ? focusableElements(container)[0] : null;
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const items = focusableElements(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={containerRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="quiet" onClick={close} aria-label="Close dialog">
            Close
          </Button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
