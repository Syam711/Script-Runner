/* ===================================================================
   Icon library
   -------------------------------------------------------------------
   Every icon in the app comes from this file. They're inline SVG
   rather than an icon package so there's no extra dependency, the
   stroke weight stays consistent, and each one inherits currentColor
   from whatever it sits in.
   All icons share a 24x24 viewBox and 1.6 stroke so they optically
   match when placed side by side at the same size.
   Usage:  <Icon.Play size={16} />
   =================================================================== */

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
});

/* --- Brand ------------------------------------------------------- */

/**
 * The mark: a terminal chevron and cursor inside a rounded enclosure.
 * Reads as "a place where commands are sent" and stays legible at 20px.
 */
export function Logo({ size = 28, title = 'Relay' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
    >
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="8.5" fill="var(--jade-500)" />
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8.5"
        stroke="var(--jade-700)"
        strokeWidth="1.2"
      />
      <path
        d="M10 11.5 L14.75 16 L10 20.5"
        stroke="#FFFFFF"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.25 20.5 H22" stroke="#9FE8DE" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 28 }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wordmark-text">Relay</span>
    </span>
  );
}

/* --- UI icons ---------------------------------------------------- */

export const Icon = {
  Play: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M7 4.5 19 12 7 19.5 Z" fill="currentColor" stroke="none" />
    </svg>
  ),

  Stop: ({ size = 18 }) => (
    <svg {...base(size)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),

  Server: ({ size = 18 }) => (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="6.5" rx="1.8" />
      <rect x="3" y="13.5" width="18" height="6.5" rx="1.8" />
      <path d="M6.75 7.25h.01M6.75 16.75h.01" />
    </svg>
  ),

  Terminal: ({ size = 18 }) => (
    <svg {...base(size)}>
      <rect x="2.75" y="4" width="18.5" height="16" rx="2.4" />
      <path d="M7 10l2.75 2.5L7 15M12.75 15.5h4" />
    </svg>
  ),

  Script: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M6 3h8.5L19 7.5V21H6z" />
      <path d="M14 3v5h5M9 12.5h6M9 16.5h4" />
    </svg>
  ),

  History: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.2 4.6v4.2h4.2M12 7.75V12l3 1.75" />
    </svg>
  ),

  Shield: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M12 3l7 2.75v5.4c0 4.3-2.9 8.05-7 9.35-4.1-1.3-7-5.05-7-9.35v-5.4z" />
    </svg>
  ),

  Users: ({ size = 18 }) => (
    <svg {...base(size)}>
      <circle cx="9.25" cy="8.5" r="3.25" />
      <path d="M2.75 19.5c0-3.2 2.9-5.25 6.5-5.25s6.5 2.05 6.5 5.25" />
      <path d="M16.5 6.1a3.1 3.1 0 0 1 0 5.9M18 14.6c2.05.6 3.5 2.1 3.5 4.4" />
    </svg>
  ),

  Plus: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  ),

  Pencil: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M16.4 3.9a2.3 2.3 0 0 1 3.25 3.25L8 18.8l-4.3 1.05L4.75 15.5z" />
    </svg>
  ),

  Trash: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M4.5 6.75h15M9.5 6.75V4.9h5v1.85" />
      <path d="M6.75 6.75 7.6 20h8.8l.85-13.25M10.5 10.5v5.75M13.5 10.5v5.75" />
    </svg>
  ),

  Share: ({ size = 18 }) => (
    <svg {...base(size)}>
      <circle cx="17.5" cy="6" r="2.75" />
      <circle cx="6.5" cy="12" r="2.75" />
      <circle cx="17.5" cy="18" r="2.75" />
      <path d="M9 10.6 15 7.4M9 13.4l6 3.2" />
    </svg>
  ),

  Check: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M4.75 12.5 10 17.75 19.25 6.5" />
    </svg>
  ),

  X: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),

  ChevronLeft: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  ),

  ChevronRight: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  ),

  ChevronDown: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M5.5 9.5 12 16l6.5-6.5" />
    </svg>
  ),

  Clock: ({ size = 18 }) => (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7v5.25l3.25 1.9" />
    </svg>
  ),

  Alert: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M12 4.4 21 19.6H3z" />
      <path d="M12 10v3.75M12 16.9h.01" />
    </svg>
  ),

  Lock: ({ size = 18 }) => (
    <svg {...base(size)}>
      <rect x="4.75" y="10.5" width="14.5" height="9.75" rx="2.2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
    </svg>
  ),

  LogOut: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M14.5 4.75h3a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2h-3" />
      <path d="M10 8.25 13.75 12 10 15.75M13.25 12H4.5" />
    </svg>
  ),

  Search: ({ size = 18 }) => (
    <svg {...base(size)}>
      <circle cx="10.75" cy="10.75" r="6.5" />
      <path d="m15.6 15.6 4.4 4.4" />
    </svg>
  ),

  Sliders: ({ size = 18 }) => (
    <svg {...base(size)}>
      <path d="M4.5 7.5h10M18 7.5h1.5M4.5 16.5h3M11 16.5h8.5" />
      <circle cx="16" cy="7.5" r="2.1" />
      <circle cx="9" cy="16.5" r="2.1" />
    </svg>
  ),

  Empty: ({ size = 48 }) => (
    <svg {...base(size)} strokeWidth={1.1}>
      <rect x="2.75" y="5" width="18.5" height="14" rx="2.4" />
      <path d="M2.75 9.5h18.5" />
      <path d="M6.5 7.25h.01M9 7.25h.01" />
      <path d="M7.5 14h9" strokeDasharray="1.6 2.4" />
    </svg>
  ),
};

/* --- Status dot ---------------------------------------------------
   Used in the rail and on tables. `tone` maps to the semantic
   colours; `pulse` marks genuinely live state (a run in flight), so
   movement always means something is actually happening.           */
export function StatusDot({ tone = 'idle', pulse = false, label }) {
  return (
    <span
      className={`dot dot-${tone}${pulse ? ' dot-pulse' : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
