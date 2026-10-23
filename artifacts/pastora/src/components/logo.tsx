/**
 * The Pastora mark: an open doorway with warm light inside.
 *
 * Its colours come from the active palette (--logo-door / --logo-light in
 * index.css), so inside a workspace it matches the chosen theme. Visitors who have
 * never picked a theme see the default Warm Cream colours, which are the official
 * brand colours. The browser tab icon (public/favicon.svg) always uses those.
 *
 * When final logo artwork exists, replace the paths here and in favicon.svg.
 */
export function DoorMark({
  size = 30,
  threshold = true,
  className = "",
  title,
}: {
  size?: number;
  /** The soft light spilling onto the ground; hidden at very small sizes. */
  threshold?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`door-mark ${className}`}
      width={size}
      height={(size * 106) / 80}
      viewBox="-40 -42 80 106"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d="M-36 48 V-6 A36 36 0 0 1 36 -6 V48 Z" fill="var(--logo-door)" />
      <path d="M-16 48 V2 A16 16 0 0 1 16 2 V48 Z" fill="var(--logo-light)" />
      {threshold && <path d="M-16 48 L-40 64 H40 L16 48 Z" fill="var(--logo-light)" opacity="0.5" />}
    </svg>
  );
}
