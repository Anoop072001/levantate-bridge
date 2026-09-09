export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M4 20.5C8 14 12.5 11 16 11s8 3 12 9.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M6.5 22.5c3.2-5 6.8-7.5 9.5-7.5s6.3 2.5 9.5 7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M16 8v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="6.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
