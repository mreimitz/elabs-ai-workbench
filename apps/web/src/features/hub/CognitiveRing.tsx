import { useReducedMotion } from "@elabs-ai/components-tokens";
import { cn } from "@elabs-ai/components-ui";
import { type CSSProperties, useEffect, useRef } from "react";
import "./CognitiveRing.css";

/**
 * Assistant Hub — the fresh-session welcome emblem: a layered "cognitive processing" ring
 * (concentric telemetry / reasoning / working-memory tracks, radial routing spokes, a sweeping
 * scanner, thinking nodes, data packets, and a synthesising core) rendered ENTIRELY in CSS. It is
 * the visual centrepiece of {@link EmptySessionIntro}'s centered invitation for a brand-new,
 * empty assistant session.
 *
 * Design discipline (see CognitiveRing.css): every colour resolves through the semantic
 * `@elabs-ai/components-tokens` layer via a scoped `--ring-*` accent set — the Acme green maps to `--primary`,
 * the brand cyan is defined once as a documented scoped token — so it reads correctly in both
 * `light` and `dark` with no raw literal and no `dark:` override.
 *
 * Purely decorative: `aria-hidden` and NOT focusable — the greeting text next to it carries all the
 * meaning, so the ring adds nothing for assistive tech and must not become a keyboard stop. The
 * greeting's own copy is the accessible name of the welcome region.
 *
 * Motion: `prefers-reduced-motion` (both the CSS media query AND the app's `useReducedMotion` hook)
 * is honoured as a hard rule — under reduced motion the ambient animation, the pointer parallax
 * tilt, and the pointer-only flourishes (particle burst + cursor sparks) are all dropped, leaving a
 * calm static emblem. When `paused` (the intro has docked and faded the greeting out of view) every
 * timeline is halted so the illustration costs nothing off-screen.
 */
export interface CognitiveRingProps {
  /**
   * Diameter of the ring. A number is treated as pixels; a string is used verbatim (so a caller can
   * pass a responsive length, e.g. `"clamp(120px, 22vmin, 188px)"`). Sets the `--ring-size` custom
   * property the whole illustration scales from. Defaults to the CSS `clamp(160px, 40vmin, 240px)`.
   */
  size?: number | string;
  /**
   * Pointer parallax (a subtle 3D tilt toward the cursor) plus cursor sparks along the ring band.
   * Automatically disabled under reduced motion regardless of this flag. Default `true`.
   */
  interactive?: boolean;
  /**
   * Halt every animation (via a `data-paused` hook the CSS reads). Used by the intro to stop the
   * ring once it has faded behind the conversation, so it consumes no frames while invisible.
   * Default `false`.
   */
  paused?: boolean;
  className?: string;
}

/** Composes an inline style object that also carries CSS custom properties. */
function ringVars(vars: Record<string, string>, base?: CSSProperties): CSSProperties {
  return { ...base, ...vars } as CSSProperties;
}

// Eight cardinal tick marks at 45° increments (every 2nd is a shorter cyan tick — see the CSS).
const CARDINAL_ANGLES = Array.from({ length: 8 }, (_, i) => i * 45);

// Twelve thinking nodes evenly around the ring; staggered negative delays so they pulse out of phase
// (every 3rd node is green — see the CSS `nth-child(3n)`).
const NODES = Array.from({ length: 12 }, (_, i) => ({
  angle: i * 30,
  delay: -(0.1 + i * 0.3),
}));

// Three data-packet tracks orbiting at different radii, directions, and speeds.
const PACKET_TRACKS = [
  {
    inset: "18%",
    duration: "11.8s",
    direction: "cr-rotate-cw",
    color: "var(--ring-cyan)",
    size: "5px",
    delay: "-.4s",
  },
  {
    inset: "23%",
    duration: "9.4s",
    direction: "cr-rotate-ccw",
    color: "var(--ring-green)",
    size: "6px",
    delay: "-1.4s",
  },
  {
    inset: "28%",
    duration: "7.4s",
    direction: "cr-rotate-cw",
    color: "var(--ring-cyan-soft)",
    size: "4px",
    delay: "-2.2s",
  },
];

