/** Office IP allow-list matcher (SPEC §17.3 "Optional IP rule"). Supports exact IPv4/IPv6 and IPv4 CIDR (203.0.113.0/24). Pure. */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function normalise(ip: string): string {
  return ip.trim().toLowerCase().replace(/^::ffff:/, '');
}

/** Does `ip` match one allow-list entry (exact IP or IPv4 CIDR)? */
export function ipMatches(ip: string, entry: string): boolean {
  const addr = normalise(ip);
  const rule = normalise(entry);
  if (!addr || !rule) return false;
  if (!rule.includes('/')) return addr === rule;
  const [base, bitsRaw] = rule.split('/');
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(addr);
  const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

export function ipAllowed(ip: string | null | undefined, allowlist: string[] | null | undefined): boolean {
  if (!ip) return false;
  return (allowlist ?? []).some((e) => typeof e === 'string' && ipMatches(ip, e));
}

export type StaffSecurity = {
  enforce_aal2: boolean;
  lockout_attempts: number;
  lockout_minutes: number;
  idle_minutes: number;
  max_session_hours: number;
  step_up_minutes: number;
  trust_hours: number;
  ip_allowlist: string[];
  ip_rule_roles: string[];
  ip_rule_enabled: boolean;
  google_domain: string;
  staff_email_domains: string[];
};

export const DEFAULT_STAFF_SECURITY: StaffSecurity = {
  enforce_aal2: true, lockout_attempts: 5, lockout_minutes: 15, idle_minutes: 30, max_session_hours: 12, step_up_minutes: 10,
  trust_hours: 12, ip_allowlist: [], ip_rule_roles: ['admin', 'finance'], ip_rule_enabled: false, google_domain: 'octopusb2b.com',
  staff_email_domains: ['octopusb2b.com', 'demo.octopusb2b.com'],
};

/** Is this person blocked by the office IP rule? */
export function ipRuleBlocks(sec: Pick<StaffSecurity, 'ip_rule_enabled' | 'ip_rule_roles' | 'ip_allowlist'>, roles: string[], ip: string | null): boolean {
  if (!sec.ip_rule_enabled) return false;
  if (!roles.some((r) => (sec.ip_rule_roles ?? []).includes(r))) return false;
  return !ipAllowed(ip, sec.ip_allowlist);
}
