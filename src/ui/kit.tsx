import type { ReactNode } from 'react';

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
      </svg>
    </span>
  );
}

export function Stat({
  value,
  unit,
  label,
  className = '',
}: {
  value: ReactNode;
  unit?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export type Option<T extends string> = { value: T; label: string; disabled?: boolean };
/** A single-choice radio group drawn as a pill switcher. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const enabled = options.filter((x) => !x.disabled);
            const i = enabled.findIndex((x) => x.value === value);
            const next =
              enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
            onChange(next.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
