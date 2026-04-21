import type { LucideIcon } from 'lucide-svelte';
import {
  Target,
  TrendingUp,
  RotateCcw,
  PartyPopper,
  ArrowRight,
  FileText,
  Video,
  FolderOpen,
  Folder,
  FolderPlus,
  Share,
  BookOpen,
  Clapperboard,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Check,
  X,
  Pencil,
  Trash2,
  Play,
  Pause,
  Minus,
  Star,
  CheckCircle2,
  Circle,
  ArrowLeft,
  Sun,
  Moon,
  Settings,
} from 'lucide-svelte';

export type ClipRole = 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition' | 'unassigned';

export interface RoleConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  subtleColor: string;
  cssVar: string;
  subtleCssVar: string;
}

export const ROLE_CONFIG: Record<ClipRole, RoleConfig> = {
  setup: {
    label: 'Setup',
    icon: Target,
    color: '#ef4444',
    subtleColor: '#ef444420',
    cssVar: 'var(--role-setup)',
    subtleCssVar: 'var(--role-setup-subtle)',
  },
  escalation: {
    label: 'Escalation',
    icon: TrendingUp,
    color: '#f97316',
    subtleColor: '#f9731620',
    cssVar: 'var(--role-escalation)',
    subtleCssVar: 'var(--role-escalation-subtle)',
  },
  twist: {
    label: 'Twist',
    icon: RotateCcw,
    color: '#eab308',
    subtleColor: '#eab30820',
    cssVar: 'var(--role-twist)',
    subtleCssVar: 'var(--role-twist-subtle)',
  },
  payoff: {
    label: 'Payoff',
    icon: PartyPopper,
    color: '#22c55e',
    subtleColor: '#22c55e20',
    cssVar: 'var(--role-payoff)',
    subtleCssVar: 'var(--role-payoff-subtle)',
  },
  transition: {
    label: 'Transition',
    icon: ArrowRight,
    color: '#3b82f6',
    subtleColor: '#3b82f620',
    cssVar: 'var(--role-transition)',
    subtleCssVar: 'var(--role-transition-subtle)',
  },
  unassigned: {
    label: 'Unassigned',
    icon: FileText,
    color: '#6b7280',
    subtleColor: '#6b728020',
    cssVar: 'var(--role-unassigned)',
    subtleCssVar: 'var(--role-unassigned-subtle)',
  },
};

export const ROLE_KEYS: ClipRole[] = ['setup', 'escalation', 'twist', 'payoff', 'transition', 'unassigned'];

export {
  Target,
  TrendingUp,
  RotateCcw,
  PartyPopper,
  ArrowRight,
  FileText,
  Video,
  FolderOpen,
  Folder,
  FolderPlus,
  Share,
  BookOpen,
  Clapperboard,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Check,
  X,
  Pencil,
  Trash2,
  Play,
  Pause,
  Minus,
  Star,
  CheckCircle2,
  Circle,
  ArrowLeft,
  Sun,
  Moon,
  Settings,
};
