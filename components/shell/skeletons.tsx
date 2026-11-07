/**
 * Placeholder blocks shaped like the real content (no blank "Loading…" screens). Pure markup, no data.
 * `Bar` = one grey line; sizes follow the account layout (header, tabs, side menu, page title, cards, table rows).
 */
const Bar = ({ w = '100%', h = 14, className = '' }: { w?: string | number; h?: number; className?: string }) => (
  <span className={`block rounded-md bg-[#E6E9EF] animate-pulse ${className}`} style={{ width: w, height: h }} aria-hidden />
);

export function PageSkeleton({ cards = 2, table = true }: { cards?: number; table?: boolean }) {
  return (
    <div className="max-w-[1160px]" aria-busy="true" aria-label="Loading">
      <Bar w={110} h={11} />
      <Bar w={320} h={34} className="mt-2" />
      <Bar w={520} h={14} className="mt-3 max-w-full" />
      <div className={`grid gap-5 mt-6 ${cards > 1 ? 'lg:grid-cols-2' : ''}`}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="card p-5 space-y-3"><Bar w="40%" h={18} /><Bar w="70%" h={28} /><Bar w="90%" /><Bar w="60%" /></div>
        ))}
      </div>
      {table && (
        <div className="card mt-6 overflow-hidden">
          <div className="px-5 py-4"><Bar w={180} h={18} /></div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex gap-6 px-5 py-3.5 border-t border-line"><Bar w="14%" /><Bar w="38%" /><Bar w="16%" /><Bar w="12%" /></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountShellSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F6F8]" aria-busy="true" aria-label="Loading your account">
      <div className="bg-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-5">
          <Bar w={150} h={44} />
          <Bar w={520} h={44} className="hidden lg:block flex-1 max-w-[560px]" />
          <div className="ml-auto flex items-center gap-3"><Bar w={110} h={44} className="hidden sm:block" /><Bar w={44} h={44} /><Bar w={44} h={44} className="!rounded-full" /></div>
        </div>
      </div>
      <div className="bg-white border-b border-line">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 flex gap-6 h-[48px] items-center overflow-hidden">
          {[60, 80, 110, 120, 120, 150].map((w, i) => <Bar key={i} w={w} h={14} className="shrink-0" />)}
        </div>
      </div>
      <div className="max-w-[1440px] mx-auto flex">
        <aside className="hidden md:block w-[236px] shrink-0 border-r border-line bg-white min-h-[calc(100vh-130px)] px-3 py-7 space-y-3">
          <Bar w={90} h={11} /><Bar h={44} /><Bar h={20} w="70%" /><Bar h={20} w="60%" /><Bar h={20} w="75%" /><Bar h={20} w="65%" />
        </aside>
        <main className="flex-1 min-w-0 px-4 sm:px-8 py-8"><PageSkeleton /></main>
      </div>
    </div>
  );
}
