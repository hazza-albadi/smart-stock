import { T } from "./T";

export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold">
      <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden><rect width="34" height="34" rx="9" fill="var(--brand)" /><path d="M6 20c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeWidth="2.2" strokeLinecap="round" /><path d="M6 13c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" /></svg>
      <span>{T("site.brand")}</span>
    </span>
  );
}
