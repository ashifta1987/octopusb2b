/** Static skeleton shown while the session-dependent portal shell streams in. */
export function ShellFallback() {
  return (
    <div className="min-h-screen bg-pearl" aria-busy="true" aria-live="polite">
      <div className="h-[69px] bg-white border-b border-line" />
      <div className="flex">
        <div className="hidden md:block w-[250px] min-h-[calc(100vh-69px)] bg-ink" />
        <div className="flex-1 px-8 py-8 space-y-4">
          <div className="h-9 w-64 rounded bg-line animate-pulse" />
          <div className="h-5 w-96 rounded bg-line animate-pulse" />
          <div className="h-64 rounded-[12px] bg-white border border-line" />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    </div>
  );
}
