'use client';
import { useEffect } from 'react';
import { logTurnkeySignal } from '../actions';

/** Logs one "view" per project page load (best-effort, rate-limited server-side). */
export function ViewSignal({ projectId }: { projectId: string }) {
  useEffect(() => {
    const k = `tk-view:${projectId}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch { /* private mode */ }
    void logTurnkeySignal('view', projectId, null);
  }, [projectId]);
  return null;
}

