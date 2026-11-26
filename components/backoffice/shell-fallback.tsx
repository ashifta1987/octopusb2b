/** Static skeleton shown while the session-dependent portal shell streams in (App shell: white sidebar + top bar). */
export function ShellFallback() {
  return (
    <div className="min-h-screen bg-pearl md:grid md:grid-cols-[264px_minmax(0,1fr)]" aria-busy="true" aria-live="polite">
      <div className="hidden md:block min-h-screen bg-white border-r border-line" />
      <div className="min-w-0">
        <div className="h-[75px] bg-white border-b border-line" />
        <div className="px-4 sm:px-8 lg:px-12 py-9 space-y-4">
          <div className="flex items-center gap-4"><div className="w-[52px] h-[52px] rounded-[14px] bg-tint" /><div className="h-9 w-64 rounded bg-line animate-pulse" /></div>
          <div className="h-5 w-96 max-w-full rounded bg-line animate-pulse" />
          <div className="h-64 rounded-[16px] bg-white border border-line" />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    </div>
  );
}
