/**
 * Central icon registry. All inline SVGs across the app map to one of
 * these lucide-react icons — swap 1:1, then import { Icon } from here.
 *
 * Add new icons by extending the ICONS map below. Import only by name
 * (`import { Target } from "lucide-react"`) — never `import * as Icons`
 * — so tree-shaking keeps the bundle tight.
 */
import {
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Gem,
  Info,
  LayoutGrid,
  Menu,
  ReceiptText,
  Search,
  Swords,
  Target,
  TrendingUp,
  User,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ICONS = {
  // Sidebar / nav
  chart: BarChart3,
  brain: Brain,
  games: LayoutGrid,
  target: Target,
  cloud: Cloud,
  slip: ReceiptText,
  bvp: User,
  gem: Gem,
  live: Zap,
  check: CheckCircle2,
  matchup: Swords,
  info: Info,
  trend: TrendingUp,

  // Shell / controls
  menu: Menu,
  close: X,
  search: Search,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number | string;
}

export function Icon({ name, size = 16, className, ...props }: IconProps) {
  const LucideComp: LucideIcon = ICONS[name];
  return <LucideComp width={size} height={size} className={className} {...props} />;
}
