import type { Metadata } from 'next';
import { TurnkeyListView } from '@/app/ods/shop/turnkey/_components/turnkey-list-view';
import { TurnkeyProjectView } from '@/app/ods/shop/turnkey/_components/turnkey-project-view';
import { TurnkeyStartForm } from '@/app/ods/shop/turnkey/_components/start-form';
import { TURNKEY_DRAFT_REASON, TURNKEY_FILES_REASON } from '@/app/ods/shop/turnkey/_lib/turnkey-logic';
import { ShopFixtureFrame, ShopFixtureState } from '../shop-services/_fixture-frame';
import { sampleTurnkeySubmit } from '../shop-services/fixture-actions';
import { SAMPLE_INCLUDED, SAMPLE_PROJECT, SAMPLE_TURNKEY } from '../shop-services/_samples';

export const metadata: Metadata = { title: 'Shop · Turnkey · ODS fixtures (staging)', robots: { index: false, follow: false } };

/** /shop/turnkey, /shop/turnkey/[slug] and /start (Shop_Turnkey) with sample props. */
export default function ShopTurnkeyFixtures() {
  return (
    <ShopFixtureFrame current="turnkey" title="Turnkey projects" intro="Ready projects, a project page and the start form (as on the real page, and with a refused file). Send uses a stand-in that writes nothing.">
      <ShopFixtureState id="list" label="Ready projects" note="/shop/turnkey">
        <TurnkeyListView titleLevel={2} items={SAMPLE_TURNKEY} total={SAMPLE_TURNKEY.length} page={1} pages={1} />
      </ShopFixtureState>
      <ShopFixtureState id="list-empty" label="No projects listed">
        <TurnkeyListView titleLevel={2} items={[]} total={0} page={1} pages={1} />
      </ShopFixtureState>
      <ShopFixtureState id="project" label="Project page" note="/shop/turnkey/[slug] — What's included, Price, How it works.">
        <TurnkeyProjectView titleLevel={2} project={SAMPLE_PROJECT} included={SAMPLE_INCLUDED} />
      </ShopFixtureState>
      <ShopFixtureState id="start" label="Start form" note="/shop/turnkey/[slug]/start — files and Save draft are disabled with the reason (no backend for them today).">
        <TurnkeyStartForm
          headingLevel={2}
          project={{ id: SAMPLE_PROJECT.id, title: SAMPLE_PROJECT.title }}
          defaultCountry="AE"
          submit={sampleTurnkeySubmit}
          files={{ enabled: false, reason: TURNKEY_FILES_REASON }}
          draftDisabledReason={TURNKEY_DRAFT_REASON}
        />
      </ShopFixtureState>
      <ShopFixtureState id="start-file-error" label="Start form: a file refused" note="FileDrop state for a file over 20 MB (shown with the drop zone switched on).">
        <TurnkeyStartForm
          headingLevel={2}
          project={null}
          defaultCountry=""
          submit={sampleTurnkeySubmit}
          files={{ enabled: true }}
          initialFiles={[
            { id: 'f1', name: 'logo.pdf', size: 1_250_000, status: 'done' },
            { id: 'f2', name: 'factory-drawings.zip', size: 26_000_000, status: 'error', error: 'This file is bigger than 20 MB. Make it smaller or send it to your account manager.' },
          ]}
          draftDisabledReason={TURNKEY_DRAFT_REASON}
        />
      </ShopFixtureState>
    </ShopFixtureFrame>
  );
}
