/**
 * Tiny JSON-Schema helpers for the Postman generator and unit tests (no extra packages).
 *  - deref(): inlines `#/components/schemas/*` refs into a self-contained schema that Postman's
 *    `pm.response.to.have.jsonSchema()` (Ajv, draft-07) accepts; drops doc-only keywords.
 *  - validate(): validates the subset of JSON Schema used by lib/api/openapi.ts.
 */
type Schema = Record<string, unknown>;

const DOC_KEYS = new Set(['description', 'example', 'examples', 'format', 'default', '$schema', 'title', 'deprecated', 'readOnly', 'writeOnly']);

export function deref(s: unknown, components: Record<string, unknown>, seen: string[] = []): unknown {
  if (Array.isArray(s)) return s.map((x) => deref(x, components, seen));
  if (!s || typeof s !== 'object') return s;
  const o = s as Schema;
  if (typeof o.$ref === 'string') {
    const name = o.$ref.split('/').pop()!;
    if (seen.includes(name)) throw new Error(`Recursive schema ${name}`);
    if (!(name in components)) throw new Error(`Unknown schema ref ${o.$ref}`);
    return deref(components[name], components, [...seen, name]);
  }
  const out: Schema = {};
  for (const [k, v] of Object.entries(o)) {
    if (DOC_KEYS.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v as Schema).map(([pk, pv]) => [pk, deref(pv, components, seen)]));
    } else out[k] = deref(v, components, seen);
  }
  return out;
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function matchesType(v: unknown, t: string) {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number';
  return typeOf(v) === t;
}

export function validate(schema: unknown, value: unknown, path = '$'): string[] {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${path}: not allowed`];
  const s = schema as Schema;
  const errs: string[] = [];
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => matchesType(value, t))) return [`${path}: expected ${types.join('|')}, got ${typeOf(value)}`];
  }
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value)) errs.push(`${path}: expected const ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errs.push(`${path}: < minimum ${s.minimum}`);
    if (typeof s.maximum === 'number' && value > s.maximum) errs.push(`${path}: > maximum ${s.maximum}`);
  }
  if (Array.isArray(s.allOf)) for (const sub of s.allOf) errs.push(...validate(sub, value, path));
  if (Array.isArray(s.anyOf) && !s.anyOf.some((sub) => validate(sub, value, path).length === 0)) errs.push(`${path}: matches none of anyOf`);
  if (Array.isArray(s.oneOf) && s.oneOf.filter((sub) => validate(sub, value, path).length === 0).length !== 1) errs.push(`${path}: must match exactly one of oneOf`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) errs.push(`${path}: missing required "${r}"`);
    const props = (s.properties as Schema | undefined) ?? {};
    for (const [k, v] of Object.entries(o)) {
      if (k in props) errs.push(...validate(props[k], v, `${path}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${path}: unexpected property "${k}"`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') errs.push(...validate(s.additionalProperties, v, `${path}.${k}`));
    }
  }
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errs.push(...validate(s.items, v, `${path}[${i}]`)));
  return errs;
}
