// Small inline SVG marks (no icon fonts, no network requests).

/** The brand glyph: a gear with a crank arm and handle, as in favicon.svg. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const teeth = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="brand-mark"
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="3.5"
        className="bm-plate"
      />
      <g transform="translate(13.5 18)">
        {teeth.map((angle) => (
          <rect
            key={angle}
            x="-1.3"
            y="-9.4"
            width="2.6"
            height="3"
            rx="0.5"
            transform={`rotate(${angle})`}
            className="bm-gear"
          />
        ))}
        <circle r="7" className="bm-gear-ring" />
        <circle r="2.1" className="bm-hub" />
      </g>
      <path d="M13.5 18 L24.5 9.5" className="bm-arm" />
      <circle cx="24.5" cy="9.5" r="2.6" className="bm-knob" />
    </svg>
  );
}

export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** Joint symbols, matching the renderer's legend in viewer/scene.ts. */
export function JointIcon({ type }: { type: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="joint-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {type === 'revolute' ? (
        <>
          <circle cx="8" cy="8" r="4.6" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
        </>
      ) : type === 'prismatic' ? (
        <>
          <rect x="1.5" y="5.5" width="13" height="5" rx="2.5" />
          <rect
            x="6"
            y="6.8"
            width="4"
            height="2.4"
            rx="0.6"
            fill="currentColor"
            stroke="none"
          />
        </>
      ) : type === 'fixed' ? (
        <path d="M8 2.8 L13.2 8 L8 13.2 L2.8 8 Z" />
      ) : (
        <path d="M1.5 8 H3.5 L5 4.5 L7 11.5 L9 4.5 L11 11.5 L12.5 8 H14.5" />
      )}
    </svg>
  );
}
