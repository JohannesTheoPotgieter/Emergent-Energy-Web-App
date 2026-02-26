import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
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
  Crown,
  Target,
  Award,
  ChevronRight,
  CheckCircle,
  ClipboardList,
  FileCheck,
  Wrench,
  ShieldCheck,
  Upload,
  Users,
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
  };
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  pointValues: Record<string, number>;
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
  { key: "projectUpdates", label: "Updates", icon: ClipboardList, color: "text-blue-600" },
  { key: "approvalsGiven", label: "Approvals", icon: ShieldCheck, color: "text-purple-600" },
  { key: "weeklyReviews", label: "Reviews", icon: FileCheck, color: "text-teal-600" },
  { key: "importsCompleted", label: "Imports", icon: Upload, color: "text-orange-600" },
  { key: "qualityApprovals", label: "QC Items", icon: Target, color: "text-pink-600" },
  { key: "engStagesCompleted", label: "Eng Stages", icon: Wrench, color: "text-indigo-600" },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
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
        <Card className="border-2 border-primary/20 bg-primary/5" data-testid="card-my-stats">
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
                    className={`cursor-pointer transition-all hover:shadow-lg ${isFirst ? "ring-2 ring-yellow-400 -mt-2" : ""}`}
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
                      <div className="text-[10px] text-muted-foreground">points</div>
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
                  className="cursor-pointer hover:shadow-sm transition-shadow"
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
                      <span className="font-bold text-sm w-16 text-right">{entry.points} pts</span>
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
          {Object.entries(data.badgeDefinitions).map(([key, badge]) => {
            const earned = myEntry?.badges.some(b => b.key === key);
            return (
              <Card
                key={key}
                className={`transition-all ${earned ? "ring-2 ring-primary/30 bg-primary/5" : "opacity-60"}`}
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

      <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DialogContent className="sm:max-w-[480px]">
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
                  <div className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                    {selectedUser.points}
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
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">Badges ({selectedUser.badges.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedUser.badges.map(b => (
                      <div
                        key={b.key}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted text-xs"
                        title={b.description}
                      >
                        <span>{b.icon}</span>
                        <span className="font-medium">{b.name}</span>
                      </div>
                    ))}
                    {selectedUser.badges.length === 0 && (
                      <span className="text-xs text-muted-foreground">No badges earned yet</span>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">Activity Breakdown</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {STAT_CONFIG.map(stat => {
                      const Icon = stat.icon;
                      const val = (selectedUser.stats as any)[stat.key] || 0;
                      return (
                        <div key={stat.key} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                          <Icon className={`w-4 h-4 ${stat.color}`} />
                          <div>
                            <div className="text-sm font-bold">{val}</div>
                            <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {!isLoading && tab === "leaderboard" && data?.pointValues && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              How Points Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(data.pointValues).map(([key, pts]) => (
                <div key={key} className="text-center p-2 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold text-primary">+{pts}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{key.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
