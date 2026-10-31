/** RFC 7807 problem+json responses for the public API (SPEC §7). */
export type ProblemExtra = Record<string, unknown> & { headers?: Record<string, string> };

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Service Unavailable',
};

export function problem(status: number, code: string, detail?: string, extra: ProblemExtra = {}) {
  const { headers, ...rest } = extra;
  const body = {
    type: `https://docs.octopusb2b.com/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail: detail ?? TITLES[status] ?? code,
    ...rest,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...(headers ?? {}) },
  });
}

/** Maps RPC error codes (raise exception 'CODE: …') to HTTP problems. */
export function problemFromDb(e: { message?: string; code?: string } | null | undefined) {
  const msg = e?.message ?? 'Database error';
  const code = msg.split(':')[0].trim();
  const map: Record<string, number> = {
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    NO_ORG: 403,
    WALLET_INSUFFICIENT: 409,
    WALLET_DISABLED: 409,
    QUOTE_EXPIRED: 409,
    QUOTE_NOT_APPROVABLE: 409,
    INVALID_TRANSITION: 409,
    TERMS_NOT_CURRENT: 422,
    INVALID_QUANTITY: 422,
    INVALID_AMOUNT: 422,
    SERVICE_INACTIVE: 422,
  };
  const status = map[code];
  if (status) return problem(status, code, msg);
  console.error('[api] unexpected db error', msg);
  return problem(500, 'INTERNAL', 'Unexpected error. Please retry with the same Idempotency-Key.');
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers ?? {}) },
  });
}
