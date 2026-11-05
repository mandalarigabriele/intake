/** Stylized plate: two concentric circles and a short arc, in the accent color. */
export function Logo({ size = 22, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill={filled ? "var(--color-surface)" : "none"} stroke="var(--color-accent)" strokeWidth={filled ? 2 : 2.5} />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--color-accent)" strokeWidth={filled ? 1.6 : 2} />
      <path d="M10.5 12.5a7 7 0 0 1 5.5-4" fill="none" stroke="var(--color-accent)" strokeWidth={filled ? 1.6 : 2} strokeLinecap="round" />
    </svg>
  );
}
