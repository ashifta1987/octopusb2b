'use client';
import { useEffect, useRef } from 'react';
import { recordSessionExpiry } from './actions';

/** Records auth.session_expired once (the proxy left a signed marker cookie). */
export function ExpiryRecorder() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void recordSessionExpiry();
  }, []);
  return null;
}
