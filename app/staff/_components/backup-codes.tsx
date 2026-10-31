'use client';
import { useState } from 'react';

/** Shows freshly issued backup codes once, with copy + download (SPEC §17.2). */
export function BackupCodesPanel({ codes, email, onDone, doneLabel = 'I saved my codes — continue' }: {
  codes: string[]; email: string; onDone: () => void; doneLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `Octopus B2B staff backup codes for ${email}\nGenerated ${new Date().toISOString()}\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); setSaved(true); } catch { setCopied(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'octopus-b2b-backup-codes.txt'; a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-[#F3D9A6] bg-[#FFF8EB] rounded-[10px] px-3.5 py-3 text-[13px] leading-[1.45] text-[#6B4A07]">
        These {codes.length} backup codes are shown only once. Each works one time if you lose your phone; using one lets you set up a new authenticator.
      </div>
      <ol className="grid grid-cols-2 gap-2 list-none m-0 p-4 bg-white border border-line rounded-[10px]" aria-label="Backup codes">
        {codes.map((c) => <li key={c} className="font-mono text-[15px] font-semibold tracking-wider text-center py-1">{c}</li>)}
      </ol>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy codes'}</button>
        <button type="button" className="btn btn-ghost" onClick={download}>Download .txt</button>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-[#3B4556]">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="w-[18px] h-[18px] mt-0.5 accent-blue" />
        I have saved these codes somewhere safe
      </label>
      <button type="button" className="btn btn-primary w-full min-h-[50px]" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
