import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Trophy,
  Medal,
  Star,
  Zap,
  TrendingUp,
  TrendingDown,
  Crown,
  Target,
  Award,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  ClipboardList,
  FileCheck,
  Wrench,
  ShieldCheck,
  Upload,
  Users,
  AlertTriangle,
  Hammer,
  ClipboardCheck,
  Paperclip,
  Clock,
  BarChart3,
  XCircle,
  FileX,
  ShieldAlert,
  Cog,
  BellOff,
  ClipboardX,
  Flame,
  Sparkles,
  Swords,
} from "lucide-react";

interface BadgeInfo {
  key: string;
  name: string;
  description: string;
  icon: string;
  threshold: number;
  category: string;
  earned?: boolean;
}

interface LeaderboardEntry {
  userId: number;
  name: string;
  role: string;
  points: number;
  pointsEarned: number;
  pointsPenalty: number;
  level: {
    level: number;
    title: string;
    nextThreshold: number;
    currentThreshold: number;
  };
  badges: BadgeInfo[];
  stats: {
    tasksCompleted: number;
    approvalsGiven: number;
    weeklyReviews: number;
    importsCompleted: number;
    projectUpdates: number;
    qualityApprovals: number;
    engStagesCompleted: number;
    engTasksOwned: number;
    opsTasksAssigned: number;
    deliverablesUploaded: number;
  };
  penalties: {
    overdueTasks: number;
    plansBehind: number;
    qualityFailures: number;
    rejectedDeliverables: number;
    openQualityWarnings: number;
    overdueEngTasks: number;
    unreadNotifications: number;
    overdueQmTasks: number;
  };
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  pointValues: Record<string, number>;
  penaltyValues: Record<string, number>;
  badgeDefinitions: Record<string, BadgeInfo>;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ROLE_LABELS: Record<string, string> = {
  COO_ADMIN: "COO",
  CEO_ADMIN: "CEO",
  CCO: "CCO",
  CFO: "CFO",
  PROGRAM_MANAGER: "PM",
  PROGRAM_FINANCE_MANAGER: "Finance",
  CONSTRUCTION_MANAGER: "Construction",
  QUALITY_MANAGER: "Quality",
  ENGINEER: "Engineer",
  PROJECT_MANAGER_SITE: "Site PM",
  ENGINEERING_MANAGER: "Eng Manager",
  ACCOUNTANT: "Accountant",
  admin: "Admin",
  PROJECT_DEVELOPER: "Project Dev",
};

const LEVEL_CONFIG: Record<number, { color: string; bg: string; glow: string; emoji: string }> = {
  1: { color: "text-muted-foreground", bg: "bg-muted", glow: "", emoji: "🌱" },
  2: { color: "text-blue-600", bg: "bg-blue-100", glow: "", emoji: "⚡" },
  3: { color: "text-green-600", bg: "bg-green-100", glow: "", emoji: "🌟" },
  4: { color: "text-purple-600", bg: "bg-purple-100", glow: "shadow-purple-200/50", emoji: "💜" },
  5: { color: "text-orange-600", bg: "bg-orange-100", glow: "shadow-orange-200/50", emoji: "🔥" },
  6: { color: "text-red-600", bg: "bg-red-100", glow: "shadow-red-200/50", emoji: "👑" },
  7: { color: "text-yellow-700", bg: "bg-yellow-100", glow: "shadow-yellow-300/50", emoji: "⚔️" },
  8: { color: "text-fuchsia-600", bg: "bg-gradient-to-r from-purple-100 to-pink-100/40", glow: "shadow-fuchsia-300/60", emoji: "💎" },
};

const STAT_CONFIG = [
  { key: "tasksCompleted", label: "Tasks Done", icon: CheckCircle, color: "text-green-600" },
  { key: "opsTasksAssigned", label: "Ops Tasks", icon: ClipboardCheck, color: "text-cyan-600" },
  { key: "engTasksOwned", label: "Eng Tasks", icon: Hammer, color: "text-amber-600" },
  { key: "projectUpdates", label: "Updates", icon: ClipboardList, color: "text-blue-600" },
  { key: "approvalsGiven", label: "Approvals", icon: ShieldCheck, color: "text-purple-600" },
  { key: "weeklyReviews", label: "Reviews", icon: FileCheck, color: "text-teal-600" },
  { key: "importsCompleted", label: "Imports", icon: Upload, color: "text-orange-600" },
  { key: "qualityApprovals", label: "QC Items", icon: Target, color: "text-pink-600" },
  { key: "engStagesCompleted", label: "Eng Stages", icon: Wrench, color: "text-indigo-600" },
  { key: "deliverablesUploaded", label: "Deliverables", icon: Paperclip, color: "text-rose-600" },
];

const PENALTY_STAT_CONFIG = [
  { key: "overdueTasks", label: "Overdue Tasks", icon: Clock, color: "text-red-500" },
  { key: "plansBehind", label: "Plans Behind", icon: BarChart3, color: "text-orange-500" },
  { key: "qualityFailures", label: "QC Failures", icon: XCircle, color: "text-red-600" },
  { key: "rejectedDeliverables", label: "Rejected Docs", icon: FileX, color: "text-amber-600" },
  { key: "openQualityWarnings", label: "Open Warnings", icon: ShieldAlert, color: "text-yellow-600" },
  { key: "overdueEngTasks", label: "Overdue Eng Tasks", icon: Cog, color: "text-red-500" },
  { key: "unreadNotifications", label: "Unread Notifs (3d+)", icon: BellOff, color: "text-muted-foreground" },
  { key: "overdueQmTasks", label: "Overdue QM Tasks", icon: ClipboardX, color: "text-red-600" },
];

interface DetailCategory {
  count: number;
  perPoint: number;
  total: number;
  items: Array<{ name: string; project: string; date: string | null }>;
}

interface DetailData {
  pointValues: Record<string, number>;
  penaltyValues: Record<string, number>;
  earnedTotal: number;
  penaltyTotal: number;
  netTotal: number;
  participation: number;
  earned: Record<string, DetailCategory>;
  penalties: Record<string, DetailCategory>;
}

const EARNED_DETAIL_CONFIG: { key: string; label: string; icon: any; color: string }[] = [
  { key: "tasksCompleted", label: "Tasks Completed", icon: CheckCircle, color: "text-green-600" },
  { key: "approvalsGiven", label: "Approvals Given", icon: ShieldCheck, color: "text-purple-600" },
  { key: "weeklyReviews", label: "Weekly Reviews", icon: FileCheck, color: "text-teal-600" },
  { key: "importsCompleted", label: "Imports Done", icon: Upload, color: "text-orange-600" },
  { key: "projectUpdates", label: "Project Updates", icon: ClipboardList, color: "text-blue-600" },
  { key: "qualityApprovals", label: "QC Approvals", icon: Target, color: "text-pink-600" },
  { key: "engStagesCompleted", label: "Eng Stages Done", icon: Wrench, color: "text-indigo-600" },
  { key: "deliverablesUploaded", label: "Deliverables", icon: Paperclip, color: "text-rose-600" },
  { key: "engTasksOwned", label: "Eng Tasks Owned", icon: Hammer, color: "text-cyan-600" },
  { key: "opsTasksAssigned", label: "Ops Tasks Assigned", icon: ClipboardCheck, color: "text-emerald-600" },
];

const PENALTY_DETAIL_CONFIG: { key: string; label: string; icon: any; color: string }[] = [
  { key: "overdueTasks", label: "Overdue Tasks", icon: Clock, color: "text-red-500" },
  { key: "plansBehind", label: "Plans Behind >15%", icon: BarChart3, color: "text-orange-500" },
  { key: "qualityFailures", label: "QC Failures", icon: XCircle, color: "text-red-600" },
  { key: "rejectedDeliverables", label: "Rejected Deliverables", icon: FileX, color: "text-amber-600" },
  { key: "openQualityWarnings", label: "Open Warnings", icon: ShieldAlert, color: "text-yellow-600" },
  { key: "overdueEngTasks", label: "Overdue Eng Tasks", icon: Cog, color: "text-red-500" },
  { key: "unreadNotifications", label: "Unread Notifs (3d+)", icon: BellOff, color: "text-muted-foreground" },
  { key: "overdueQmTasks", label: "Overdue QM Tasks", icon: ClipboardX, color: "text-red-600" },
];

function DetailLineItems({ cat, expanded, onToggle, config, type }: {
  cat: DetailCategory;
  expanded: boolean;
  onToggle: () => void;
  config: { label: string; icon: any; color: string };
  type: "earned" | "penalty";
}) {
  if (cat.count === 0) return null;
  const Icon = config.icon;
  const isEarned = type === "earned";

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`detail-${config.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <button
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${expanded ? 'bg-muted/30' : ''}`}
        onClick={onToggle}
      >
        <Icon className={`w-4 h-4 shrink-0 ${config.color}`} />
        <span className="text-xs font-medium flex-1 truncate">{config.label}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {cat.count} x {isEarned ? '+' : ''}{cat.perPoint}
        </span>
        <span className={`text-xs font-bold whitespace-nowrap ${isEarned ? 'text-green-600' : 'text-red-500'}`}>
          = {isEarned ? '+' : ''}{cat.total}
        </span>
        {cat.items.length > 0 && (
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>
      {expanded && cat.items.length > 0 && (
        <div className="border-t border-border max-h-[200px] overflow-y-auto">
          {cat.items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-gray-50 last:border-b-0 hover:bg-muted/20">
              <span className="text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <span className="truncate block text-foreground ">{item.name || 'Unnamed'}</span>
                {item.project && (
                  <span className="text-[10px] text-muted-foreground truncate block">{item.project}</span>
                )}
              </div>
              {item.date && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{item.date}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function XpBar({ current, max, level, title, color }: { current: number; max: number; level: number; title: string; color: string }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 100;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className={`font-bold ${color}`}>Lv.{level} {title}</span>
        <span className="text-muted-foreground">{current} / {max} XP</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color === 'text-fuchsia-600' ? '#c026d3' : color === 'text-yellow-700' ? '#b45309' : '#6366f1'}, ${color === 'text-fuchsia-600' ? '#ec4899' : color === 'text-yellow-700' ? '#eab308' : '#8b5cf6'})`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

function UserDetailDialog({ selectedUser, onClose }: { selectedUser: LeaderboardEntry | null; onClose: () => void }) {
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [detailTab, setDetailTab] = useState<"earned" | "penalties">("earned");

  useEffect(() => {
    if (!selectedUser) {
      setDetailData(null);
      setExpandedSections({});
      setDetailTab("earned");
      return;
    }
    setLoadingDetails(true);
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch(`/api/gamification/user/${selectedUser.userId}/details`, { headers, credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setDetailData(d); setLoadingDetails(false); })
      .catch(() => setLoadingDetails(false));
  }, [selectedUser?.userId]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const earnedTotal = detailData?.earnedTotal ?? 0;
  const penaltyTotal = detailData?.penaltyTotal ?? 0;
  const netTotal = detailData?.netTotal ?? 0;
  const participationPts = detailData?.participation ? (detailData.pointValues?.participation || 10) : 0;

  if (!selectedUser) return null;
  const lvlCfg = LEVEL_CONFIG[selectedUser.level.level] || LEVEL_CONFIG[1];

  return (
    <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto p-0">
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-6 pt-6 pb-8 text-white relative overflow-hidden">
          <div className="absolute top-2 right-2 text-4xl opacity-20">{lvlCfg.emoji}</div>
          <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-card/5 rounded-full" />
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-card/5 rounded-full" />
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2 text-lg">
              <div className="w-10 h-10 rounded-full bg-card/20 flex items-center justify-center text-xl font-bold backdrop-blur-sm">
                {selectedUser.name.charAt(0)}
              </div>
              {selectedUser.name}
            </DialogTitle>
            <DialogDescription className="text-white/70 text-xs">
              {ROLE_LABELS[selectedUser.role] || selectedUser.role}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-end gap-4">
            <div>
              <div className="text-4xl font-black tracking-tight" data-testid="text-total-points">
                {selectedUser.points.toLocaleString()}
              </div>
              <div className="text-white/60 text-xs mt-0.5">total XP</div>
            </div>
            <div className="flex-1 mb-1">
              <div className="flex items-center justify-between text-[10px] text-white/60 mb-1">
                <span className="flex items-center gap-1">
                  <span className="text-sm">{lvlCfg.emoji}</span>
                  Lv.{selectedUser.level.level} {selectedUser.level.title}
                </span>
                <span>Next: {selectedUser.level.nextThreshold.toLocaleString()} XP</span>
              </div>
              <div className="h-3 rounded-full bg-card/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-yellow-300 to-amber-400 transition-all duration-1000 relative overflow-hidden"
                  style={{
                    width: `${selectedUser.level.nextThreshold > selectedUser.level.currentThreshold
                      ? ((selectedUser.points - selectedUser.level.currentThreshold) / (selectedUser.level.nextThreshold - selectedUser.level.currentThreshold)) * 100
                      : 100}%`
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="bg-green-50 text-green-200 px-2 py-0.5 rounded-full font-medium">
              +{selectedUser.pointsEarned.toLocaleString()} earned
            </span>
            {selectedUser.pointsPenalty < 0 && (
              <span className="bg-red-50 text-red-200 px-2 py-0.5 rounded-full font-medium">
                {selectedUser.pointsPenalty.toLocaleString()} penalties
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {selectedUser.badges.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Badges Earned ({selectedUser.badges.length})
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedUser.badges.map(b => (
                  <div
                    key={b.key}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-50 to-yellow-50/30 border border-amber-200/50/30 text-[11px] hover:scale-105 transition-transform cursor-default"
                    title={b.description}
                  >
                    <span className="text-sm">{b.icon}</span>
                    <span className="font-medium text-amber-800">{b.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingDetails && (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <Sparkles className="w-6 h-6 mx-auto mb-2 animate-spin text-purple-600" />
              Loading point breakdown...
            </div>
          )}

          {detailData && (
            <div>
              <div className="flex items-center gap-1 mb-3 bg-muted/30 rounded-lg p-1">
                <button
                  className={`flex-1 text-xs px-3 py-2 rounded-md font-medium transition-all ${detailTab === 'earned' ? 'bg-card shadow-sm text-green-700' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDetailTab("earned")}
                  data-testid="btn-earned-tab"
                >
                  <TrendingUp className="w-3.5 h-3.5 inline mr-1.5" />
                  Earned (+{earnedTotal.toLocaleString()})
                </button>
                <button
                  className={`flex-1 text-xs px-3 py-2 rounded-md font-medium transition-all ${detailTab === 'penalties' ? 'bg-card shadow-sm text-red-700' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDetailTab("penalties")}
                  data-testid="btn-penalties-tab"
                >
                  <TrendingDown className="w-3.5 h-3.5 inline mr-1.5" />
                  Penalties ({penaltyTotal.toLocaleString()})
                </button>
              </div>

              {detailTab === "earned" && (
                <div className="space-y-1.5">
                  {EARNED_DETAIL_CONFIG.map(cfg => {
                    const cat = detailData.earned[cfg.key];
                    if (!cat) return null;
                    return (
                      <DetailLineItems
                        key={cfg.key}
                        cat={cat}
                        expanded={!!expandedSections[cfg.key]}
                        onToggle={() => toggleSection(cfg.key)}
                        config={cfg}
                        type="earned"
                      />
                    );
                  })}
                  {participationPts > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50/20 border border-blue-100/30">
                      <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="text-xs font-medium flex-1">Active User Bonus</span>
                      <span className="text-xs font-bold text-green-600">+{participationPts}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50/20 border border-green-200/40 mt-2">
                    <span className="text-xs font-semibold text-green-700">Total Earned</span>
                    <span className="text-sm font-bold text-green-700">+{earnedTotal.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {detailTab === "penalties" && (
                <div className="space-y-1.5">
                  {penaltyTotal === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">🌟</div>
                      <div className="text-sm font-medium text-green-600">Clean Record!</div>
                      <div className="text-xs text-muted-foreground mt-1">No penalties — keep it up!</div>
                    </div>
                  ) : (
                    <>
                      {PENALTY_DETAIL_CONFIG.map(cfg => {
                        const cat = detailData.penalties[cfg.key];
                        if (!cat || cat.count === 0) return null;
                        return (
                          <DetailLineItems
                            key={cfg.key}
                            cat={cat}
                            expanded={!!expandedSections[`p_${cfg.key}`]}
                            onToggle={() => toggleSection(`p_${cfg.key}`)}
                            config={cfg}
                            type="penalty"
                          />
                        );
                      })}
                      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gradient-to-r from-red-50 to-rose-50/20 border border-red-200/40 mt-2">
                        <span className="text-xs font-semibold text-red-700">Total Penalties</span>
                        <span className="text-sm font-bold text-red-700">{penaltyTotal.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 dark:via-purple-950/20/20 border border-indigo-200/50/30 mt-3">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-500" />
                  <span className="text-sm font-bold">Net Score</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">{netTotal.toLocaleString()} XP</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PodiumCard({ entry, rank, onClick }: { entry: LeaderboardEntry; rank: number; onClick: () => void }) {
  const lvlCfg = LEVEL_CONFIG[entry.level.level] || LEVEL_CONFIG[1];
  const podiumHeightByRank: Record<number, number> = { 1: 200, 2: 160, 3: 140 };
  const podiumColorByRank: Record<number, string> = {
    1: "from-yellow-400 via-amber-300 to-yellow-200 dark:via-amber-700",
    2: "from-gray-300 via-gray-200 to-gray-100 dark:via-gray-700",
    3: "from-amber-700 via-amber-600 to-amber-500 dark:via-amber-700",
  };
  const orderIndex = rank === 1 ? 1 : rank === 2 ? 0 : 2;

  return (
    <div
      className="flex flex-col items-center cursor-pointer group"
      onClick={onClick}
      style={{ order: orderIndex }}
      data-testid={`card-rank-${rank}`}
    >
      <div className="relative mb-2">
        <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black shadow-lg transition-transform group-hover:scale-110 ${rank === 1 ? 'bg-gradient-to-br from-yellow-300 to-amber-500 text-white ring-4 ring-yellow-300/50' : rank === 2 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-foreground ring-4 ring-gray-300/50' : 'bg-gradient-to-br from-amber-500 to-amber-700 text-white ring-4 ring-amber-400/50'}`}>
          {entry.name.charAt(0)}
        </div>
        {rank === 1 && (
          <Crown className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 text-yellow-500 drop-shadow-lg animate-bounce-slow" />
        )}
        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-md ${rank === 1 ? 'bg-yellow-500 text-white' : rank === 2 ? 'bg-gray-400 text-white' : 'bg-amber-600 text-white'}`}>
          {rank}
        </div>
      </div>

      <div className="text-center mb-2">
        <div className="font-bold text-sm truncate max-w-[120px] group-hover:text-primary transition-colors">{entry.name}</div>
        <div className="text-[10px] text-muted-foreground">{ROLE_LABELS[entry.role] || entry.role}</div>
      </div>

      <div className={`rounded-t-xl w-full flex flex-col items-center justify-end bg-gradient-to-t ${podiumColorByRank[rank]} transition-all group-hover:shadow-lg relative overflow-hidden`}
        style={{ height: podiumHeightByRank[rank], minWidth: rank === 1 ? 140 : 120 }}
      >
        {rank === 1 && <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/10 to-white/20" />}
        <div className="text-center pb-4 relative z-10">
          <div className={`text-3xl sm:text-4xl font-black ${rank === 1 ? 'text-white' : rank === 2 ? 'text-foreground' : 'text-white'}`}>
            {entry.points.toLocaleString()}
          </div>
          <div className={`text-[10px] font-medium ${rank === 1 ? 'text-white/70' : rank === 2 ? 'text-muted-foreground' : 'text-white/70'}`}>XP</div>
          {entry.pointsPenalty < 0 && (
            <div className="text-[10px] text-red-700 font-medium mt-0.5">{entry.pointsPenalty}</div>
          )}
          <div className="flex justify-center gap-0.5 mt-2">
            {entry.badges.slice(0, 4).map(b => (
              <span key={b.key} className="text-base drop-shadow" title={b.name}>{b.icon}</span>
            ))}
          </div>
          <div className={`text-[10px] mt-1 font-medium ${rank === 1 ? 'text-yellow-200' : rank === 2 ? 'text-muted-foreground ' : 'text-amber-200'}`}>
            {lvlCfg.emoji} Lv.{entry.level.level} {entry.level.title}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const { allowed: canView } = usePermission('leaderboard', 'view');
  const [selectedUser, setSelectedUser] = useState<LeaderboardEntry | null>(null);
  const [tab, setTab] = useState<"leaderboard" | "badges">("leaderboard");

  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/gamification/leaderboard"],
    queryFn: async () => {
      const res = await fetch("/api/gamification/leaderboard", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const entries = data?.leaderboard || [];
  const activeEntries = entries.filter(e => e.points > 0);
  const topThree = activeEntries.slice(0, 3);
  const rest = activeEntries.slice(3);
  const myEntry = entries.find(e => e.userId === (user as any)?.id);
  const myRank = activeEntries.findIndex(e => e.userId === (user as any)?.id) + 1;

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const myLvlCfg = myEntry ? (LEVEL_CONFIG[myEntry.level.level] || LEVEL_CONFIG[1]) : LEVEL_CONFIG[1];

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30">
            <Trophy className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight" data-testid="text-leaderboard-title">
              Leaderboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Compete, earn XP, and climb the ranks
            </p>
          </div>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="bg-muted/50">
            <TabsTrigger value="leaderboard" data-testid="tab-leaderboard" className="gap-1.5">
              <Swords className="w-3.5 h-3.5" />
              Rankings
            </TabsTrigger>
            <TabsTrigger value="badges" data-testid="tab-badges" className="gap-1.5">
              <Medal className="w-3.5 h-3.5" />
              Badges
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {myEntry && (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 p-4 sm:p-5 text-white shadow-xl shadow-purple-200/30 dark:shadow-purple-900/30 animate-float-in" data-testid="card-my-stats">
          <div className="absolute top-0 right-0 w-40 h-40 bg-card/5 rounded-full -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 left-20 w-24 h-24 bg-card/5 rounded-full translate-y-1/2" />

          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-card/20 flex items-center justify-center text-2xl font-black backdrop-blur-sm ring-2 ring-white/30">
              {myRank > 0 ? `#${myRank}` : "-"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-lg">{myEntry.name}</span>
                <span className="text-xs bg-card/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  {myLvlCfg.emoji} Lv.{myEntry.level.level} {myEntry.level.title}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xl font-black">{myEntry.points.toLocaleString()} XP</span>
                {myEntry.pointsPenalty < 0 && (
                  <span className="text-xs bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded-full">
                    {myEntry.pointsPenalty}
                  </span>
                )}
              </div>
              <div className="mt-2">
                <div className="h-2.5 rounded-full bg-card/20 overflow-hidden max-w-xs">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-300 to-amber-400 transition-all duration-1000 relative overflow-hidden"
                    style={{
                      width: `${myEntry.level.nextThreshold > myEntry.level.currentThreshold
                        ? ((myEntry.points - myEntry.level.currentThreshold) / (myEntry.level.nextThreshold - myEntry.level.currentThreshold)) * 100
                        : 100}%`
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                  </div>
                </div>
                <span className="text-[10px] text-white/60 mt-0.5 block">
                  {Math.max(0, myEntry.level.nextThreshold - myEntry.points).toLocaleString()} XP to next level
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 justify-end max-w-[120px]">
              {myEntry.badges.slice(0, 6).map(b => (
                <span key={b.key} className="text-xl drop-shadow-lg hover:scale-125 transition-transform cursor-default" title={b.name}>{b.icon}</span>
              ))}
              {myEntry.badges.length > 6 && (
                <span className="text-xs text-white/50 self-center">+{myEntry.badges.length - 6}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16" data-testid="text-loading">
          <div className="inline-flex items-center gap-3 text-muted-foreground">
            <Sparkles className="w-6 h-6 animate-spin text-purple-600" />
            <span className="text-sm font-medium">Computing rankings...</span>
          </div>
        </div>
      )}

      {tab === "leaderboard" && !isLoading && (
        <>
          {topThree.length > 0 && (
            <div className="flex items-end justify-center gap-3 sm:gap-6 pt-8 pb-2">
              {topThree.map((entry, idx) => (
                <PodiumCard
                  key={entry.userId}
                  entry={entry}
                  rank={idx + 1}
                  onClick={() => setSelectedUser(entry)}
                />
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div className="space-y-2 mt-2">
              {rest.map((entry, i) => {
                const rank = i + 4;
                const lvlCfg = LEVEL_CONFIG[entry.level.level] || LEVEL_CONFIG[1];
                const hasPenalties = entry.pointsPenalty < 0;

                return (
                  <div
                    key={entry.userId}
                    className="flex items-center gap-3 p-3 rounded-xl bg-card  border border-border cursor-pointer hover:shadow-md hover:border-primary/20 transition-all group animate-slide-up-fade"
                    style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s`, animationFillMode: 'both' }}
                    onClick={() => setSelectedUser(entry)}
                    data-testid={`card-rank-${rank}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm font-black text-muted-foreground shrink-0">
                      {rank}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm truncate group-hover:text-primary transition-colors">{entry.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${lvlCfg.bg} ${lvlCfg.color}`}>
                          {lvlCfg.emoji} Lv.{entry.level.level}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground hidden sm:inline">
                          {ROLE_LABELS[entry.role] || entry.role}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted mt-1.5 max-w-[180px] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all duration-700"
                          style={{ width: `${Math.min(100, (entry.points / (activeEntries[0]?.points || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex gap-0.5">
                        {entry.badges.slice(0, 3).map(b => (
                          <span key={b.key} className="text-base" title={b.name}>{b.icon}</span>
                        ))}
                      </div>
                      <div className="text-right min-w-[60px]">
                        <div className="font-black text-sm">{entry.points.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground">XP</div>
                        {hasPenalties && (
                          <div className="text-[9px] text-red-500 font-medium">{entry.pointsPenalty}</div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeEntries.length === 0 && !isLoading && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <div className="text-5xl mb-4">🏆</div>
                <h3 className="text-lg font-bold">No Rankings Yet</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                  Start completing tasks, reviewing projects, and approving items to earn XP and climb the leaderboard!
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "badges" && !isLoading && data?.badgeDefinitions && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(data.badgeDefinitions).map(([key, badge], idx) => {
            const earned = myEntry?.badges.some(b => b.key === key);
            return (
              <div
                key={key}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-all animate-scale-in ${
                  earned
                    ? "bg-gradient-to-r from-amber-50 to-yellow-50/20 border-amber-200/40 shadow-sm"
                    : "bg-muted  border-border opacity-50"
                }`}
                style={{ animationDelay: `${Math.min(idx * 0.03, 0.4)}s`, animationFillMode: 'both' }}
                data-testid={`badge-card-${key}`}
              >
                <div className={`text-3xl ${earned ? "drop-shadow-lg" : "grayscale opacity-40"} transition-all`}>
                  {badge.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${earned ? "text-amber-800" : "text-gray-400"}`}>{badge.name}</span>
                    {earned && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{badge.description}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full inline-block mt-1 capitalize ${
                    badge.category === 'penalties' ? 'bg-red-100 text-red-600' :
                    badge.category === 'excellence' ? 'bg-green-100 text-green-600' :
                    'bg-muted text-muted-foreground'
                  }`}>{badge.category}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <UserDetailDialog selectedUser={selectedUser} onClose={() => setSelectedUser(null)} />

      {!isLoading && tab === "leaderboard" && data?.pointValues && (
        <div className="rounded-xl border border-border bg-card  overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-border">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              How XP Works
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className="text-xs font-bold text-green-600 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                <TrendingUp className="w-3.5 h-3.5" />
                Earn XP
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(data.pointValues).map(([key, pts]) => (
                  <div key={key} className="text-center p-2.5 rounded-lg bg-gradient-to-b from-green-50 to-emerald-50/20 border border-green-100/30">
                    <div className="text-lg font-black text-green-600">+{pts}</div>
                    <div className="text-[10px] text-green-600/70 capitalize font-medium">{key.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            </div>
            {data.penaltyValues && (
              <div>
                <div className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Lose XP
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(data.penaltyValues).map(([key, pts]) => (
                    <div key={key} className="text-center p-2.5 rounded-lg bg-gradient-to-b from-red-50 to-rose-50/20 border border-red-100/30">
                      <div className="text-lg font-black text-red-500">{pts}</div>
                      <div className="text-[10px] text-red-600/80 capitalize font-medium">{key.replace(/_/g, " ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
