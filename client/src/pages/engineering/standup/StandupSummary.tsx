import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, ArrowRight, AlertTriangle, Users, Clock, BarChart3, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { copyTeamsMessage, escapeHtml } from "@/lib/teams-clipboard";
import { type TaskMovement, type Participant, MOODS, formatTime } from "./types";

interface StandupSummaryProps {
  totalSeconds: number;
  participants: Participant[];
  completedCount: number;
  skippedCount: number;
  speakerTimings: Map<number, number>;
  taskMovements: TaskMovement[];
  moods: Map<number, string>;
  facilitatorNotes: Map<number, string>;
  onClose: () => void;
}

export function StandupSummary({
  totalSeconds,
  participants,
  completedCount,
  skippedCount,
  speakerTimings,
  taskMovements,
  moods,
  facilitatorNotes,
  onClose,
}: StandupSummaryProps) {
  const { toast } = useToast();

  const avgTime = completedCount > 0
    ? Math.round([...speakerTimings.values()].reduce((a, b) => a + b, 0) / completedCount)
    : 0;
  const holdMoves = taskMovements.filter(m => m.toStatus === "HOLD");
  const completedMoves = taskMovements.filter(m => m.toStatus === "COMPLETE");
  const progressMoves = taskMovements.filter(m => m.toStatus === "IN PROGRESS");

  // Build mood distribution
  const moodCounts = new Map<string, number>();
  for (const [, mood] of moods) {
    moodCounts.set(mood, (moodCounts.get(mood) || 0) + 1);
  }

  function buildCopyText(): string {
    const date = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const lines = [
      `Engineering Standup — ${date}`,
      `Duration: ${formatTime(totalSeconds)} | ${completedCount}/${participants.length} participated | Avg: ${formatTime(avgTime)}`,
      "",
    ];

    if (taskMovements.length > 0) {
      lines.push("TASK MOVEMENTS");
      for (const m of taskMovements) {
        lines.push(`  ${m.userName} | ${m.taskTitle} | ${m.fromStatus} → ${m.toStatus}${m.holdReason ? ` (${m.holdReason})` : ""}`);
      }
      lines.push("");
    }

    if (holdMoves.length > 0) {
      lines.push("BLOCKERS");
      for (const m of holdMoves) {
        lines.push(`  • ${m.userName}: ${m.holdReason || m.taskTitle}`);
      }
      lines.push("");
    }

    // Facilitator notes
    const notes = [...facilitatorNotes.entries()].filter(([, n]) => n.trim());
    if (notes.length > 0) {
      lines.push("FACILITATOR NOTES");
      for (const [userId, note] of notes) {
        const p = participants.find(p => p.userId === userId);
        lines.push(`  ${p?.userName || "Unknown"}: ${note}`);
      }
      lines.push("");
    }

    // Mood
    const moodLine = MOODS.map(m => {
      const c = moodCounts.get(m.value) || 0;
      return c > 0 ? `${m.emoji} ${c}` : null;
    }).filter(Boolean).join("  ");
    if (moodLine) lines.push(`Mood: ${moodLine}`);

    return lines.join("\n");
  }

  function buildTeamsHtml(): string {
    const date = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const sections: string[] = [];
    sections.push(
      `<p><strong>🛠️ Engineering Standup — ${escapeHtml(date)}</strong></p>`,
      `<p><em>Duration ${escapeHtml(formatTime(totalSeconds))} · ${completedCount}/${participants.length} participated · Avg ${escapeHtml(formatTime(avgTime))} per person</em></p>`,
    );

    if (taskMovements.length > 0) {
      sections.push("<p><strong>✅ Task movements</strong></p>");
      const items = taskMovements
        .map((m) => {
          const arrow = m.toStatus === "COMPLETE" ? "✅" : m.toStatus === "HOLD" ? "🚧" : m.toStatus === "IN PROGRESS" ? "▶️" : "↔️";
          const reason = m.holdReason ? ` <em>(${escapeHtml(m.holdReason)})</em>` : "";
          return `<li>${arrow} <strong>${escapeHtml(m.userName)}</strong> — ${escapeHtml(m.taskTitle)}: ${escapeHtml(m.fromStatus)} → <strong>${escapeHtml(m.toStatus)}</strong>${reason}</li>`;
        })
        .join("");
      sections.push(`<ul>${items}</ul>`);
    }

    if (holdMoves.length > 0) {
      sections.push("<p><strong>🚧 Blockers raised</strong></p>");
      const items = holdMoves
        .map((m) => `<li><strong>${escapeHtml(m.userName)}</strong>: ${escapeHtml(m.holdReason || m.taskTitle)}</li>`)
        .join("");
      sections.push(`<ul>${items}</ul>`);
    }

    const notes = [...facilitatorNotes.entries()].filter(([, n]) => n.trim());
    if (notes.length > 0) {
      sections.push("<p><strong>📝 Facilitator notes</strong></p>");
      const items = notes
        .map(([userId, note]) => {
          const p = participants.find((pp) => pp.userId === userId);
          return `<li><strong>${escapeHtml(p?.userName || "Unknown")}</strong>: ${escapeHtml(note.trim())}</li>`;
        })
        .join("");
      sections.push(`<ul>${items}</ul>`);
    }

    const moodLine = MOODS.map((m) => {
      const c = moodCounts.get(m.value) || 0;
      return c > 0 ? `${m.emoji} ${c}` : null;
    })
      .filter(Boolean)
      .join(" · ");
    if (moodLine) sections.push(`<p><strong>Mood</strong> — ${moodLine}</p>`);

    return sections.join("\n");
  }

  async function handleCopyPlain() {
    try {
      await navigator.clipboard.writeText(buildCopyText());
      toast({ title: "Summary copied", description: "Plain-text version on clipboard." });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err?.message || "Unable to access clipboard.", variant: "destructive" });
    }
  }

  async function handleCopyTeams() {
    try {
      await copyTeamsMessage({ html: buildTeamsHtml(), plain: buildCopyText() });
      toast({ title: "Copied for Teams", description: "Paste into any Teams chat or channel." });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err?.message || "Unable to access clipboard.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <div className="text-xl font-bold">{formatTime(totalSeconds)}</div>
            <div className="text-[10px] text-muted-foreground">Duration</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Users className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <div className="text-xl font-bold">{completedCount}/{participants.length}</div>
            <div className="text-[10px] text-muted-foreground">Participated</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mx-auto mb-1" />
            <div className="text-xl font-bold text-red-600">{holdMoves.length}</div>
            <div className="text-[10px] text-muted-foreground">New Blockers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <ArrowRight className="h-5 w-5 text-blue-600 mx-auto mb-1" />
            <div className="text-xl font-bold">{taskMovements.length}</div>
            <div className="text-[10px] text-muted-foreground">Tasks Moved</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <BarChart3 className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <div className="text-xl font-bold">{formatTime(avgTime)}</div>
            <div className="text-[10px] text-muted-foreground">Avg per Person</div>
          </CardContent>
        </Card>
      </div>

      {/* Task movements table */}
      {taskMovements.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Task Movements</h3>
            <div className="space-y-1.5">
              {taskMovements.map((m, i) => (
                <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                  <span className="font-medium w-28 truncate shrink-0">{m.userName}</span>
                  <span className="flex-1 truncate">{m.taskTitle}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{m.fromStatus}</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        m.toStatus === "COMPLETE" ? "text-green-600 border-green-200" :
                        m.toStatus === "HOLD" ? "text-red-600 border-red-200" :
                        m.toStatus === "IN PROGRESS" ? "text-blue-600 border-blue-200" : ""
                      }`}
                    >
                      {m.toStatus}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Blockers */}
      {holdMoves.length > 0 && (
        <Card className="border-red-200 dark:border-red-900/40">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Blockers ({holdMoves.length})
            </h3>
            <div className="space-y-2">
              {holdMoves.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-red-600">-</span>
                  <span><span className="font-medium">{m.userName}:</span> {m.holdReason || m.taskTitle}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mood snapshot */}
      {moods.size > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Mood Snapshot</h3>
            <div className="flex items-center gap-4">
              {MOODS.map(m => {
                const count = moodCounts.get(m.value) || 0;
                if (count === 0) return null;
                return (
                  <div key={m.value} className="flex items-center gap-1.5">
                    <span className="text-lg">{m.emoji}</span>
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleCopyTeams} className="gap-1.5 bg-[#5059C9] hover:bg-[#464EB8] text-white" data-testid="btn-copy-for-teams">
          <MessageSquare className="h-4 w-4" /> Copy for Teams
        </Button>
        <Button onClick={handleCopyPlain} variant="outline" className="gap-1.5" data-testid="btn-copy-plain">
          <Copy className="h-4 w-4" /> Copy plain text
        </Button>
        <Button onClick={onClose} className="gap-1.5 ml-auto" data-testid="btn-save-close-summary">
          <CheckCircle2 className="h-4 w-4" /> Save & Close
        </Button>
      </div>
    </div>
  );
}
