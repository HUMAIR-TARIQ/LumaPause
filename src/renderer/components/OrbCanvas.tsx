import { useEffect, useRef, type ReactNode } from 'react';
import type { SignalSnapshot, VisualState } from '../../shared/contracts';
import { AMBIENT_VISUAL } from '../../shared/visual-mapping';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const MINT: Rgb = { r: 169, g: 244, b: 197 };
const AMBER: Rgb = { r: 243, g: 199, b: 123 };
const LAVENDER: Rgb = { r: 185, g: 176, b: 232 };
const IVORY: Rgb = { r: 255, g: 248, b: 230 };

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
  };
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

interface Particle {
  x: number;
  y: number;
  radius: number;
  drift: number;
  phase: number;
}

/**
 * The living light. Targets come only from the validated VisualState; this
 * component interpolates toward them and never reads metrics itself. Reduced
 * motion removes particles and ambient oscillation, keeping colour and scale.
 */
export function OrbCanvas({
  snapshot,
  reducedMotion,
  highContrast,
}: {
  snapshot: SignalSnapshot | null;
  reducedMotion: boolean;
  highContrast: boolean;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<VisualState>(AMBIENT_VISUAL);
  const pulseRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = snapshot?.visual ?? AMBIENT_VISUAL;
    pulseRef.current = snapshot?.pulse?.value ?? null;
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let width = 1;
    let height = 1;
    let raf = 0;
    let last = performance.now();

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const particles: Particle[] = [];
    if (!reducedMotion) {
      for (let index = 0; index < 52; index += 1) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          radius: 0.6 + Math.random() * 1.7,
          drift: -0.4 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    const state = {
      scale: 1,
      glow: AMBIENT_VISUAL.pulseGlow,
      warmth: AMBIENT_VISUAL.paletteWarmth,
      velocity: AMBIENT_VISUAL.particleVelocity,
      pulsePhase: 0,
      breathPhase: 0,
    };

    const draw = (now: number): void => {
      const dt = Math.min(60, Math.max(0, now - last));
      last = now;
      const target = targetRef.current;

      const ease = reducedMotion ? 0.06 : 0.16;
      state.scale += (target.breathScale - state.scale) * ease;
      state.glow += (target.pulseGlow - state.glow) * (reducedMotion ? 0.04 : 0.09);
      state.warmth += (target.paletteWarmth - state.warmth) * 0.05;
      state.velocity += (target.particleVelocity - state.velocity) * 0.05;

      if (!reducedMotion) {
        // A stable breathing rate sets the visible tempo; without one the room
        // falls back to a slow ambient cycle instead of inventing a reading.
        const breathPeriod = target.breathingPeriodMs ?? 7600;
        state.breathPhase += (dt / breathPeriod) * Math.PI * 2;
        const bpm = pulseRef.current;
        const hertz =
          target.measuredPulse && bpm && Number.isFinite(bpm)
            ? Math.min(0.45, Math.max(0.2, 0.2 + (Math.min(160, Math.max(0, bpm)) / 160) * 0.25))
            : 0.22;
        state.pulsePhase += (dt / 1000) * hertz * Math.PI * 2;
      }

      const ambientPulse = reducedMotion ? 0 : Math.sin(state.breathPhase) * 0.018;
      const scale = target.measuredBreathing ? state.scale : 1 + ambientPulse;
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(state.pulsePhase);

      const inner = mix(MINT, AMBER, state.warmth);
      const halo = mix(LAVENDER, AMBER, state.warmth * 0.85);
      const background = highContrast ? '#04110b' : '#08120f';

      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.47;
      const base = Math.min(width, height) * 0.155;
      const radius = base * scale * (1 + pulse * 0.014 * state.glow);

      const field = context.createRadialGradient(
        cx,
        cy,
        radius * 0.1,
        cx,
        cy,
        Math.max(width, height) * 0.72,
      );
      field.addColorStop(0, rgba(inner, highContrast ? 0.3 : 0.2 + state.glow * 0.16));
      field.addColorStop(0.35, rgba(halo, highContrast ? 0.16 : 0.09 + state.glow * 0.05));
      field.addColorStop(1, rgba(halo, 0));
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);

      // A soft outer bloom that breathes with the orb.
      const bloom = context.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 2.8);
      bloom.addColorStop(0, rgba(inner, 0.22 + state.glow * 0.14));
      bloom.addColorStop(0.5, rgba(halo, 0.08 + state.glow * 0.06));
      bloom.addColorStop(1, rgba(halo, 0));
      context.fillStyle = bloom;
      context.beginPath();
      context.arc(cx, cy, radius * 2.8, 0, Math.PI * 2);
      context.fill();

      // Pulse ring: clamped to a slow visual frequency and gentle opacity.
      if (target.measuredPulse) {
        const ringRadius = radius * (1.28 + pulse * 0.42);
        context.beginPath();
        context.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = rgba(inner, (1 - pulse) * (0.14 + state.glow * 0.3));
        context.lineWidth = Math.max(1, (1.5 + state.glow * 2.5) * (window.devicePixelRatio || 1));
        context.stroke();
      }

      // Core.
      const core = context.createRadialGradient(
        cx - radius * 0.28,
        cy - radius * 0.32,
        radius * 0.08,
        cx,
        cy,
        radius,
      );
      core.addColorStop(0, rgba(IVORY, highContrast ? 0.98 : 0.92));
      core.addColorStop(0.42, rgba(inner, highContrast ? 0.9 : 0.82));
      core.addColorStop(0.82, rgba(inner, 0.55));
      core.addColorStop(1, rgba(halo, 0.08));
      context.fillStyle = core;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(cx, cy, radius * 1.015, 0, Math.PI * 2);
      context.strokeStyle = rgba(inner, 0.25 + state.glow * 0.35);
      context.lineWidth = Math.max(1, 1.2 * (window.devicePixelRatio || 1));
      context.stroke();

      if (!reducedMotion) {
        const speed = 0.000015 + state.velocity * 0.000025;
        for (const particle of particles) {
          particle.phase += dt * 0.0003;
          particle.y += particle.drift * speed * dt;
          particle.x += Math.sin(particle.phase) * 0.000004 * dt;
          if (particle.y < -0.02) particle.y = 1.02;
          if (particle.y > 1.02) particle.y = -0.02;
          if (particle.x < -0.02) particle.x = 1.02;
          if (particle.x > 1.02) particle.x = -0.02;

          const px = particle.x * width;
          const py = particle.y * height;
          const alpha = (0.08 + state.velocity * 0.16) * (highContrast ? 1.4 : 1);
          context.beginPath();
          context.arc(px, py, particle.radius * (window.devicePixelRatio || 1), 0, Math.PI * 2);
          context.fillStyle = rgba(halo, alpha);
          context.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reducedMotion, highContrast]);

  return <canvas ref={canvasRef} className="orb-canvas" aria-hidden="true" />;
}
