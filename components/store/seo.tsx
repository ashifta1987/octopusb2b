import Link from 'next/link';

/** Pipe-separated CMS blocks: "Title|Body|…" → parts (SPEC §8.4: copy lives in content_blocks). */
export function parts(blocks: Record<string, string>, key: string, fallback = ''): string[] {
  return (blocks[key] ?? fallback).split('|').map((s) => s.trim());
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Renders a JSON-LD script safely (escapes `<` so CMS text can't close the tag). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      <ol className="flex flex-wrap gap-1.5 items-center">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {it.href && i < items.length - 1 ? <Link href={it.href} className="hover:text-coral-text">{it.name}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined} className="text-ink font-medium">{it.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function breadcrumbLd(items: { name: string; href?: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, ...(it.href ? { item: `${SITE_URL}${it.href}` } : {}) })),
  };
}

/** Plain-text CMS body → paragraphs (no HTML injection). */
export function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-4 text-[16px] leading-7 text-black">
      {text.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
    </div>
  );
}
