/** Staff password policy (SPEC §17 set-password): at least 10 characters with a letter and a number. Pure. */
export const PASSWORD_MIN = 10;

export function passwordProblem(pw: string, confirm?: string): string | null {
  if (!pw || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  if (confirm !== undefined && pw !== confirm) return 'The two passwords do not match.';
  return null;
}
