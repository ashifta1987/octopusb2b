import Link from 'next/link';
import { copy } from './shared';
import { TrackSlot } from './banner-rotator';
import { AnnouncementRotator } from './announcement-rotator';

type Blocks = Record<string, string>;
type Vars = Record<string, string | number | null | undefined>;

/** One announcement line: "label · text|link text|href" (label shown as a NEW-style pill). */
function AnnouncementLine({ raw }: { raw: string[] }) {
  const [text, linkText, href] = raw;
  const [pill, ...rest] = text.split(' · ');
  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-center" data-testid="announcement">
      {rest.length > 0 && <span className="mono text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-new-bg text-ink">{pill}</span>}
      <span>{rest.length ? rest.join(' · ') : text}</span>
      {linkText && href && /^(\/|https:\/\/)/.test(href) && <Link href={href} className="inline-flex items-center min-h-6 font-semibold text-on-ink-link hover:text-white underline-offset-2 hover:underline">{linkText}</Link>}
    </div>
  );
}

/**
 * ADDON-32 §1a + ADDON-44-D — dark announcement bar. Lines from content blocks `home.announcement.mmb` (Make My Brand) and
 * `home.announcement` (Turnkey), each "label · text|link text|href"; they rotate. Switch home.announcement_enabled.
 * `skipTurnkey` drops a line that mentions Turnkey when Turnkey is switched off.
 */
export function AnnouncementBar({ blocks, vars, skipTurnkey = false }: { blocks: Blocks; vars: Vars; skipTurnkey?: boolean }) {
  const lines = [
    copy(blocks, 'home.announcement.mmb', 'New · Make My Brand: your logo on verified products, stocked in our warehouse, shipped worldwide.|See how it works →|/make-my-brand', vars),
    copy(blocks, 'home.announcement', '', vars),
  ].filter((l) => l[0] && !(skipTurnkey && /turnkey/i.test(l.join(' '))));
  if (!lines.length) return null;
  return (
    <TrackSlot slot="announcement" className="bg-ink text-white text-[13.5px]">
      {lines.length === 1 ? <AnnouncementLine raw={lines[0]} /> : <AnnouncementRotator lines={lines.map((l, i) => <AnnouncementLine key={i} raw={l} />)} />}
    </TrackSlot>
  );
}
