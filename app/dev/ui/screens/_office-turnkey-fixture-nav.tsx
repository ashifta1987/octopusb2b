/** Staging fixture state switcher (server-safe): rows of links that keep the other query params. Sample data only. */
export function FixtureNav({ base, current, groups }: { base: string; current: Record<string, string>; groups: { key: string; label: string; options: readonly (readonly [string, string])[] }[] }) {
  const link = (k: string, v: string) => `${base}?${new URLSearchParams({ ...current, [k]: v }).toString()}`;
  return (
    <nav aria-label="Fixture states (sample data)" className="mb-3 grid gap-1.5">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      {groups.map((g) => (
        <ul key={g.key} aria-label={g.label} className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li className="text-ods-small font-semibold text-ods-slate">{g.label}:</li>
          {g.options.map(([id, l]) => (
            <li key={id}>
              <a href={link(g.key, id)} aria-current={current[g.key] === id ? 'page' : undefined}
                className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${current[g.key] === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}>{l}</a>
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );
}

export const pick = <T extends string>(v: string | string[] | undefined, list: readonly (readonly [T, string])[], dflt: T): T => {
  const s = Array.isArray(v) ? v[0] : v;
  return (list.find(([k]) => k === s)?.[0] ?? dflt) as T;
};
