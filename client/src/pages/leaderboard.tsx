import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
};

const PODIUM_COLORS = [
  "from-yellow-400 to-amber-500",
  "from-gray-300 to-gray-400",
  "from-amber-600 to-amber-700",
];

const LEVEL_COLORS: Record<number, string> = {
  1: "bg-gray-100 text-gray-700",
  2: "bg-blue-100 text-blue-700",
  3: "bg-green-100 text-green-700",
  4: "bg-purple-100 text-purple-700",
  5: "bg-orange-100 text-orange-700",
  6: "bg-red-100 text-red-700",
  7: "bg-yellow-100 text-yellow-800",
  8: "bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800",
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
  { key: "unreadNotifications", label: "Unread Notifs (3d+)", icon: BellOff, color: "text-gray-500" },
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
];

const PENALTY_DETAIL_CONFIG: { key: string; label: string; icon: any; color: string }[] = [
  { key: "overdueTasks", label: "Overdue Tasks", icon: Clock, color: "text-red-500" },
  { key: "plansBehind", label: "Plans Behind >15%", icon: BarChart3, color: "text-orange-500" },
  { key: "qualityFailures", label: "QC Failures", icon: XCircle, color: "text-red-600" },
  { key: "rejectedDeliverables", label: "Rejected Deliverables", icon: FileX, color: "text-amber-600" },
  { key: "openQualityWarnings", label: "Open Warnings", icon: ShieldAlert, color: "text-yellow-600" },
  { key: "overdueEngTasks", label: "Overdue Eng Tasks", icon: Cog, color: "text-red-500" },
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
    <div className="border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden" data-testid={`detail-${config.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <button
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${expanded ? 'bg-muted/30' : ''}`}
        onClick={onToggle}
      >
        <Icon className={`w-4 h-4 shrink-0 ${config.color}`} />
        <span className="text-xs font-medium flex-1 truncate">{config.label}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {cat.count} × {isEarned ? '+' : ''}{cat.perPoint}
        </span>
        <span className={`text-xs font-bold whitespace-nowrap ${isEarned ? 'text-green-600' : 'text-red-500'}`}>
          = {isEarned ? '+' : ''}{cat.total}
        </span>
        {cat.items.length > 0 && (
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>
      {expanded && cat.items.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800 max-h-[200px] overflow-y-auto">
          {cat.items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-gray-50 dark:border-gray-900 last:border-b-0 hover:bg-muted/20">
              <span className="text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <span className="truncate block text-gray-700 dark:text-gray-300">{item.name || 'Unnamed'}</span>
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

  const earnedTotal = detailData ? Object.values(detailData.earned).reduce((s, c) => s + c.total, 0) : 0;
  const penaltyTotal = detailData ? Object.values(detailData.penalties).reduce((s, c) => s + c.total, 0) : 0;
  const participationPts = detailData ? (detailData.pointValues?.participation || 10) : 10;

  return (
    <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        {selectedUser && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-primary" />
                {selectedUser.name}
              </DialogTitle>
              <DialogDescription>
                {ROLE_LABELS[selectedUser.role] || selectedUser.role} — Level {selectedUser.level.level} {selectedUser.level.title}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent" data-testid="text-total-points">
                    {selectedUser.points}
                  </div>
                  <div className="text-[10px] text-muted-foreground">total points</div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Lv.{selectedUser.level.level} {selectedUser.level.title}</span>
                    <span>{selectedUser.level.nextThreshold} pts</span>
                  </div>
                  <Progress
                    value={selectedUser.level.nextThreshold > selectedUser.level.currentThreshold
                      ? ((selectedUser.points - selectedUser.level.currentThreshold) / (selectedUser.level.nextThreshold - selectedUser.level.currentThreshold)) * 100
                      : 100}
                    className="h-2"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                    <span className="text-green-600 font-medium">+{selectedUser.pointsEarned} earned</span>
                    {selectedUser.pointsPenalty < 0 && (
                      <span className="text-red-500 font-medium">{selectedUser.pointsPenalty} deducted</span>
                    )}
                  </div>
                </div>
              </div>

              {selectedUser.badges.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Badges ({selectedUser.badges.length})</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUser.badges.map(b => (
                      <div
                        key={b.key}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px]"
                        title={b.description}
                      >
                        <span>{b.icon}</span>
                        <span className="font-medium">{b.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {loadingDetails && (
                <div className="text-center py-4 text-xs text-muted-foreground">Loading point details...</div>
              )}

              {detailData && (
                <div>
                  <div className="flex items-center gap-1 mb-3">
                    <button
                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${detailTab === 'earned' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'text-muted-foreground hover:bg-muted/50'}`}
                      onClick={() => setDetailTab("earned")}
                      data-testid="btn-earned-tab"
                    >
                      <TrendingUp className="w-3 h-3 inline mr-1" />
                      Earned (+{earnedTotal + participationPts})
                    </button>
                    <button
                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${detailTab === 'penalties' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'text-muted-foreground hover:bg-muted/50'}`}
                      onClick={() => setDetailTab("penalties")}
                      data-testid="btn-penalties-tab"
                    >
                      <TrendingDown className="w-3 h-3 inline mr-1" />
                      Penalties ({penaltyTotal})
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
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-gray-100 dark:border-gray-800">
                        <Users className="w-4 h-4 text-blue-500 shrink-0" />
                        <span className="text-xs font-medium flex-1">Participation Bonus</span>
                        <span className="text-xs font-bold text-green-600">+{participationPts}</span>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 mt-2">
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400">Total Earned</span>
                        <span className="text-sm font-bold text-green-700 dark:text-green-400">+{earnedTotal + participationPts}</span>
                      </div>
                    </div>
                  )}

                  {detailTab === "penalties" && (
                    <div className="space-y-1.5">
                      {penaltyTotal === 0 ? (
                        <div className="text-center py-6 text-sm text-muted-foreground">
                          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                          No penalties — great job!
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
                          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 mt-2">
                            <span className="text-xs font-semibold text-red-700 dark:text-red-400">Total Penalties</span>
                            <span className="text-sm font-bold text-red-700 dark:text-red-400">{penaltyTotal}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20 mt-3">
                    <span className="text-xs font-semibold">Net Total</span>
                    <div className="text-right">
                      <span className="text-sm font-bold">{Math.max(0, earnedTotal + participationPts + penaltyTotal)} pts</span>
                      <div className="text-[10px] text-muted-foreground">
                        +{earnedTotal + participationPts} earned {penaltyTotal < 0 ? ` ${penaltyTotal} penalties` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
      const res = await fetch("/api/gamification/leaderboard", { headers: getAuthHeaders() });
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

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-leaderboard-title">
            <Trophy className="w-7 h-7 text-yellow-500" />
            Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track achievements and compete with your team
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Rankings</TabsTrigger>
            <TabsTrigger value="badges" data-testid="tab-badges">All Badges</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {myEntry && (
        <Card className="border-2 border-primary/20 bg-primary/5 animate-float-in" data-testid="card-my-stats">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold text-lg">
                {myRank > 0 ? `#${myRank}` : "-"}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{myEntry.name}</span>
                  <Badge className={`text-[10px] ${LEVEL_COLORS[myEntry.level.level] || "bg-gray-100"}`}>
                    Lv.{myEntry.level.level} {myEntry.level.title}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm font-medium">{myEntry.points} pts</span>
                  {myEntry.pointsPenalty < 0 && (
                    <span className="text-xs text-red-500 flex items-center gap-0.5">
                      <TrendingDown className="w-3 h-3" />
                      {myEntry.pointsPenalty}
                    </span>
                  )}
                  <div className="flex-1 max-w-[200px]">
                    <Progress
                      value={myEntry.level.nextThreshold > myEntry.level.currentThreshold
                        ? ((myEntry.points - myEntry.level.currentThreshold) / (myEntry.level.nextThreshold - myEntry.level.currentThreshold)) * 100
                        : 100}
                      className="h-2"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {myEntry.level.nextThreshold - myEntry.points} pts to next level
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                {myEntry.badges.slice(0, 5).map(b => (
                  <span key={b.key} className="text-lg" title={b.name}>{b.icon}</span>
                ))}
                {myEntry.badges.length > 5 && (
                  <span className="text-xs text-muted-foreground self-center">+{myEntry.badges.length - 5}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-loading">
          Computing rankings...
        </div>
      )}

      {tab === "leaderboard" && !isLoading && (
        <>
          {topThree.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[1, 0, 2].map((idx) => {
                const entry = topThree[idx];
                if (!entry) return <div key={idx} />;
                const rank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
                const isFirst = rank === 1;

                return (
                  <Card
                    key={entry.userId}
                    className={`cursor-pointer transition-all hover:shadow-lg card-hover animate-float-in stagger-${rank} ${isFirst ? "ring-2 ring-yellow-400 -mt-2" : ""}`}
                    onClick={() => setSelectedUser(entry)}
                    data-testid={`card-rank-${rank}`}
                  >
                    <CardContent className="p-4 text-center">
                      <div className={`w-12 h-12 mx-auto rounded-full bg-gradient-to-br ${PODIUM_COLORS[rank - 1]} flex items-center justify-center text-white font-bold text-lg mb-2`}>
                        {rank === 1 ? <Crown className="w-6 h-6" /> : rank}
                      </div>
                      <div className="font-semibold text-sm truncate">{entry.name}</div>
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        {ROLE_LABELS[entry.role] || entry.role}
                      </Badge>
                      <div className="text-2xl font-bold mt-2 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                        {entry.points}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        points
                        {entry.pointsPenalty < 0 && (
                          <span className="text-red-500 flex items-center gap-0.5">
                            ({entry.pointsPenalty})
                          </span>
                        )}
                      </div>
                      <div className="flex justify-center gap-0.5 mt-2">
                        {entry.badges.slice(0, 4).map(b => (
                          <span key={b.key} className="text-sm" title={b.name}>{b.icon}</span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {rest.length > 0 && (
            <div className="space-y-1">
              {rest.map((entry, i) => (
                <Card
                  key={entry.userId}
                  className="cursor-pointer hover:shadow-sm transition-shadow animate-slide-up-fade"
                  style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s`, animationFillMode: 'both' }}
                  onClick={() => setSelectedUser(entry)}
                  data-testid={`card-rank-${i + 4}`}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                      {i + 4}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{entry.name}</span>
                        <Badge className={`text-[10px] ${LEVEL_COLORS[entry.level.level] || "bg-gray-100"}`}>
                          Lv.{entry.level.level}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {ROLE_LABELS[entry.role] || entry.role}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {entry.badges.slice(0, 3).map(b => (
                          <span key={b.key} className="text-sm">{b.icon}</span>
                        ))}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm">{entry.points} pts</span>
                        {entry.pointsPenalty < 0 && (
                          <div className="text-[10px] text-red-500 flex items-center justify-end gap-0.5">
                            <TrendingDown className="w-2.5 h-2.5" />
                            {entry.pointsPenalty}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {activeEntries.length === 0 && !isLoading && (
            <Card>
              <CardContent className="p-12 text-center">
                <Trophy className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <h3 className="text-lg font-medium">No activity yet</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Start completing tasks, reviewing projects, and approving items to earn points!
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
              <Card
                key={key}
                className={`transition-all animate-scale-in ${earned ? "ring-2 ring-primary/30 bg-primary/5" : "opacity-60"}`}
                style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, animationFillMode: 'both' }}
                data-testid={`badge-card-${key}`}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`text-3xl ${earned ? "" : "grayscale opacity-40"}`}>
                    {badge.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{badge.name}</span>
                      {earned && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{badge.description}</p>
                    <Badge variant="outline" className="text-[10px] mt-1 capitalize">{badge.category}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <UserDetailDialog selectedUser={selectedUser} onClose={() => setSelectedUser(null)} />

      {!isLoading && tab === "leaderboard" && data?.pointValues && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              How Points Work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs font-medium text-green-600 mb-1.5 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                Earn Points
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(data.pointValues).map(([key, pts]) => (
                  <div key={key} className="text-center p-2 rounded-lg bg-muted/50">
                    <div className="text-lg font-bold text-green-600">+{pts}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{key.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            </div>
            {data.penaltyValues && (
              <div>
                <div className="text-xs font-medium text-red-500 mb-1.5 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  Lose Points
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(data.penaltyValues).map(([key, pts]) => (
                    <div key={key} className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30">
                      <div className="text-lg font-bold text-red-500">{pts}</div>
                      <div className="text-[10px] text-red-400/80 capitalize">{key.replace(/_/g, " ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
