'use client';
import Form from 'next/form';
import { useRef } from 'react';

/** Small client wrapper: GET filter form that re-submits (client navigation) when a checkbox/select changes. */
export function FilterForm({ id, action, children, className }: { id: string; action: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Form
      ref={ref}
      id={id}
      action={action}
      scroll={false}
      className={className}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement | HTMLSelectElement;
        if (t.tagName === 'SELECT' || (t as HTMLInputElement).type === 'checkbox') ref.current?.requestSubmit();
      }}
    >
      {children}
    </Form>
  );
}

/** Sort select that lives outside the sidebar but submits the same form via the `form` attribute. */
export function SortSelect({ form, value, options }: { form: string; value: string; options: [string, string][] }) {
  return (
    <select
      id="sort" name="sort" form={form} defaultValue={value} className="input !min-h-10 !w-auto text-sm"
      onChange={() => (document.getElementById(form) as HTMLFormElement | null)?.requestSubmit()}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
