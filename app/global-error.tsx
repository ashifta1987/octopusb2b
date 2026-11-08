'use client';
import { BRAND } from '@/lib/brand';

/** Last-resort error page when the root layout itself fails (SPEC §8.4). Renders its own document. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', color: BRAND.black, background: BRAND.pearl, margin: 0 }}>
        <main role="alert" style={{ maxWidth: 520, margin: '96px auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>This page could not be loaded</h1>
          <p style={{ color: BRAND.muted }}>Something went wrong on our side. Please try again.</p>
          <button type="button" onClick={() => retry()} style={{ background: BRAND.coral, color: '#fff', border: 0, borderRadius: 6, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
