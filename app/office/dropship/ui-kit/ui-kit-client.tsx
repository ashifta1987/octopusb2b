'use client';

import { useState } from 'react';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsCheckbox,
  DsChip,
  DsDialog,
  DsEmptyState,
  DsInput,
  DsLinkButton,
  DsNotice,
  DsOrderStatusBadge,
  DsPageHeader,
  DsPriceBreakdown,
  DsRadioCard,
  DsSelect,
  DsSkeleton,
  DsStepper,
  DsSwitch,
  DsTableCard,
  DsTextarea,
  DsTimeline,
  DsToast,
} from '@/components/dropship-ui';

const COLOUR_SWATCHES = [
  { hex: '#1A174A', name: 'Navy', desc: 'Sidebar, headings, selected chips', darkText: false },
  { hex: '#2A6FD1', name: 'Button blue', desc: 'Primary buttons, links, focus ring, current step', darkText: false },
  { hex: '#0B7A75', name: 'Success teal', desc: 'Done, paid, in stock', darkText: false },
  { hex: '#B42318', name: 'Danger red', desc: 'Destructive buttons, blocking errors', darkText: false },
  { hex: '#F4F6F9', name: 'Page background', desc: 'App background', darkText: true },
  { hex: '#E3E7EF', name: 'Border', desc: 'Cards, tables, dividers', darkText: true },
  { hex: '#5B6478', name: 'Muted text', desc: 'Secondary text; 5.9:1 on white', darkText: false },
];

