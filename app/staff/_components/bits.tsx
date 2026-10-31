/** Presentational pieces shared by server pages and client forms (no server imports). */
export function StaffHeading({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="m-0 font-display font-extrabold text-[30px] leading-[1.15]">{title}</h2>
      {hint && <span className="text-[13px] text-muted leading-[1.45]">{hint}</span>}
    </div>
  );
}

export function LockNotice({ children }: { children: React.ReactNode }) {
  return <div className="border border-[#F3D9A6] bg-[#FFF8EB] rounded-[10px] px-3.5 py-3 text-[13px] leading-[1.45] text-[#6B4A07]">{children}</div>;
}

