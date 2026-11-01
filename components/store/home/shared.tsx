import Link from 'next/link';
import { parts } from '@/components/store/seo';

/** Pure helpers for the storefront home (Main.png). Server-safe, no data access. */

/** Replace `{key}` placeholders from `vars`; unknown placeholders are left as-is. */
export function fill(text: string, vars: Record<string, string | number | null | undefined>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null || vars[k] === '' ? m : String(vars[k])));
}

/** True when the text still contains an unfilled `{placeholder}` (so the item is hidden instead of showing a raw token). */
export const hasToken = (text: string) => /\{\w+\}/.test(text);

/** `parts()` for pipe-separated CMS copy, with placeholders filled. */
export function copy(blocks: Record<string, string>, key: string, fallback: string, vars: Record<string, string | number | null | undefined> = {}) {
  return parts(blocks, key, fallback).map((p) => fill(p, vars));
}

/** Render a CMS string with *emphasis* segments (used for the highlighted part of a headline). */
export function Emphasis({ text, className }: { text: string; className: string }) {
  return (
    <>
      {text.split(/(\*[^*]+\*)/g).filter(Boolean).map((seg, i) =>
        seg.startsWith('*') && seg.endsWith('*') ? <span key={i} className={className}>{seg.slice(1, -1)}</span> : <span key={i}>{seg}</span>)}
    </>
  );
}

/** Section heading row: h2 + optional "→" link (Main.png section header). */
export function SectionHead({ id, title, href, link, size = 'lg' }: { id?: string; title: string; href?: string; link?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={`flex flex-wrap justify-between items-end gap-4 ${size === 'lg' ? 'mb-6' : 'mb-5'}`}>
      <h2 id={id} className={`font-extrabold leading-[1.1] tracking-[-0.02em] ${size === 'lg' ? 'text-[28px] sm:text-[34px]' : 'text-[24px] sm:text-[28px]'}`}>{title}</h2>
      {href && link && <Link href={href} className="font-semibold text-blue text-[14px] sm:text-[15px]">{link} <span aria-hidden>→</span></Link>}
    </div>
  );
}

export const n = (v: number) => v.toLocaleString('en-US');
