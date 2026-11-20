import Forbidden from './forbidden/page';

/** 403 page for forbidden() (authInterrupts) — same "No access" screen as /forbidden (item 3, distributor portal). */
export default function ForbiddenBoundary() {
  return <Forbidden />;
}
