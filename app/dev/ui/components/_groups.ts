/** /dev/ui gallery pages (pure module, so server pages can import it too). */
export const GROUPS = [
  { href: '/dev/ui', label: 'Tokens' },
  { href: '/dev/ui/components/navigation', label: 'Navigation' },
  { href: '/dev/ui/components/selection', label: 'Tabs and selection' },
  { href: '/dev/ui/components/content', label: 'Content and data' },
  { href: '/dev/ui/components/forms', label: 'Forms and overlays' },
  { href: '/dev/ui/components/data', label: 'Grid, workspace, palette' },
] as const;
