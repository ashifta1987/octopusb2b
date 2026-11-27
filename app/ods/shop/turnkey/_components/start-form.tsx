'use client';

import { useId, useState, useTransition } from 'react';
import { Check, Info, Send } from 'lucide-react';
import { Button, Field, FileDrop, Icon, Input, NamedTabLink, Select, Textarea, type FileDropItem } from '@octopus/ui';
import { COUNTRY_NAMES } from '@/lib/format';
import type { EnquiryInput } from '@/app/account/turnkey/actions';
import { BRIEF_MIN, TURNKEY_FILE_MAX_BYTES, budgetError, buildTurnkeyPlan, startMissing, type TurnkeyStartValues } from '../_lib/turnkey-logic';

const COUNTRIES = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

export type TurnkeySubmit = (input: EnquiryInput) => Promise<{ ok: boolean; code?: string; error?: string }>;

export type TurnkeyStartFormProps = {
  /** Catalogue project (turnkey_projects.project_id), or null for "my own project". */
  project: { id: string; title: string } | null;
  defaultCountry: string;
  /** TODAY's action: app/account/turnkey/actions.ts submitEnquiryAction (fixtures pass a stand-in). */
  submit: TurnkeySubmit;
  /** Files: today's start action has no file upload, so the real page passes { enabled: false, reason }. */
  files: { enabled: true } | { enabled: false; reason: string };
  /** Fixtures: files already in the drop zone (e.g. one refused for size). */
  initialFiles?: FileDropItem[];
  /** Save draft: there is no draft store for turnkey requests today → disabled with this reason. */
  draftDisabledReason: string;
  /** Viewer role can't send requests → Send disabled with the reason. */
  blockedReason?: string;
  headingLevel?: 2 | 3;
};

/**
 * ODS T4 · /shop/turnkey/[slug]/start (Part 5.6 start form): products, quantity, budget, sell in, brief, files
 * (FileDrop, 20 MB each), "Nothing is charged until you approve the proforma", Send project request, Save draft.
 * Send posts through TODAY's submitEnquiryAction (RPC tk_submit_enquiry): it creates the Turnkey project at
 * "Enquiry" for the company, in My account › Turnkey projects, where the Turnkey team picks it up. Products and
 * quantity go into the plan text (the action has no fields for them).
 */
export function TurnkeyStartForm({ project, defaultCountry, submit, files, initialFiles = [], draftDisabledReason, blockedReason, headingLevel = 2 }: TurnkeyStartFormProps) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  const own = !project;
  const formId = useId();
  const [v, setV] = useState<TurnkeyStartValues>({ products: project?.title ?? '', quantity: '', budgetUsd: '', country: defaultCountry, brief: '' });
  const [list, setList] = useState<FileDropItem[]>(initialFiles);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof TurnkeyStartValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const missing = startMissing(v, own);
  const bErr = budgetError(v.budgetUsd);
  const sendReason = blockedReason ?? (missing.length ? `Still needed: ${missing.join(', ')}.` : bErr ? 'Check the budget.' : undefined);

  if (done) {
    return (
      <section role="status" data-testid="turnkey-start" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-success-tint p-ods-pad-card">
        <H className="m-0 flex items-center gap-2 text-ods-h2 text-ods-navy">
          <Icon icon={Check} size="sm" className="text-ods-success" />
          Project request sent
        </H>
        <p className="m-0 text-ods-body">
          Your reference is <strong>{done}</strong>. Your account manager contacts you to agree the brief and timeline. Nothing is charged until you approve the proforma.
        </p>
        <NamedTabLink href={`/account/turnkey/${encodeURIComponent(done)}?created=1`} tab="account" className="self-start text-ods-body font-semibold text-ods-navy underline">
          Open it in My account
        </NamedTabLink>
      </section>
    );
  }

  return (
    <form
      id={formId}
      noValidate
      data-testid="turnkey-start"
      aria-labelledby={`${formId}-title`}
      className="flex flex-col gap-5 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (sendReason) return;
        setErr(null);
        start(async () => {
          const r = await submit({
            catalogueProject: project?.id ?? '',
            title: own ? v.products.trim() : '',
            country: v.country,
            city: '',
            targetOpenOn: '',
            floorArea: '',
            budgetUsd: v.budgetUsd,
            plan: buildTurnkeyPlan(v),
            website: '',
          });
          if (!r.ok || !r.code) {
            setErr(r.error ?? 'Something went wrong. Please try again.');
            return;
          }
          setDone(r.code);
        });
      }}
    >
      <H id={`${formId}-title`} className="m-0 text-ods-h2 text-ods-navy">
        {own ? 'Tell us about your project' : 'Start this project'}
      </H>
      <div className="grid gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
        <Field label="Products" required={own} hint={own ? 'What you want to make or open' : undefined}>
          <Input value={v.products} onChange={set('products')} maxLength={160} autoComplete="off" data-testid="tk-products" />
        </Field>
        <Field label="Quantity per item" optional>
          <Input value={v.quantity} onChange={set('quantity')} inputMode="numeric" maxLength={40} autoComplete="off" />
        </Field>
        <Field label="Budget (US$)" optional error={v.budgetUsd ? bErr : null}>
          <Input value={v.budgetUsd} onChange={set('budgetUsd')} inputMode="decimal" maxLength={14} autoComplete="off" data-testid="tk-budget" />
        </Field>
        <Field label="Sell in" optional>
          <Select value={v.country} onChange={set('country')} placeholder="Choose a country">
            {COUNTRIES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Your brief" required hint={`What you want, who it’s for, colours, references (${BRIEF_MIN} characters or more).`}>
        <Textarea value={v.brief} onChange={set('brief')} rows={4} maxLength={4000} data-testid="tk-brief" />
      </Field>
      <Field label="Files" optional>
        <FileDrop
          files={list}
          maxSize={TURNKEY_FILE_MAX_BYTES}
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          acceptLabel="PDF, JPG, PNG or WEBP"
          prompt="Logo, references, drawings · up to 20 MB each"
          disabled={!files.enabled}
          disabledReason={files.enabled ? undefined : files.reason}
          onFilesAdded={(added) =>
            setList((l) => [...l, ...added.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, size: f.size, status: 'error' as const, error: 'Files can’t be sent with this request yet. Send them to your account manager.' }))])
          }
          onRemove={(id) => setList((l) => l.filter((f) => f.id !== id))}
        />
      </Field>
      <div role="note" className="flex gap-3 rounded-ods-control border border-ods-line bg-ods-info-tint p-4 text-ods-body">
        <Icon icon={Info} size="sm" className="mt-0.5 shrink-0 text-ods-info" />
        <p className="m-0">
          <strong className="block text-ods-navy">What happens next</strong>
          Your account manager contacts you to agree the brief and timeline. Nothing is charged until you approve the proforma.
        </p>
      </div>
      {err ? (
        <p role="alert" className="m-0 rounded-ods-control border border-ods-danger bg-ods-danger-tint px-4 py-3 text-ods-body text-ods-danger" data-testid="tk-start-error">
          {err}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">
        <Button type="submit" variant="primary" iconStart={Send} loading={pending} loadingText="Sending…" disabled={Boolean(sendReason)} disabledReason={sendReason} data-testid="tk-send">
          Send project request
        </Button>
        <Button type="button" variant="secondary" iconStart={Check} disabled disabledReason={draftDisabledReason}>
          Save draft
        </Button>
      </div>
    </form>
  );
}
