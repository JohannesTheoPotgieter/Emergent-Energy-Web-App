/**
 * Comments + @mentions section for the spine TaskDrawer.
 *
 * Reuses `task_comments` + `task_comment_mentions` via the spine endpoints:
 *   GET  /api/engineering/tasks/:id/comments
 *   POST /api/engineering/tasks/:id/comments { body, mentionedUserIds }
 *
 * The mention autocomplete list is built from the page's `/api/engineering/options`
 * users (passed in as `teamMembers`); no extra fetch.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AtSign, MessageSquare } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/task-formatters";
import type { useToast } from "@/hooks/use-toast";
import type { TeamMember } from "@/components/tasks/types";
import { CommentInputWithMentions } from "../dialogs/CommentInputWithMentions";
import type { SpineCommentsResponse } from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function SpineCommentsSection({
  taskId,
  open,
  toast,
  teamMembers,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
  teamMembers: TeamMember[];
}) {
  const qc = useQueryClient();

  const query = useQuery<SpineCommentsResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "comments"],
    enabled: open,
  });
  const comments = useMemo(() => query.data?.comments ?? [], [query.data]);

  const addMutation = useMutation({
    mutationFn: async ({ body, mentionedUserIds }: { body: string; mentionedUserIds: number[] }) =>
      apiRequest("POST", `/api/engineering/tasks/${taskId}/comments`, { body, mentionedUserIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "comments"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't post comment",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        Comments
      </Label>

      <CommentInputWithMentions
        teamMembers={teamMembers}
        submitting={addMutation.isPending}
        onSubmit={(body, mentionedUserIds) => addMutation.mutate({ body, mentionedUserIds })}
      />

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No comments yet — post the first one above.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border/60 px-2.5 py-2 text-xs" data-testid={`comment-${c.id}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">{c.authorName ?? "Unknown"}</span>
                <span className="text-[10px] text-muted-foreground">{formatDate(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-foreground/90">{c.body}</p>
              {c.mentions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.mentions.map((m) => (
                    <Badge
                      key={m.userId}
                      variant="outline"
                      className="gap-0.5 border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[9px] text-emerald-700"
                    >
                      <AtSign className="h-2.5 w-2.5" />
                      {m.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