// Six core synapses (every 2nd is green — see the CSS `nth-child(2n)`).
const SYNAPSES = Array.from({ length: 6 }, (_, i) => ({
  angle: i * 60,
  delay: -(0.15 + i * 0.6),
}));

// Seventeen escape particles that burst outward on hover — angles/timings/drifts transcribed from
// the concept so the scatter reads as organic rather than evenly spaced.
const PARTICLES = [
  { angle: 4, delay: "-.2s", duration: "1.7s", drift: "7deg", size: "3px", green: false },
  { angle: 24, delay: "-1.1s", duration: "2.1s", drift: "-5deg", size: "2px", green: true },
  { angle: 43, delay: "-.7s", duration: "1.5s", drift: "8deg", size: "4px", green: false },
  { angle: 66, delay: "-1.4s", duration: "2.4s", drift: "4deg", size: "2px", green: false },
  { angle: 88, delay: "-.1s", duration: "1.9s", drift: "-7deg", size: "3px", green: true },
  { angle: 110, delay: "-1.5s", duration: "1.6s", drift: "6deg", size: "2px", green: false },
  { angle: 132, delay: "-.6s", duration: "2.2s", drift: "-4deg", size: "4px", green: false },
  { angle: 154, delay: "-1.2s", duration: "1.8s", drift: "8deg", size: "2px", green: true },
  { angle: 177, delay: "-.8s", duration: "2.5s", drift: "5deg", size: "3px", green: false },
  { angle: 198, delay: "-1.7s", duration: "1.7s", drift: "-6deg", size: "2px", green: false },
  { angle: 220, delay: "-.4s", duration: "2.1s", drift: "7deg", size: "4px", green: true },
  { angle: 242, delay: "-1.3s", duration: "1.6s", drift: "-8deg", size: "2px", green: false },
  { angle: 264, delay: "-.9s", duration: "2.3s", drift: "4deg", size: "3px", green: false },
  { angle: 287, delay: "-1.8s", duration: "1.8s", drift: "-5deg", size: "2px", green: true },
  { angle: 309, delay: "-.3s", duration: "2s", drift: "7deg", size: "4px", green: false },
  { angle: 333, delay: "-1.1s", duration: "1.6s", drift: "-6deg", size: "2px", green: false },
  { angle: 348, delay: "-.7s", duration: "2.4s", drift: "5deg", size: "3px", green: true },
];

const SPARK_THROTTLE_MS = 55;

