/**
 * The Pastora mark: a compass whose needle is two leaves — direction that grows.
 * The gold leaf points north (guidance); the green leaf grounds it (care, rootedness).
 *
 * Colours come from the active palette (--logo-ring / --logo-north / --logo-south in
 * index.css), so inside a workspace the mark matches the chosen theme. Visitors who
 * have never picked a theme see Warm Cream, the official brand colours, which the
 * browser tab icon (public/favicon.svg) always uses.
 *
 * When final logo artwork exists, replace the paths here and in favicon.svg.
 */
export function PastoraMark({
  size = 30,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`pastora-mark ${className}`}
      width={size}
      height={size}
      viewBox="-40 -40 80 80"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <circle r="36" fill="none" stroke="var(--logo-ring)" strokeWidth="4.5" />
      <g transform="rotate(35)">
        <path d="M0 -29 C11 -15 9 -4 0 0 C-9 -4 -11 -15 0 -29 Z" fill="var(--logo-north)" />
        <path d="M0 29 C11 15 9 4 0 0 C-9 4 -11 15 0 29 Z" fill="var(--logo-south)" />
      </g>
      <circle r="3.5" fill="hsl(var(--background))" />
    </svg>
  );
}
