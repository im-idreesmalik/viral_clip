/**
 * The ViralCut scissors mark (white strokes, uses currentColor). Rendered inside
 * the gradient logo tile across the app so the on-site logo matches the favicon
 * (app/icon.svg) exactly — required for TikTok/Meta app review consistency.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" className={className}>
      <g stroke="currentColor" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="168" cy="342" r="46" />
        <circle cx="344" cy="342" r="46" />
        <line x1="205" y1="312" x2="392" y2="150" />
        <line x1="307" y1="312" x2="120" y2="150" />
      </g>
    </svg>
  );
}
