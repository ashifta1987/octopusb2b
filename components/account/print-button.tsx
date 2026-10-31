'use client';
import { useEffect } from 'react';

export function PrintButton({ autoPrint = false, label = 'Print / Save as PDF' }: { autoPrint?: boolean; label?: string }) {
  useEffect(() => {
    if (autoPrint) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [autoPrint]);
  return <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>{label}</button>;
}
