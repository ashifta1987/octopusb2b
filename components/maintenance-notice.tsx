import { getSiteContent } from '@/lib/content';
import { cn } from '@/lib/cn';

type Maintenance = { enabled?: boolean; message?: string | null; retry_after?: number | null; since?: string | null };

/**
 * Maintenance notice (SPEC §16.3 step 4): shown on the storefront and portals while site_settings.maintenance_mode is on.
 * Pages stay browsable (read-only notice); the API returns 503 separately. Message comes from the CMS setting.
 */
export async function MaintenanceNotice({ variant = 'bar' }: { variant?: 'bar' | 'prominent' }) {
  const { settings } = await getSiteContent();
  const m = (settings.maintenance_mode ?? {}) as Maintenance;
  if (!m.enabled) return null;
  const minutes = m.retry_after ? Math.max(1, Math.round(m.retry_after / 60)) : null;
  const message = m.message?.trim() || 'We are performing scheduled maintenance. Please try again shortly.';
  return (
    <div role="status" aria-live="polite" className={cn('bg-[#FFF3D6] text-[#5C3D00] border-b border-warn/40', variant === 'prominent' ? 'py-3' : 'py-2')}>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="flex-none">
          <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        <span className="font-semibold">Maintenance in progress.</span>
        <span>{message}</span>
        {variant === 'prominent' && (
          <span className="text-[13px] opacity-80">You can keep browsing; ordering, payments and form submissions are paused{minutes ? ` for about ${minutes} minutes` : ''}.</span>
        )}
      </div>
    </div>
  );
}
