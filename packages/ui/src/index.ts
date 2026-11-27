/**
 * @octopus/ui — ODS 1.0 design system (NEW-THEME-MASTER-PROMPT Part 2).
 * Wired as a tsconfig path alias (`@octopus/ui`, `@octopus/ui/*` → packages/ui/src), not a workspace package, so the
 * git-archive + remote-build release needs no install step. CSS (tokens.css + theme.css) is imported once from
 * app/globals.css. Live token and component gallery: /dev/ui (staging only).
 *
 * T1: tokens, Inter, Icon, Logo, OdsThemeRoot. T2: the Part 2.5 components, one file each in ./components, re-exported
 * through the group barrels nav / selection / content / forms / data.
 * Pure token values without React: import from `@octopus/ui/tokens`.
 */
export * from './tokens';
export { OdsThemeRoot } from './theme-root';
export { odsInter } from './fonts';
export { Icon, ODS_ICON_SIZES, ODS_ICON_STROKE, ODS_SERVICE_ICONS, type IconProps, type OdsIconSize } from './icon';
export { Logo, type LogoProps } from './logo';
export { LOGO_ALT, LOGO_FILES, SHOP_TAB, ACCOUNT_TAB, logoLink, logoSize, type LogoArea, type LogoVariant } from './logo-href';

/* ───────── T2 components (Part 2.5). Hooks: import from '@octopus/ui/hooks' (client only). ───────── */
export { cx } from './cx';
export { formatMoney, formatDate, formatTime, formatNumber, MINUS } from './format';
export { buttonClass, type ButtonVariant, type ButtonSize } from './styles';
export { Button, IconButton, CountBadge, Spinner, Kbd, type ButtonProps, type IconButtonProps } from './components/button';
export { Tooltip } from './components/tooltip';
export * from './nav';
export * from './selection';
export * from './content';
export * from './forms';
export * from './data';
