import { cx, Icon } from '@octopus/ui';
import { SITE_SERVICES } from './services';

/**
 * Hero picture (desktop only): a drawing of the Shop main page with its six coloured sections, built from tokens —
 * no screenshot or stock photo. One image to assistive tech (role="img" + label).
 */
export function ShopPicture() {
  return (
    <div role="img" aria-label="The shop after you sign in: one page with six coloured sections" className="overflow-hidden rounded-ods-card bg-ods-surface shadow-ods-dialog">
      <div className="flex items-center gap-2 border-b border-ods-line bg-ods-canvas px-3 py-2">
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-ods-line-strong" />
          <span className="size-2 rounded-full bg-ods-line-strong" />
          <span className="size-2 rounded-full bg-ods-line-strong" />
        </span>
        <span className="rounded-ods-control bg-ods-surface px-2 py-0.5 text-ods-small text-ods-slate">Shop · All products</span>
      </div>
      <div className="grid gap-2 p-3">
        {SITE_SERVICES.map((s) => (
          <div key={s.slug} className={cx('rounded-ods-control border-s-4 p-2', s.cls.border, s.cls.tint)}>
            <p className={cx('flex items-center gap-1.5 text-ods-small font-bold', s.cls.text)}>
              <Icon icon={s.icon} size="xs" />
              {s.name}
            </p>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-6 rounded-[4px] bg-ods-surface" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
