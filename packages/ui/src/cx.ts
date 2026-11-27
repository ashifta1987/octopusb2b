/** Join class names (falsy values dropped). Tokens-only styling: use ods-* utilities and var(--ods-*), never hex. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}
