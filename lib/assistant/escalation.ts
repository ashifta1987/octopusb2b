/** Escalation pre-checks for Octo (SPEC §20.2). Pure functions — unit tested. */

export type OfficeHours = { timezone?: string; days?: number[]; start?: string; end?: string };
export type PreReason = 'customer_request' | 'sensitive_topic' | 'vip' | 'after_hours';
export type PreCheck = { reason: PreReason; detail?: string } | null;

/** Explicit request for a human ("human", "talk to someone", "account manager", "escalate", "agent"). */
export const HUMAN_REQUEST_RE =
  /\b(human(?:s| being)?|real person|(?:talk|speak|chat) (?:to|with) (?:someone|somebody|a person|a real person|staff)|account manager|escalat(?:e|ed|ion)|agent)\b/i;

export function isHumanRequest(text: string) {
  return HUMAN_REQUEST_RE.test(text);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive topic match (allows common inflections: refunds, refunded, cancellation…). Returns the topic matched. */
export function matchSensitiveTopic(text: string, topics: readonly string[]): string | null {
  for (const raw of topics) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const body = t.split(/\s+/).map(escapeRe).join('\\s+');
    const re = new RegExp(`\\b${body}(?:s|es|ed|d|ing|led|ling|lation|lations)?\\b`, 'i');
    if (re.test(text)) return t;
  }
  return null;
}

export function isVip(orgId: string | null | undefined, vipIds: readonly unknown[]) {
  return !!orgId && vipIds.map(String).includes(orgId);
}

/** ISO weekday 1 (Mon) … 7 (Sun) and minutes since midnight in the given time zone. */
function zoned(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMin = (hhmm: string | undefined, d: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : d;
};

/** True when `now` falls inside the account manager's office hours (unknown/invalid hours → treated as open). */
export function isWithinOfficeHours(hours: OfficeHours | null | undefined, now = new Date()) {
  if (!hours) return true;
  let z;
  try {
    z = zoned(now, hours.timezone || 'UTC');
  } catch {
    return true;
  }
  const days = Array.isArray(hours.days) && hours.days.length ? hours.days.map(Number) : [1, 2, 3, 4, 5];
  if (!days.includes(z.day)) return false;
  const start = toMin(hours.start, 9 * 60);
  const end = toMin(hours.end, 18 * 60);
  return z.minutes >= start && z.minutes < end;
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TZ_SHORT: Record<string, string> = { 'Asia/Shanghai': 'CST', 'Asia/Hong_Kong': 'HKT', UTC: 'UTC', 'Europe/London': 'UK time', 'Asia/Dubai': 'GST' };

/** "Mon–Fri 09:00–18:00 CST" */
export function officeHoursLabel(hours: OfficeHours | null | undefined) {
  if (!hours) return null;
  const days = (Array.isArray(hours.days) && hours.days.length ? hours.days : [1, 2, 3, 4, 5]).map(Number).sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayLabel = contiguous && days.length > 1 ? `${DAY[days[0]]}–${DAY[days[days.length - 1]]}` : days.map((d) => DAY[d]).join(', ');
  const tz = TZ_SHORT[hours.timezone ?? ''] ?? hours.timezone ?? '';
  return `${dayLabel} ${hours.start ?? '09:00'}–${hours.end ?? '18:00'}${tz ? ` ${tz}` : ''}`;
}

export type PreCheckInput = {
  text: string;
  topics: readonly string[];
  vipIds: readonly unknown[];
  orgId: string | null;
  hours: OfficeHours | null;
  preferHuman?: boolean;
  now?: Date;
};

/** First matching trigger wins: explicit request → sensitive topic → VIP → after hours (only when the customer chose "wait for a human"). */
export function detectEscalation(i: PreCheckInput): PreCheck {
  if (isHumanRequest(i.text)) return { reason: 'customer_request' };
  const topic = matchSensitiveTopic(i.text, i.topics);
  if (topic) return { reason: 'sensitive_topic', detail: topic };
  if (isVip(i.orgId, i.vipIds)) return { reason: 'vip' };
  if (i.preferHuman && !isWithinOfficeHours(i.hours, i.now)) return { reason: 'after_hours' };
  return null;
}

/** Octo's short handoff line for a pre-check trigger (never claims to be human). */
export function handoffReply(c: NonNullable<PreCheck>, managerName: string | null, hoursLabel: string | null) {
  const who = managerName ? `${managerName}, your account manager` : 'your account team';
  switch (c.reason) {
    case 'customer_request':
      return `Of course — I'm handing you now to ${who}. Everything we discussed is attached, and they'll reply right here.`;
    case 'sensitive_topic':
      return `Anything involving ${c.detail ? `"${c.detail}"` : 'this topic'} needs a human to review and sign off — I can't approve it myself. I'm handing you now to ${who}; your messages are attached to the ticket.`;
    case 'vip':
      return `As a priority customer, your messages go straight to ${who}. They'll reply here shortly — I'll stay in the background to help them with facts.`;
    case 'after_hours':
      return `${managerName ?? 'Your account manager'} is outside office hours right now${hoursLabel ? ` (${hoursLabel})` : ''}. I've queued this for them and they'll reply here when they're back.`;
  }
}
