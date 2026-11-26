/** Presentational pieces shared by server pages and client forms (no server imports). */
export function StaffHeading({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="m-0 font-display font-extrabold text-[30px] sm:text-[34px] leading-[1.15] text-ink">{title}</h2>
      {hint && <span className="text-[16px] text-muted leading-[1.5]">{hint}</span>}
    </div>
  );
}

export function LockNotice({ children }: { children: React.ReactNode }) {
  return <div className="border border-warn-line bg-warn-bg rounded-[10px] px-3.5 py-3 text-[14px] leading-[1.45] text-warn">{children}</div>;
}
