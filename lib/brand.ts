/**
 * Brand colours for places that cannot use CSS variables: e-mail HTML, PDF/print HTML, the web manifest and
 * the browser theme colour. Same values as the tokens in app/globals.css (the one source for the UI).
 */
export const BRAND = {
  ink: '#1A174A',        // Octopus Ink — headings, header bars, footer
  ink2: '#2C2870',
  coral: '#4977BC',      // Coral Blue — filled buttons with white text only
  coralText: '#3C66A8',  // Coral text — links and coral text on light backgrounds
  pearl: '#FFFDEF',      // Aqua Pearl — page background
  black: '#231F20',      // Trench Black — body text
  muted: '#5A6475',
  line: '#E5E2D4',
  lineStrong: '#CDC9B6',
  fill: '#EFEDE2',
  tint: '#E4EBF6',
  white: '#FFFFFF',
  // status (unchanged)
  ok: '#15803D', okBg: '#DCFCE7', warn: '#92400E', warnBg: '#FEF3C7', bad: '#991B1B', badBg: '#FEE2E2',
} as const;

/** The colour logo on white, for e-mails and PDFs (absolute URL needed in mail clients). */
export const brandLogoUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/brand/octopus-b2b-logo.png`;

