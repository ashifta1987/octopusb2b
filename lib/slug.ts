/**
 * Shared slug builder for public Sourcing product URLs (/p/<slug>).
 * Strips Sourcing SKUs (cn-xx-...), supplier/manufacturer codes (oct-..., bwj),
 * factory model tokens, and appends a short random/deterministic opaque suffix
 * to avoid collisions without leaking internal identifiers.
 */

function toSlugPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractForbiddenSlugTokens(values: (string | null | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const raw of values) {
    if (!raw) continue;
    const norm = toSlugPart(String(raw));
    if (!norm) continue;
    tokens.add(norm);
    // For compound factory_model strings like "P07 Humidifier" or "S1PRO香薰机" (never CN-XX-... SKUs which can contain words like "tpe" or "band"),
    // extract alphanumeric model-code segments containing digits so leading/embedded factory model tokens are stripped cleanly.
    if (!/^cn-[a-z]{2}-|^oct-/.test(norm)) {
      for (const p of norm.split('-').filter(Boolean)) {
        if (p.length >= 2 && /\d/.test(p) && !/^\d+(w|v|a|g|l|ml|mah|rpm|mm|cm|kg|hour)$/.test(p)) {
          tokens.add(p);
          const m = /^([a-z]+\d+)(pro|max|plus|mini)$/i.exec(p);
          if (m) tokens.add(`${m[1]}-${m[2]}`);
        }
      }
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

export function cleanProductSlug(
  title: string,
  forbiddenValues: (string | null | undefined)[] = [],
  suffix?: string,
): string {
  let slug = toSlugPart(title || '');

  // Strip structured SKU / supplier code patterns regardless of explicit token list
  slug = slug
    .replace(/(^|-)cn-[a-z]{2}-[a-z0-9-]+(?=$)/g, '')
    .replace(/(^|-)cn-[a-z]{2}-[a-z0-9]+/g, '')
    .replace(/(^|-)oct-[a-z0-9-]+/g, '');

  const tokens = extractForbiddenSlugTokens(forbiddenValues);
  for (const tok of tokens) {
    const re = new RegExp(`(^|-)${escapeRegex(tok)}(?=-|$)`, 'g');
    slug = slug.replace(re, '$1');
  }

  slug = slug.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  // Trim at hyphen boundary <= 76 chars so random suffix fits cleanly
  if (slug.length > 76) {
    const cut = slug.slice(0, 76);
    const lastDash = cut.lastIndexOf('-');
    slug = (lastDash >= 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '');
  }
  if (!slug) slug = 'product';

  const tag = toSlugPart(suffix || globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)) || '00000001';
  return `${slug}-${tag}`;
}
