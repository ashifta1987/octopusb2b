import type { ReactNode } from 'react';
import { CircleAlert, Info, LogOut, TriangleAlert } from 'lucide-react';
import { Icon, cx } from '@octopus/ui';

export type AuthNoticeTone = 'info' | 'warning' | 'danger' | 'neutral';

const TONE: Record<AuthNoticeTone, { box: string; icon: typeof Info }> = {
  info: { box: 'border-ods-info/30 bg-ods-info-tint', icon: Info },
  warning: { box: 'border-ods-warning/40 bg-ods-warning-tint', icon: TriangleAlert },
  danger: { box: 'border-ods-danger/30 bg-ods-danger-tint', icon: CircleAlert },
  neutral: { box: 'border-ods-line bg-ods-canvas', icon: LogOut },
};

/**
 * Sign-in notice (States-Auth): icon + bold title + one line, tinted by tone (never colour alone: icon + words).
 * danger → role="alert"; others → role="status". `state` is exposed as data-state for e2e (data-testid="login-state" etc.).
 * Server-safe (no hooks).
 */
export function AuthNotice({
  tone = 'info', title, children, action, testId, state, headingLevel,
}: { tone?: AuthNoticeTone; title: ReactNode; children?: ReactNode; action?: ReactNode; testId?: string; state?: string; headingLevel?: 2 | 3 }) {
  const t = TONE[tone];
  const H = headingLevel ? (`h${headingLevel}` as 'h2' | 'h3') : 'p';
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId} data-state={state} className={cx('rounded-ods-card border p-4', t.box)}>
      <div className="flex items-start gap-3">
        <Icon icon={t.icon} size="md" className="mt-[0.15em] shrink-0 text-ods-navy" />
        <div className="min-w-0 flex-1">
          <H className="text-ods-body font-semibold text-ods-navy">{title}</H>
          {children ? <div className="mt-1 text-ods-small text-ods-text">{children}</div> : null}
          {action ? <div className="mt-3 flex flex-wrap gap-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Blue info box (Auth_SignIn bottom, Auth_Setup "Verify your company later"). */
export function InfoBox({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-ods-card bg-ods-blue-tint p-4 text-ods-small text-ods-text', className)}>
      <Icon icon={Info} size="sm" className="mt-[0.2em] shrink-0 text-ods-navy" />
      <div className="min-w-0">
        {title ? <p className="font-semibold text-ods-navy">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