export function CognitiveRing({
  size,
  interactive = true,
  paused = false,
  className,
}: CognitiveRingProps) {
  const prefersReducedMotion = useReducedMotion();
  const active = interactive && !prefersReducedMotion;

  const ringRef = useRef<HTMLDivElement | null>(null);
  const sparksRef = useRef<HTMLSpanElement | null>(null);

  // Pointer parallax + cursor sparks, wired imperatively so the sparks (short-lived DOM nodes that
  // self-remove on `animationend`) live in a dedicated layer React never reconciles — the `sparks`
  // span is always rendered childless, so React leaves the imperatively-appended nodes alone.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring || !active) return;

    let lastSpark = 0;

    const onMove = (event: PointerEvent) => {
      const rect = ring.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      ring.style.setProperty("--pointer-x", ((x / rect.width - 0.5) * 2).toFixed(3));
      ring.style.setProperty("--pointer-y", ((y / rect.height - 0.5) * 2).toFixed(3));

      const now = performance.now();
      if (now - lastSpark < SPARK_THROTTLE_MS) return;
      lastSpark = now;

      // Only spark when the cursor is over the active ring band (not the hollow centre or the edge).
      const distanceFromCenter = Math.hypot(x - rect.width / 2, y - rect.height / 2);
      const ringBand = rect.width * 0.34;
      if (Math.abs(distanceFromCenter - ringBand) >= rect.width * 0.11) return;

      const layer = sparksRef.current;
      if (!layer) return;
      const spark = document.createElement("i");
      spark.className = "cr-spark";
      spark.style.setProperty("--x", `${x}px`);
      spark.style.setProperty("--y", `${y}px`);
      spark.style.setProperty("--dx", `${(Math.random() - 0.5) * 42}px`);
      spark.style.setProperty("--dy", `${(Math.random() - 0.5) * 42}px`);
      spark.style.setProperty("--size", `${3 + Math.random() * 4}px`);
      spark.style.setProperty(
        "--spark-color",
        Math.random() > 0.34 ? "var(--ring-cyan)" : "var(--ring-green)",
      );
      spark.addEventListener("animationend", () => spark.remove(), { once: true });
      layer.appendChild(spark);
    };

    const onLeave = () => {
      ring.style.setProperty("--pointer-x", "0");
      ring.style.setProperty("--pointer-y", "0");
    };

    ring.addEventListener("pointermove", onMove);
    ring.addEventListener("pointerleave", onLeave);
    return () => {
      ring.removeEventListener("pointermove", onMove);
      ring.removeEventListener("pointerleave", onLeave);
      // Clear any in-flight sparks and reset the tilt when interaction is torn down.
      sparksRef.current?.replaceChildren();
      ring.style.setProperty("--pointer-x", "0");
      ring.style.setProperty("--pointer-y", "0");
    };
  }, [active]);

  const rootStyle =
    size === undefined
      ? undefined
      : ringVars({ "--ring-size": typeof size === "number" ? `${size}px` : size });

  return (
    <div
      ref={ringRef}
      className={cn("cognitive-ring", className)}
      style={rootStyle}
      aria-hidden="true"
      data-testid="cognitive-ring"
      data-paused={paused ? "true" : undefined}
    >
      <div className="cr-layer cr-telemetry" />
      <div className="cr-layer cr-reasoning" />
      <div className="cr-memory" />
      <div className="cr-layer cr-spokes" />
      <div className="cr-layer cr-scanner" />

      <div className="cr-cardinals">
        {CARDINAL_ANGLES.map((angle) => (
          <i key={angle} className="cr-cardinal" style={ringVars({ "--angle": `${angle}deg` })} />
        ))}
      </div>

      <div className="cr-nodes">
        {NODES.map((node) => (
          <i
            key={node.angle}
            className="cr-node"
            style={ringVars({ "--angle": `${node.angle}deg`, "--delay": `${node.delay}s` })}
          />
        ))}
      </div>

      <div className="cr-packets">
        {PACKET_TRACKS.map((track) => (
          <div
            key={track.inset}
            className="cr-packet-track"
            style={ringVars({
              "--track-inset": track.inset,
              "--duration": track.duration,
              "--direction": track.direction,
            })}
          >
            <i
              className="cr-packet"
              style={ringVars({
                "--packet-color": track.color,
                "--size": track.size,
                "--delay": track.delay,
              })}
            />
          </div>
        ))}
      </div>

      <div className="cr-core">
        {SYNAPSES.map((synapse) => (
          <i
            key={synapse.angle}
            className="cr-synapse"
            style={ringVars({ "--angle": `${synapse.angle}deg`, "--delay": `${synapse.delay}s` })}
          />
        ))}
      </div>

      <div className="cr-particles">
        {PARTICLES.map((particle) => (
          <i
            key={particle.angle}
            className="cr-particle"
            style={ringVars({
              "--angle": `${particle.angle}deg`,
              "--delay": particle.delay,
              "--duration": particle.duration,
              "--drift": particle.drift,
              "--particle-size": particle.size,
              ...(particle.green ? { "--particle-color": "var(--ring-green)" } : {}),
            })}
          />
        ))}
      </div>

      {/* Dedicated, always-childless layer for imperatively-appended cursor sparks. */}
      <span ref={sparksRef} className="cr-sparks" />
    </div>
  );
}
