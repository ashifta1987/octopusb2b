'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Copy, Download, ExternalLink, Filter, Landmark, CreditCard, Search, Ship, Plane, TriangleAlert, Wallet, Settings } from 'lucide-react';
import {
  Button,
  Checkbox,
  DateInput,
  Drawer,
  Field,
  FileDrop,
  Icon,
  IconButton,
  Input,
  Kbd,
  Modal,
  NumberInput,
  QuantityStepper,
  RadioCards,
  Select,
  Switch,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
  formatMoney,
  parseDecimal,
  useToast,
  type FileDropItem,
  type OdsDensity,
} from '@octopus/ui';
import { Demo, DensityPair, State } from '../_demo';

const grid = 'grid min-w-0 grid-cols-1 gap-4 ods-tablet:grid-cols-2';

export function Sections() {
  return (
    <ToastProvider>
      <FieldsDemo />
      <SelectTextareaDemo />
      <NumbersDemo />
      <DateFileDemo />
      <ChecksDemo />
      <RadioCardsDemo />
      <DrawerDemo />
      <RecordPaymentDemo />
      <ModalDemo />
      <ToastDemo />
      <TooltipDemo />
    </ToastProvider>
  );
}

/* ───────── Field + Input ───────── */
function FieldsDemo() {
  return (
    <Demo
      id="field-input"
      title="Field and Input"
      note="Label above (600), required “*” (+ “required” for screen readers and aria-required), hint and error below, linked with aria-describedby; errors are announced. Hover = navy border, focus = blue border + amber ring (Tab into any field). Placeholder is only an example, never the label."
      phone="full width, label stays above; same 44 px height."
    >
      <DensityPair>
        {(d) => (
          <div className={grid}>
            <State label="Default">
              <Field label="Store name">
                <Input data-testid="input-default" placeholder="e.g. anna-home" />
              </Field>
            </State>
            <State label="Filled">
              <Field label="Store name">
                <Input defaultValue="anna-home" />
              </Field>
            </State>
            <State label="Required with hint">
              <Field label="Shopify address" required hint="Ends with .myshopify.com">
                <Input placeholder="your-store.myshopify.com" />
              </Field>
            </State>
            <State label="Error">
              <Field label="Store name" required error="This name is already taken. Try anna-home-2.">
                <Input data-testid="field-error" defaultValue="anna-home" />
              </Field>
            </State>
            <State label="Disabled, with the reason">
              <Field label="Customer number" disabled disabledReason="Set by Octopus when the account was opened">
                <Input defaultValue="DS-000214" />
              </Field>
            </State>
            <State label="Read-only (focusable, copyable)">
              <Field label="Invoice number" readOnly>
                <Input defaultValue="OCT-SRC-2026-0221" />
              </Field>
            </State>
            <State label="Loading (checking)">
              <Field label="Store name" hint="Checking if the name is free…">
                <Input defaultValue="anna-home-2" loading />
              </Field>
            </State>
            <State label="Icon and suffix">
              <div className="flex flex-col gap-3">
                <Field label="Search products">
                  <Input type="search" iconStart={Search} placeholder="Name, SKU or supplier" />
                </Field>
                <Field label="Work email" hint={d === 'compact' ? undefined : 'We send order updates here'}>
                  <Input suffix="@octopus.ae" defaultValue="anna" />
                </Field>
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── Select + Textarea ───────── */
function SelectTextareaDemo() {
  return (
    <Demo id="select-textarea" title="Select and Textarea" note="Native select (keyboard and phone pickers stay native) with a chevron. Textarea with an optional character count (screen readers hear it when 20 or fewer remain)." phone="the OS picker opens for Select; Textarea is full width.">
      <DensityPair>
        {() => (
          <div className={grid}>
            <State label="Select · default">
              <Field label="Bank account" required>
                <Select placeholder="Choose a bank account" defaultValue="">
                  <option value="enbd">Emirates NBD · USD ··4417</option>
                  <option value="hsbc">HSBC · USD ··0932</option>
                </Select>
              </Field>
            </State>
            <State label="Select · error">
              <Field label="Payment method" required error="Choose how the customer paid.">
                <Select placeholder="Choose a method" defaultValue="">
                  <option value="bank">Bank transfer</option>
                  <option value="card">Card</option>
                </Select>
              </Field>
            </State>
            <State label="Select · disabled, with the reason">
              <Field label="Currency" disabled disabledReason="Only US$ for now; AED comes later">
                <Select defaultValue="usd">
                  <option value="usd">US$ · US dollar</option>
                </Select>
              </Field>
            </State>
            <State label="Select · loading options">
              <Field label="Warehouse">
                <Select loading placeholder="Loading warehouses…" defaultValue="" />
              </Field>
            </State>
            <State label="Textarea · with count">
              <Field label="Note for the customer" hint="Shown on the invoice">
                <Textarea showCount maxLength={200} defaultValue="Thank you for your order." />
              </Field>
            </State>
            <State label="Textarea · error and read-only">
              <div className="flex flex-col gap-3">
                <Field label="Reason for the refund" required error="Tell us why, in a sentence or two.">
                  <Textarea rows={2} />
                </Field>
                <Field label="Supplier note" readOnly>
                  <Textarea rows={2} defaultValue="Cartons of 50. Ships from Ningbo." />
                </Field>
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── NumberInput + QuantityStepper ───────── */
function NumbersDemo() {
  return (
    <Demo
      id="numbers"
      title="NumberInput and QuantityStepper"
      note="Money and numbers are right-aligned with tabular figures and a decimal keypad; the amount is checked when you leave the field (try 0 or 60000). The stepper: Arrow Up/Down on the value, the reason shows when a limit is reached."
      phone="decimal / numeric keypad; the stepper keeps its 44 px buttons."
    >
      <DensityPair>
        {() => (
          <div className={grid}>
            <State label="Money, US$ prefix, validated on blur">
              <Field label="Amount" required hint="Between US$ 1.00 and US$ 50,000.00">
                <NumberInput prefix="US$" decimals={2} min={1} max={50000} defaultValue="2,870.00" />
              </Field>
            </State>
            <State label="Error">
              <Field label="Unit price" required error="Enter 0.01 or more.">
                <NumberInput prefix="US$" defaultValue="0" />
              </Field>
            </State>
            <State label="Read-only and disabled">
              <div className="flex flex-col gap-3">
                <Field label="Balance due" readOnly>
                  <NumberInput prefix="US$" defaultValue="1,250.00" />
                </Field>
                <Field label="Credit limit" disabled disabledReason="Only Finance can change the credit limit">
                  <NumberInput prefix="US$" defaultValue="10,000.00" />
                </Field>
              </div>
            </State>
            <State label="Quantity (min 50, steps of 10, max 400)">
              <div className="flex flex-col gap-3">
                <Field label="Quantity" hint="Cartons of 10">
                  <QuantityStepper min={50} max={400} step={10} defaultValue={50} unit="pieces" minReason="Minimum order is 50" maxReason="Only 400 in stock" />
                </Field>
                <Field label="Quantity (disabled)" disabled disabledReason="This pool is closed">
                  <QuantityStepper min={1} defaultValue={120} />
                </Field>
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── DateInput + FileDrop ───────── */
let fileSeq = 0;
function useFakeUploads(initial: FileDropItem[]) {
  const [files, setFiles] = useState<FileDropItem[]>(initial);
  const busy = files.some((f) => f.status === 'uploading' && f.id.startsWith('new-'));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setFiles((list) =>
        list.map((f) => {
          if (f.status !== 'uploading' || !f.id.startsWith('new-')) return f;
          const p = Math.min(100, (f.progress ?? 0) + 20);
          return p >= 100 ? { ...f, status: 'done', progress: 100 } : { ...f, progress: p };
        }),
      );
    }, 400);
    return () => clearInterval(t);
  }, [busy]);
  return {
    files,
    add: (list: File[]) => setFiles((cur) => [...cur, ...list.map((f) => ({ id: `new-${++fileSeq}`, name: f.name, size: f.size, status: 'uploading' as const, progress: 0 }))]),
    remove: (id: string) => setFiles((cur) => cur.filter((f) => f.id !== id)),
  };
}

function FileDropDemo({ withList }: { withList: boolean }) {
  const up = useFakeUploads(
    withList
      ? [
          { id: 'a', name: 'bank-statement-nov.pdf', size: 482_000, status: 'done' },
          { id: 'b', name: 'proof-of-payment.jpg', size: 2_310_000, status: 'uploading', progress: 45 },
          { id: 'c', name: 'invoice-scan.png', size: 3_100_000, status: 'error', error: 'Upload failed: the connection dropped. Remove it and try again.' },
        ]
      : [],
  );
  return (
    <Field label="Proof of payment" hint="Add the bank slip or a screenshot of the transfer">
      <FileDrop accept=".pdf,.jpg,.jpeg,.png" acceptLabel="PDF, JPG or PNG" maxSize={10 * 1024 * 1024} files={up.files} onFilesAdded={up.add} onRemove={up.remove} />
    </Field>
  );
}

function DateFileDemo() {
  return (
    <Demo
      id="date-file"
      title="DateInput and FileDrop"
      note="Native date input (type a date or use the calendar); the read-out shows the ODS format, 27 Nov 2026. FileDrop: drag files or use the real “Choose files” button; wrong types or files over 10 MB are refused with a message; uploads show progress."
      phone="the OS date picker opens; the drop zone shrinks to the button and the rules text."
    >
      <DensityPair>
        {(d) => (
          <div className={grid}>
            <State label="Date · empty and filled">
              <div className="flex flex-col gap-3">
                <Field label="Date received" required>
                  <DateInput />
                </Field>
                <Field label="Due date">
                  <DateInput defaultValue="2026-11-27" />
                </Field>
              </div>
            </State>
            <State label="Date · error and disabled">
              <div className="flex flex-col gap-3">
                <Field label="Delivery by" error="Pick a date after today.">
                  <DateInput defaultValue="2026-01-04" />
                </Field>
                <Field label="Issued" disabled disabledReason="Set when the invoice was sent">
                  <DateInput defaultValue="2026-11-02" />
                </Field>
              </div>
            </State>
            <State label={d === 'comfortable' ? 'FileDrop · with uploads (done, uploading, failed)' : 'FileDrop · with uploads'} className="min-w-0 ods-tablet:col-span-2">
              <FileDropDemo withList />
            </State>
            <State label="FileDrop · disabled, with the reason" className="min-w-0 ods-tablet:col-span-2">
              <Field label="Product photos">
                <FileDrop accept="image/*" acceptLabel="JPG or PNG" files={[]} onFilesAdded={() => undefined} onRemove={() => undefined} disabled disabledReason="Photos can be added after the supplier confirms the sample" />
              </Field>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── Checkbox + Switch ───────── */
function SelectAll() {
  const [rows, setRows] = useState([true, false, true]);
  const all = rows.every(Boolean);
  const some = rows.some(Boolean) && !all;
  const names = ['OCT-SRC-2026-0207', 'OCT-SRC-2026-0211', 'OCT-SRC-2026-0221'];
  return (
    <div className="flex flex-col">
      <Checkbox label="Select all invoices" checked={all} indeterminate={some} onCheckedChange={() => setRows(rows.map(() => !all))} />
      <div className="ps-6">
        {names.map((n, i) => (
          <Checkbox key={n} label={n} checked={rows[i]} onCheckedChange={(c) => setRows(rows.map((r, j) => (j === i ? c : r)))} />
        ))}
      </div>
    </div>
  );
}

function ChecksDemo() {
  return (
    <Demo
      id="checks"
      title="Checkbox and Switch"
      note="Checkbox: native (Space toggles), indeterminate for “some selected”. Switch: role=switch with aria-checked, for settings that apply at once; “On / Off” text so the state is never colour or position alone."
      phone="the whole row is the tap target (at least 44 px tall)."
    >
      <DensityPair>
        {() => (
          <div className={grid}>
            <State label="Checkbox · states">
              <div className="flex flex-col">
                <Checkbox label="Keep stock and price in sync" />
                <Checkbox label="Email me when the pool closes" defaultChecked description="One email, the day it closes" />
                <Checkbox label="Mark as paid" disabled disabledReason="Record a payment first" />
                <Checkbox label="I agree to the supplier terms" error="Tick this box to place the order." />
              </div>
            </State>
            <State label="Checkbox · indeterminate (select all)">
              <SelectAll />
            </State>
            <State label="Switch · states">
              <div className="flex flex-col">
                <Switch label="Two-step sign-in" />
                <Switch label="Auto-push new products" defaultChecked description="New imports go live in your store" />
                <Switch label="Payment protection" defaultChecked disabled disabledReason="Required for orders over US$ 5,000.00" />
                <Switch label="Weekly report" loading defaultChecked />
              </div>
            </State>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── RadioCards ───────── */
function RadioCardsDemo() {
  return (
    <Demo
      id="radio-cards"
      title="RadioCards"
      note="Native radios in a fieldset with a legend: Tab enters the group, arrow keys change the choice. Selected = 2 px blue border + tint + a filled dot. Disabled cards say why."
      phone="one card per row."
    >
      <DensityPair stack>
        {() => (
          <div className="flex min-w-0 flex-col gap-6">
            <RadioCards
              legend="Payment method"
              required
              defaultValue="bank"
              columns={3}
              options={[
                { value: 'bank', label: 'Bank transfer', description: 'Free · 1–2 working days', icon: Landmark },
                { value: 'card', label: 'Card', description: 'Visa, Mastercard · 2.9 % fee', price: formatMoney(83.23), icon: CreditCard },
                { value: 'wallet', label: 'Wallet balance', icon: Wallet, disabled: true, disabledReason: `Balance ${formatMoney(120)} is less than the total` },
              ]}
            />
            <RadioCards
              legend="Shipping"
              hint="Prices include duties (DDP)"
              columns={2}
              options={[
                { value: 'sea', label: 'Sea freight', description: '28–35 days to Jebel Ali', price: formatMoney(420), icon: Ship },
                { value: 'air', label: 'Air freight', description: '6–9 days to Dubai', price: formatMoney(1180), icon: Plane },
              ]}
              error="Choose how the order ships."
            />
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── Drawer ───────── */
function MiniCartDrawer({ density }: { density: OdsDensity }) {
  const [open, setOpen] = useState(false);
  const comfy = density === 'comfortable';
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)} data-testid={comfy ? 'drawer-open' : undefined}>
          Open mini-cart (380 px)
        </Button>
      </div>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Your cart · 2 products"
        description={`Subtotal ${formatMoney(2870)}`}
        width={380}
        data-testid={comfy ? 'drawer' : undefined}
        footer={
          <div className="flex flex-col gap-2">
            <Button fullWidth href="#cart">
              Go to cart
            </Button>
            <Button fullWidth variant="secondary" onClick={() => setOpen(false)}>
              Keep shopping
            </Button>
          </div>
        }
      >
        <ul className="flex flex-col gap-4">
          {[
            { name: 'Bamboo storage box, set of 3', price: 18.4, min: 50 },
            { name: 'Ceramic mug 350 ml, matte', price: 2.15, min: 100 },
          ].map((p) => (
            <li key={p.name} className="flex flex-col gap-2 border-b border-ods-line pb-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ods-navy">{p.name}</span>
                <span className="tabular-nums">{formatMoney(p.price)}</span>
              </div>
              <Field label={`Quantity · ${p.name}`}>
                <QuantityStepper min={p.min} step={10} defaultValue={p.min} minReason={`Minimum order is ${p.min}`} />
              </Field>
            </li>
          ))}
        </ul>
      </Drawer>
    </div>
  );
}

function EditDrawer() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Anna Home Trading LLC');
  const [draft, setDraft] = useState(name);
  const { toast } = useToast();
  const dirty = draft !== name;
  const save = () => {
    setName(draft);
    setOpen(false);
    toast({ message: 'Customer saved', tone: 'success' });
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(name);
            setOpen(true);
          }}
        >
          Edit customer (460 px, unsaved guard)
        </Button>
      </div>
      <p className="text-ods-small text-ods-slate">Change the name, then press Esc: it asks before discarding. Ctrl S saves.</p>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Edit customer"
        description="DS-000214"
        width={460}
        dirty={dirty}
        onSave={save}
        footer={<DrawerFooter onSave={save} onCancel={() => setOpen(false)} saveLabel="Save customer" />}
      >
        <div className="flex flex-col gap-4">
          <Field label="Company name" required>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <Field label="Country">
            <Select defaultValue="ae">
              <option value="ae">United Arab Emirates</option>
              <option value="sa">Saudi Arabia</option>
            </Select>
          </Field>
          <Field label="Notes" optional>
            <Textarea rows={6} />
          </Field>
          <Switch label="Send monthly statement" defaultChecked />
        </div>
      </Drawer>
    </div>
  );
}

function DrawerFooter({ onSave, onCancel, saveLabel }: { onSave: () => void; onCancel: () => void; saveLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={onSave}>{saveLabel}</Button>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <span className="ms-auto hidden items-center gap-1 text-ods-small text-ods-slate ods-tablet:inline-flex">
        <Kbd>Ctrl</Kbd>
        <Kbd>S</Kbd> save · <Kbd>Esc</Kbd> close
      </span>
    </div>
  );
}

function DrawerDemo() {
  return (
    <Demo
      id="drawer"
      title="Drawer"
      note="Slides in from the inline end (right; left in RTL). role=dialog, aria-modal, focus trapped and starting on the first field; Esc, ✕ or the backdrop close it and focus returns to the button that opened it. With unsaved changes it asks “Discard unsaved changes?” first. Ctrl S calls save while open. Sticky header and footer."
      phone="full width and height (a full-screen sheet); the footer stays at the bottom."
    >
      <DensityPair>{(d) => (d === 'comfortable' ? <MiniCartDrawer density={d} /> : <EditDrawer />)}</DensityPair>
    </Demo>
  );
}

/* ───────── Record payment drawer (Part 7.4) ───────── */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-ods-control border border-ods-warning/40 bg-ods-warning-tint px-3 py-2 text-ods-small text-ods-text">
      <Icon icon={TriangleAlert} className="mt-[0.15em] text-ods-warning" />
      <span>{children}</span>
    </div>
  );
}

const EMPTY_PAYMENT = { amount: '', date: '2026-11-27', method: 'bank', account: '', reference: '', note: '' };

function RecordPaymentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [v, setV] = useState(EMPTY_PAYMENT);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY_PAYMENT, string>>>({});
  const [tab, setTab] = useState('record');
  const amountRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(EMPTY_PAYMENT);
  const set = (k: keyof typeof EMPTY_PAYMENT) => (val: string) => {
    setV((cur) => ({ ...cur, [k]: val }));
    setErrors((cur) => (cur[k] ? { ...cur, [k]: undefined } : cur));
  };
  const balance = 2870;
  const close = () => {
    setV(EMPTY_PAYMENT);
    setErrors({});
    setTab('record');
    onClose();
  };
  const save = () => {
    const n = parseDecimal(v.amount);
    const e: typeof errors = {};
    if (n === null || n <= 0) e.amount = 'Enter the amount received, like 1250.00.';
    else if (n > balance) e.amount = `Enter ${formatMoney(balance)} or less (the balance due).`;
    if (!v.account) e.account = 'Choose the account the money arrived in.';
    if (!v.reference.trim()) e.reference = 'Enter the bank reference from the statement line.';
    setErrors(e);
    setTab('record');
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-record-payment] [aria-invalid="true"]')?.focus());
      return;
    }
    const big = (n ?? 0) > 2500;
    close();
    toast({ message: big ? 'Payment saved · sent for second approval' : 'Payment saved', tone: 'success', action: { label: 'Undo', onClick: () => toast({ message: 'Payment removed' }) } });
  };
  const recordPanel = (
    <div className="flex flex-col gap-4" data-record-payment>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-ods-control border border-ods-line bg-ods-canvas p-3 text-ods-small">
        <dt className="text-ods-slate">Customer</dt>
        <dd className="text-end font-semibold text-ods-navy">Anna Home Trading LLC</dd>
        <dt className="text-ods-slate">Total</dt>
        <dd className="text-end tabular-nums">{formatMoney(4120)}</dd>
        <dt className="text-ods-slate">Paid</dt>
        <dd className="text-end tabular-nums">{formatMoney(1250)}</dd>
        <dt className="font-semibold text-ods-navy">Balance due</dt>
        <dd className="text-end font-semibold text-ods-navy tabular-nums">{formatMoney(balance)}</dd>
      </dl>
      <div ref={amountRef}>
        <Field label="Amount" required error={errors.amount}>
          <NumberInput prefix="US$" decimals={2} min={0.01} max={balance} value={v.amount} onValueChange={set('amount')} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
        <Field label="Date received" required>
          <DateInput value={v.date} onChange={(e) => set('date')(e.target.value)} max="2026-11-27" />
        </Field>
        <Field label="Method">
          <Select value={v.method} onChange={(e) => set('method')(e.target.value)}>
            <option value="bank">Bank transfer</option>
            <option value="card">Card</option>
            <option value="cash">Cash deposit</option>
            <option value="wallet">Wallet</option>
          </Select>
        </Field>
      </div>
      <Field label="Bank account" required error={errors.account}>
        <Select placeholder="Choose a bank account" value={v.account} onChange={(e) => set('account')(e.target.value)}>
          <option value="enbd">Emirates NBD · USD ··4417</option>
          <option value="hsbc">HSBC · USD ··0932</option>
        </Select>
      </Field>
      <Field label="Bank reference" required hint="Must match the bank statement line" error={errors.reference}>
        <Input value={v.reference} onChange={(e) => set('reference')(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Note" optional>
        <Textarea rows={3} showCount maxLength={300} value={v.note} onChange={(e) => set('note')(e.target.value)} />
      </Field>
      <Notice>Payments over {formatMoney(2500, { decimals: 0 })} need a second approver.</Notice>
    </div>
  );
  return (
    <Drawer
      open={open}
      onClose={close}
      title="OCT-SRC-2026-0221"
      description="Partly paid · due 4 Dec 2026"
      width={460}
      dirty={dirty}
      onSave={save}
      actions={<IconButton icon={ExternalLink} label="Open in a tab" tooltipSide="bottom" />}
      footer={<DrawerFooter onSave={save} onCancel={close} saveLabel="Save payment" />}
    >
      <Tabs
        label="Invoice sections"
        value={tab}
        onChange={setTab}
        panelClassName="pt-4"
        items={[
          { id: 'record', label: 'Record payment', panel: recordPanel },
          {
            id: 'details',
            label: 'Details',
            panel: (
              <dl className="grid grid-cols-2 gap-y-1 text-ods-small">
                <dt className="text-ods-slate">Service</dt>
                <dd>Sourcing</dd>
                <dt className="text-ods-slate">Issued</dt>
                <dd>2 Nov 2026</dd>
                <dt className="text-ods-slate">Owner</dt>
                <dd>Rami K.</dd>
              </dl>
            ),
          },
          {
            id: 'activity',
            label: 'Activity',
            count: 3,
            panel: (
              <ul className="flex flex-col gap-2 text-ods-small">
                <li>27 Nov 2026 · Reminder sent by Rami K.</li>
                <li>14 Nov 2026 · {formatMoney(1250)} received</li>
                <li>2 Nov 2026 · Invoice sent</li>
              </ul>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

function RecordPaymentDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Demo
      id="record-payment"
      title="Record payment drawer (Back Office, compact)"
      note="Part 7.4: 460 px, tabs Record payment · Details · Activity, summary box, required Amount and Bank reference, the second-approver warning, Save payment / Cancel with shortcut hints. Save with empty fields to see the errors (focus moves to the first one)."
      phone="full screen; the two-column row stacks."
    >
      <div data-density="compact" className="min-w-0 rounded-ods-card border border-dashed border-ods-line-strong bg-ods-canvas p-3">
        <div className="mb-2 text-[11px] font-semibold tracking-wide text-ods-slate uppercase">compact</div>
        <div className="flex flex-wrap items-center gap-3 rounded-ods-control border border-ods-line bg-ods-surface p-3">
          <span className="font-semibold text-ods-navy">OCT-SRC-2026-0221</span>
          <span className="text-ods-slate">Anna Home Trading LLC</span>
          <span className="tabular-nums">Balance {formatMoney(2870)}</span>
          <Button size="md" className="ms-auto" onClick={() => setOpen(true)}>
            Record payment
          </Button>
        </div>
        <RecordPaymentDrawer open={open} onClose={() => setOpen(false)} />
      </div>
    </Demo>
  );
}

/* ───────── Modal ───────── */
function CancelInvoiceModal({ density }: { density: OdsDensity }) {
  const comfy = density === 'comfortable';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="danger" onClick={() => setOpen(true)} data-testid={comfy ? 'modal-open' : undefined}>
          Cancel invoice…
        </Button>
      </div>
      <p className="text-ods-small text-ods-slate">Destructive: red button named after the action, role=alertdialog, focus starts on “Keep invoice”, the backdrop doesn&apos;t close it.</p>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        destructive
        data-testid={comfy ? 'modal' : undefined}
        title="Cancel invoice OCT-SRC-2026-0221?"
        description="The customer can no longer pay it. A cancelled invoice can't be reopened; you'll need a new one."
        cancelLabel="Keep invoice"
        confirmLabel="Cancel invoice"
        loading={busy}
        loadingText="Cancelling…"
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setOpen(false);
            toast({ message: 'Invoice OCT-SRC-2026-0221 cancelled' });
          }, 900);
        }}
      />
    </div>
  );
}

function ConfirmModal() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Send statement to customer…
        </Button>
      </div>
      <p className="text-ods-small text-ods-slate">Not destructive, but can&apos;t be undone once sent: blue confirm, backdrop click cancels.</p>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Send the November statement?"
        description="Anna Home Trading LLC gets it by email at accounts@annahome.ae. An email can't be called back."
        confirmLabel="Send statement"
        onConfirm={() => {
          setOpen(false);
          toast({ message: 'Statement sent', tone: 'success' });
        }}
      />
    </div>
  );
}

function ModalDemo() {
  return (
    <Demo
      id="modal"
      title="Modal (confirm)"
      note="Only to confirm something that can't be undone. Tab and Shift+Tab stay inside; Esc and ✕ close; focus returns to the button that opened it."
      phone="a bottom sheet, full width, buttons stacked (the safe one first)."
    >
      <DensityPair>
        {(d) => (
          <div className="flex flex-col gap-6">
            <CancelInvoiceModal density={d} />
            <ConfirmModal />
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── Toast ───────── */
function ToastButtons({ density }: { density: OdsDensity }) {
  const { toast } = useToast();
  const comfy = density === 'comfortable';
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        data-testid={comfy ? 'toast-open' : undefined}
        onClick={() => toast({ message: 'Payment saved · sent for second approval', tone: 'success', action: { label: 'Undo', onClick: () => toast({ message: 'Payment removed' }) } })}
      >
        Save (toast with Undo)
      </Button>
      <Button variant="secondary" onClick={() => toast({ message: "Couldn't send the reminder. Check your connection and try again.", tone: 'danger', duration: 0 })}>
        Error toast (stays)
      </Button>
      <Button
        variant="secondary"
        onClick={() => ['Product 1 added', 'Product 2 added', 'Product 3 added', 'Product 4 added'].forEach((m) => toast({ message: m }))}
      >
        Add 4 (max 3 shown)
      </Button>
    </div>
  );
}

function ToastDemo() {
  return (
    <Demo
      id="toast"
      title="Toast"
      note="Navy, white text, teal Undo. One polite role=status region announces each toast. Auto-close (6 s) pauses while hovered or focused; at most 3 at a time. In the app the stack is fixed at the bottom; here each density renders it inline under the buttons."
      phone="full width at the bottom, above the 60 px bottom nav."
    >
      <DensityPair>
        {(d) => (
          <ToastProvider fixed={false} regionTestId={d === 'comfortable' ? 'toast-region' : undefined} regionLabel={`Notifications (${d})`}>
            <ToastButtons density={d} />
            <div className="h-3" />
          </ToastProvider>
        )}
      </DensityPair>
    </Demo>
  );
}

/* ───────── Tooltip ───────── */
function TooltipDemo() {
  return (
    <Demo
      id="tooltip"
      title="Tooltip"
      note="On hover and keyboard focus after 300 ms; Esc hides it; you can move the pointer onto it (WCAG 1.4.13). Icon buttons always have a tooltip with their name. Never the only place for important information."
      phone="no hover: the same text must be on screen (icon buttons keep their aria-label)."
    >
      <DensityPair>
        {() => (
          <div className="flex flex-wrap items-center gap-6 py-8">
            <IconButton icon={Bell} label="Notifications" tooltipSide="top" variant="secondary" />
            <IconButton icon={Filter} label="Filters" tooltipSide="bottom" variant="secondary" />
            <IconButton icon={Copy} label="Copy invoice number" tooltipSide="end" variant="secondary" />
            <IconButton icon={Settings} label="Settings" tooltipSide="start" variant="secondary" />
            <Tooltip content="Downloads a CSV of the rows you filtered" side="top">
              <Button variant="secondary" iconStart={Download}>
                Export
              </Button>
            </Tooltip>
          </div>
        )}
      </DensityPair>
    </Demo>
  );
}
