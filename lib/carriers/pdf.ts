/**
 * Warehouse OS · W4 — a tiny PDF writer for 100 × 150 mm parcel labels (no dependency). Helvetica text, filled rectangles and a
 * Code 128 barcode drawn as bars. Text is reduced to printable ASCII (accents dropped, other characters become "?").
 */
import { canEncode128, code128Widths } from '@/lib/barcode128';

export const LABEL_W = 283.46; // 100 mm in points
export const LABEL_H = 425.2; // 150 mm

export type PdfOp =
  | { t: 'text'; x: number; y: number; size: number; text: string; bold?: boolean; white?: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'stroke'; x: number; y: number; w: number; h: number }
  | { t: 'barcode'; x: number; y: number; w: number; h: number; value: string };

export function pdfAscii(s: string): string {
  return s.replace(/[·•]/g, '-').replace(/[–—]/g, '-').replace(/[×]/g, 'x').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
}
const esc = (s: string) => pdfAscii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function renderOps(ops: PdfOp[]): string {
  const out: string[] = ['0 g'];
  for (const o of ops) {
    if (o.t === 'text') {
      out.push(`${o.white ? '1 g ' : ''}BT /${o.bold ? 'F2' : 'F1'} ${n(o.size)} Tf ${n(o.x)} ${n(o.y)} Td (${esc(o.text)}) Tj ET${o.white ? ' 0 g' : ''}`);
    } else if (o.t === 'rect') {
      out.push(`${n(o.x)} ${n(o.y)} ${n(o.w)} ${n(o.h)} re f`);
    } else if (o.t === 'stroke') {
      out.push(`1 w ${n(o.x)} ${n(o.y)} ${n(o.w)} ${n(o.h)} re S`);
    } else if (o.t === 'barcode' && canEncode128(o.value)) {
      const widths = code128Widths(o.value);
      const modules = widths.reduce((a, b) => a + b, 0);
      const m = o.w / modules;
      let x = o.x;
      widths.forEach((w, i) => {
        if (i % 2 === 0) out.push(`${n(x)} ${n(o.y)} ${n(w * m)} ${n(o.h)} re f`);
        x += w * m;
      });
    }
  }
  return out.join('\n');
}

/** One-page PDF (bytes) from drawing operations. */
export function buildPdf(ops: PdfOp[], title: string, width = LABEL_W, height = LABEL_H): Uint8Array {
  const content = renderOps(ops);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width)} ${n(height)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${esc(title)}) /Producer (Octopus B2B Warehouse OS) >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // every character is ASCII, so string length = byte length (the xref offsets are exact)
  return new TextEncoder().encode(body);
}
