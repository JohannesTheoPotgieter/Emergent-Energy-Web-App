/**
 * Resolves a PAGE_REGISTRY `iconKey` string to a Lucide icon component.
 * Centralised so the sidebar, mobile drawer and bottom bar render consistent
 * iconography from the same registry data.
 */
import {
  Activity, AlertTriangle, BarChart3, BookOpen, Building2, Calendar, CalendarCheck,
  CalendarRange, CheckCircle, Circle, ClipboardCheck, ClipboardList, Cloud, CreditCard,
  Database, DollarSign, FileSpreadsheet, FileText, Flag, Flame, FolderOpen, FolderTree,
  GitCompare, GraduationCap, Handshake, History, Home, Inbox, Layers, LayoutDashboard,
  LayoutGrid, Leaf, Link as LinkIcon, ListChecks, ListTodo, Mail, MapPin, MessageSquare,
  MessageSquareText, MessagesSquare, Milestone, Plug, Settings, Shield, ShieldAlert,
  ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Sun, ToggleLeft, TrendingDown,
  TrendingUp, Trophy, User, Users, Wallet, Workflow, Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Activity, AlertTriangle, BarChart3, BookOpen, Building2, Calendar, CalendarCheck,
  CalendarRange, CheckCircle, ClipboardCheck, ClipboardList, Cloud, CreditCard, Database,
  DollarSign, FileSpreadsheet, FileText, Flag, Flame, FolderOpen, FolderTree, GitCompare,
  GraduationCap, Handshake, History, Home, Inbox, Layers, LayoutDashboard, LayoutGrid, Leaf,
  Link: LinkIcon, ListChecks, ListTodo, Mail, MapPin, MessageSquare, MessageSquareText,
  MessagesSquare, Milestone, Plug, Settings, Shield, ShieldAlert, ShieldCheck,
  SlidersHorizontal, Smartphone, Sparkles, Sun, ToggleLeft, TrendingDown, TrendingUp, Trophy,
  User, Users, Wallet, Workflow, Wrench,
};

export function NavIcon({ iconKey, className }: { iconKey?: string; className?: string }) {
  const Icon = (iconKey && ICONS[iconKey]) || Circle;
  return <Icon className={className} aria-hidden="true" />;
}