export function UiKitClient() {
  const [chipActive, setChipActive] = useState<'all' | 'review' | 'drafts'>('review');
  const [switchSync, setSwitchSync] = useState(true);
  const [dutyMode, setDutyMode] = useState('ddp');

  return (
    <div data-testid="dropship-ui-kit" className="flex flex-col gap-6">
      <DsPageHeader
        title="Components and specs"
        subtitle="Everything Antigravity needs to build the screens the same way: tokens, components and their states."
        icon="sparkle"
      />

      {/* Colours */}
      <DsCard title="Colours" icon="sparkle">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
          {COLOUR_SWATCHES.map((s) => (
            <div
              key={s.hex}
              className="border border-[#E3E7EF] rounded-[12px] overflow-hidden bg-white"
            >
              <div
                style={{
                  background: s.hex,
                  color: s.darkText ? '#1A174A' : '#FFFFFF',
                }}
                className="h-16 flex items-end px-2.5 py-2 font-mono text-[12px] font-semibold"
              >
                {s.hex}
              </div>
              <div className="px-3 py-2.5 text-[13px] leading-[1.45]">
                <strong>{s.name}</strong>
                <div className="ds-mut">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </DsCard>

      {/* Type: Inter & Spacing and size */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsCard title="Type: Inter" icon="file">
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                H1 · 26/700
              </span>
              <span className="text-[26px] font-bold">Find products</span>
            </div>
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                H2 · 18/700
              </span>
              <span className="text-[18px] font-bold">Landed cost by country</span>
            </div>
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                Body · 14/400
              </span>
              <span className="text-[14px]">
                Prices include shipping and duties to the country you pick.
              </span>
            </div>
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                Small · 13/400
              </span>
              <span className="text-[13px] text-[#5B6478]">
                Sourced from your request
              </span>
            </div>
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                Label · 12/600
              </span>
              <span className="text-[12px] font-semibold text-[#5B6478]">
                CUSTOMS CODE (HS)
              </span>
            </div>
            <div className="flex gap-4 items-baseline border-b border-[#EEF0F4] pb-2 flex-wrap">
              <span className="ds-mut font-mono text-[12px] font-semibold w-[140px]">
                Number · 30/700
              </span>
              <span className="text-[30px] font-bold">Calculated at checkout</span>
            </div>
          </div>
        </DsCard>

        <DsCard title="Spacing and size" icon="layers">
          <div className="flex gap-3.5 items-end flex-wrap">
            {[4, 8, 12, 16, 20, 24, 32, 40].map((px) => (
              <div key={px} className="text-center text-[12px] ds-mut">
                <div
                  style={{ width: px, height: px }}
                  className="bg-[#2A6FD1] rounded-[3px] mx-auto mb-1.5"
                />
                {px}
              </div>
            ))}
          </div>
          <p className="ds-mut mt-3 mb-0 text-[13px]">
            Radius: 8 for controls, 12 for cards, full for badges and chips. Every touch target is at least 44 px tall.
          </p>
        </DsCard>
      </div>

      {/* Buttons */}
      <DsCard
        title="Buttons"
        subtitle="Minimum height 44 px. One primary button per area."
        icon="plus"
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Primary</div>
            <DsButton variant="primary" icon="plus">
              Add to import list
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Primary · hover</div>
            <DsButton
              variant="primary"
              icon="plus"
              className="!bg-[#1F5BB0] !border-[#1F5BB0]"
            >
              Add to import list
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">
              Primary · keyboard focus
            </div>
            <DsButton
              variant="primary"
              icon="plus"
              className="shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#2A6FD1]"
            >
              Add to import list
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Primary · loading</div>
            <DsButton variant="primary" loading>
              Pushing products
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Primary · disabled</div>
            <DsButton
              variant="primary"
              disabled
              disabledReason="Always say why, next to it"
            >
              Publish
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Secondary</div>
            <DsButton variant="secondary" icon="package">
              Order a sample
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Danger</div>
            <DsButton variant="danger" icon="x">
              Cancel order
            </DsButton>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Text link</div>
            <DsLinkButton href="/account/dropship/packing" variant="link">
              Change in Packing and shipping
            </DsLinkButton>
          </div>
        </div>
      </DsCard>

      {/* Inputs, Selects, Textarea, Checkbox, Radio card, Switch, Filter chips */}
      <DsCard
        title="Inputs and controls"
        subtitle="Label above, hint or error below. Errors say how to fix."
        icon="pencil"
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Default</div>
            <DsInput
              id="uikit-i1"
              label="Store address"
              placeholder="your-store.myshopify.com"
              hint="Enter your Shopify subdomain"
            />
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Focus</div>
            <DsInput
              id="uikit-i2"
              label="Store address"
              defaultValue="my-store.myshopify.com"
              className="!border-[#2A6FD1] shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#2A6FD1]"
            />
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Error</div>
            <DsInput
              id="uikit-i3"
              label="Store address"
              defaultValue="my-store"
              error="Store address must include .myshopify.com"
            />
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Disabled</div>
            <DsInput
              id="uikit-i4"
              label="Dropship model no."
              defaultValue="DS-000001"
              disabled
            />
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Select</div>
            <DsSelect id="uikit-i5" label="Ships to" defaultValue="AE">
              <option value="AE">United Arab Emirates</option>
              <option value="DE">Germany</option>
              <option value="US">United States</option>
            </DsSelect>
          </div>
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Textarea</div>
            <DsTextarea
              id="uikit-i6"
              label="Customs description"
              rows={2}
              defaultValue="Ceramic household pet bowl"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-4 border-t border-[#EEF0F4]">
          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">
              Checkbox and Switch
            </div>
            <DsCheckbox label="Keep stock and price in sync" defaultChecked />
            <DsSwitch
              checked={switchSync}
              onChange={setSwitchSync}
              label="Automatic order sync"
              hint="Checks connected stores hourly"
            />
          </div>

          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">Radio cards</div>
            <div className="flex flex-col gap-2">
              <DsRadioCard
                name="uikit-duty"
                value="ddp"
                checked={dutyMode === 'ddp'}
                onChange={setDutyMode}
                title="Duties included (DDP)"
                description="Paid before shipping so the buyer pays nothing on delivery."
                badge={<DsBadge tone="ok">Recommended</DsBadge>}
              />
              <DsRadioCard
                name="uikit-duty"
                value="dap"
                checked={dutyMode === 'dap'}
                onChange={setDutyMode}
                title="Buyer pays on delivery (DAP)"
                description="Carrier collects import duties from the buyer."
              />
            </div>
          </div>

          <div>
            <div className="ds-mut text-[12px] font-semibold mb-1.5">
              Filter chips (aria-pressed)
            </div>
            <div className="flex gap-2 flex-wrap">
              <DsChip
                pressed={chipActive === 'all'}
                onClick={() => setChipActive('all')}
              >
                All products
              </DsChip>
              <DsChip
                pressed={chipActive === 'review'}
                onClick={() => setChipActive('review')}
              >
                HS review
              </DsChip>
              <DsChip
                pressed={chipActive === 'drafts'}
                onClick={() => setChipActive('drafts')}
              >
                Drafts
              </DsChip>
            </div>
          </div>
        </div>
      </DsCard>

      {/* Badges */}
      <DsCard title="Badges" icon="tag">
        <div className="flex gap-2.5 flex-wrap items-center">
          <DsBadge tone="ok">In stock</DsBadge>
          <DsBadge tone="warn">Low margin</DsBadge>
          <DsBadge tone="bad">On hold: address</DsBadge>
          <DsBadge tone="info">Processing</DsBadge>
          <DsBadge tone="neutral">Draft</DsBadge>
        </div>
        <p className="ds-mut mt-2.5 mb-0 text-[13px]">
          Green done or good · amber needs attention · red blocked · blue in progress · grey neutral. Every badge has an icon AND words.
        </p>
      </DsCard>

      {/* Order status table */}
      <DsTableCard
        title="Order status: one meaning, one badge"
        icon="cart"
        headers={['Merchant sees', 'Badge', 'Shown when']}
      >
        <tr>
          <td>Awaiting payment</td>
          <td>
            <DsOrderStatusBadge status="awaiting_payment" />
          </td>
          <td>Wallet too low; expires after configured days</td>
        </tr>
        <tr>
          <td>Processing</td>
          <td>
            <DsOrderStatusBadge status="processing" />
          </td>
          <td>Paid, being sourced, picked, packed or labelled</td>
        </tr>
        <tr>
          <td>Shipped</td>
          <td>
            <DsOrderStatusBadge status="shipped" />
          </td>
          <td>Handed to carrier; tracking sent to the store</td>
        </tr>
        <tr>
          <td>Delivered</td>
          <td>
            <DsOrderStatusBadge status="delivered" />
          </td>
          <td>Carrier confirms delivery</td>
        </tr>
        <tr>
          <td>On hold</td>
          <td>
            <DsOrderStatusBadge status="on_hold" />
          </td>
          <td>Address, high risk or stock problem; needs the merchant</td>
        </tr>
        <tr>
          <td>Cancelled</td>
          <td>
            <DsOrderStatusBadge status="cancelled" />
          </td>
          <td>Before packing; wallet refunded</td>
        </tr>
        <tr>
          <td>Refunded</td>
          <td>
            <DsOrderStatusBadge status="refunded" />
          </td>
          <td>After a claim or return is approved</td>
        </tr>
      </DsTableCard>

      {/* Notices, Toast, Dialog, Empty state, Skeleton, Stepper */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <DsCard title="Notice banners" icon="info">
          <div className="flex flex-col gap-2">
            <DsNotice tone="info" title="Information">
              Neutral news, no action needed.
            </DsNotice>
            <DsNotice tone="ok" title="Success">
              Products pushed to Shopify.
            </DsNotice>
            <DsNotice
              tone="warn"
              title="Needs attention"
              action={
                <DsButton variant="secondary" icon="wallet">
                  Add funds
                </DsButton>
              }
            >
              Wallet is low: orders are waiting.
            </DsNotice>
            <DsNotice
              tone="bad"
              title="Blocked"
              action={
                <DsButton variant="primary" icon="link">
                  Reconnect
                </DsButton>
              }
            >
              Store access expired. Stock and price updates are paused.
            </DsNotice>
          </div>
        </DsCard>

        <DsCard title="Toast and Dialog" icon="refresh">
          <div className="flex flex-col gap-4">
            <div>
              <DsToast message="Added to import list" actionLabel="Undo" />
              <p className="ds-mut mt-2 mb-0 text-[12px]">
                Bottom of the screen, 5 seconds, never the only place an error is shown.
              </p>
            </div>
            <DsDialog
              inline
              title="Unlink selected products?"
              description="They stay in your Shopify store but stop syncing stock and price."
              cancelLabel="Keep"
              confirmLabel="Unlink"
              confirmVariant="danger"
            />
          </div>
        </DsCard>

        <DsCard title="Empty state and Loading skeleton" icon="clock">
          <DsEmptyState
            title="Your import list is empty"
            description="Add products from the catalogue to price and publish them."
            actionLabel="Find products"
            actionHref="/account/dropship/catalogue"
          />
          <div className="mt-4 pt-4 border-t border-[#EEF0F4]">
            <DsSkeleton immediate />
            <p className="ds-mut mt-2 mb-0 text-[12px]">
              Shown after 300 ms; never a full-page spinner.
            </p>
          </div>
        </DsCard>
      </div>

      {/* Stepper and Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsCard title="Steps" icon="list">
          <DsStepper
            steps={[
              { label: 'Upload', state: 'done' },
              { label: 'Check', state: 'current' },
              { label: 'Images', state: 'upcoming' },
              { label: 'Import', state: 'upcoming' },
            ]}
          />
        </DsCard>

        <DsCard title="Timeline" icon="clock">
          <DsTimeline
            events={[
              {
                title: 'Order paid from wallet',
                detail: 'Processing started at warehouse',
                timestamp: 'Completed',
                state: 'done',
              },
              {
                title: 'Picked, packed and weighed',
                detail: 'Carrier label ready',
                timestamp: 'In progress',
                state: 'current',
              },
              {
                title: 'Handed to carrier',
                detail: 'Tracking sent to connected store',
                timestamp: 'Upcoming',
                state: 'upcoming',
              },
            ]}
          />
        </DsCard>
      </div>

      {/* Table rows & Price breakdown block */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsTableCard
          title="Table rows"
          headers={['State', 'Example', 'Rule']}
        >
          <tr>
            <td>Default</td>
            <td>Pet water fountain</td>
            <td>White row, 12 px padding</td>
          </tr>
          <tr className="bg-[#F7F9FC]">
            <td>Hover</td>
            <td>Phone holder</td>
            <td>Background #F7F9FC / #FAFBFD</td>
          </tr>
          <tr data-selected="true">
            <td>Selected</td>
            <td>LED desk lamp</td>
            <td>Background #F2F7FE and a checked box</td>
          </tr>
          <tr>
            <td>Wide tables</td>
            <td>Scroll sideways</td>
            <td>Inside a box that scrolls; header stays readable</td>
          </tr>
        </DsTableCard>

        <DsCard title="Price breakdown block" icon="tag">
          <DsPriceBreakdown
            product="Product line"
            processing="Processing line"
            shipping="Shipping line"
            duties="Duties and tax line"
            dutiesMode="DDP"
            landed="Total landed cost"
            caption="Same order of lines everywhere: card, product page, order, invoice."
          />
        </DsCard>
      </div>

      {/* Identifiers & Accessibility rules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsCard title="Identifiers" icon="tag">
          <div className="ds-row">
            <span className="ds-mut">Dropship model no.</span>
            <span>DS-000001</span>
          </div>
          <div className="ds-row">
            <span className="ds-mut">Variant</span>
            <span>DS-000001-01</span>
          </div>
          <div className="ds-row">
            <span className="ds-mut">Order</span>
            <span>Store order number</span>
          </div>
          <div className="ds-row">
            <span className="ds-mut">Invoice</span>
            <span>OCT-DS series</span>
          </div>
          <div className="ds-row">
            <span className="ds-mut">Sourcing request</span>
            <span>SR series</span>
          </div>
          <p className="ds-mut mt-2 mb-0 text-[12px]">
            Sourcing model numbers appear on staff screens only.
          </p>
        </DsCard>

        <DsCard title="Accessibility rules" icon="shield">
          <ul className="m-0 pl-[18px] text-[14px] leading-[1.7]">
            <li>
              Text contrast at least 4.5:1; muted text #5B6478 passes on white and on #F4F6F9
            </li>
            <li>Every control is a real button, link or input with a label</li>
            <li>Selected chips use aria-pressed; current page uses aria-current</li>
            <li>Keyboard focus ring: 2 px white + 2 px blue</li>
            <li>Colour never carries meaning alone: every badge has words and an icon</li>
            <li>Errors name the field and say how to fix it</li>
          </ul>
        </DsCard>
      </div>
    </div>
  );
}
