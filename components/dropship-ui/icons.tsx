import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  Check,
  CircleHelp,
  CircleX,
  Clock,
  Code,
  CreditCard,
  DollarSign,
  Download,
  Ellipsis,
  Eye,
  FileText,
  Flag,
  Globe,
  House,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  List,
  Lock,
  Package,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  TriangleAlert,
  Truck,
  Upload,
  User,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon map matching docs/design/dropship-v2/README.md.
 * Line icons 16–20 px, stroke about 1.9, currentColor, aria-hidden="true". No emoji anywhere.
 */
export const DS_ICONS = {
  grid: LayoutGrid,
  search: Search,
  list: List,
  cart: ShoppingCart,
  tag: Tag,
  box: Box,
  package: Package,
  store: Store,
  wallet: Wallet,
  chart: BarChart3,
  card: CreditCard,
  gear: Settings,
  help: CircleHelp,
  plus: Plus,
  check: Check,
  x: X,
  alert: TriangleAlert,
  info: Info,
  stop: CircleX,
  clock: Clock,
  refresh: RefreshCw,
  upload: Upload,
  download: Download,
  truck: Truck,
  link: LinkIcon,
  pencil: Pencil,
  eye: Eye,
  globe: Globe,
  shield: Shield,
  users: Users,
  user: User,
  bell: Bell,
  file: FileText,
  arrow: ArrowRight,
  sparkle: Sparkles,
  code: Code,
  image: ImageIcon,
  scale: Scale,
  percent: Percent,
  home: House,
  more: Ellipsis,
  dollar: DollarSign,
  send: Send,
  layers: Layers,
  activity: Activity,
  flag: Flag,
  lock: Lock,
} as const satisfies Record<string, LucideIcon>;

export type DsIconName = keyof typeof DS_ICONS;

export function DsIcon({
  name,
  size = 18,
  strokeWidth = 1.9,
  className = '',
}: {
  name: DsIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const Comp = DS_ICONS[name];
  return (
    <Comp
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      className={`shrink-0 ${className}`.trim()}
    />
  );
}
