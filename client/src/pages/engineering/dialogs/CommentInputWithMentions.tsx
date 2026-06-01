/**
 * Comment input with @-mention popover — extracted from EngineeringTaskDrawer.
 *
 * Three useState slots (commentText, showMentions, mentionQuery) used to live
 * on the parent drawer, so every keystroke re-rendered every other block in
 * the drawer. Here they are local: only this small subtree re-renders on input.
 */
import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { getAvatarColor, getInitials } from "@/lib/task-formatters";
import type { TeamMember } from "@/components/tasks/types";

export interface CommentInputWithMentionsProps {
  teamMembers: TeamMember[];
  onSubmit: (body: string) => void;
  submitting: boolean;
}

export function CommentInputWithMentions({ teamMembers, onSubmit, submitting }: CommentInputWithMentionsProps) {
  const [text, setText] = useState<string>("");
  const [showMentions, setShowMentions] = useState<boolean>(false);
  const [mentionQuery, setMentionQuery] = useState<string>("");

  function handleChange(next: string) {
    setText(next);
    const atIdx = next.lastIndexOf("@");
    if (atIdx >= 0 && atIdx === next.length - 1) {
      setMentionQuery("");
      setShowMentions(true);
    } else if (atIdx >= 0 && !next.substring(atIdx).includes(" ")) {
      setMentionQuery(next.substring(atIdx + 1).toLowerCase());
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && showMentions) { setShowMentions(false); e.stopPropagation(); return; }
    if (e.key === "Enter" && !e.shiftKey && text.trim() && !showMentions) {
      submit();
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    onSubmit(body);
    setText("");
  }

  const filteredMembers = teamMembers.filter(m => !mentionQuery || m.fullName.toLowerCase().includes(mentionQuery));

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Add a comment... use @ to mention"
          className="text-sm"
          onKeyDown={handleKeyDown}
          data-testid="input-comment"
        />
        {showMentions && (
          <div role="listbox" aria-label="Mention a teammate" className="absolute bottom-full left-0 w-full mb-1 bg-white border rounded-md shadow-lg z-50 max-h-[150px] overflow-y-auto">
            {filteredMembers.slice(0, 6).map(m => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={false}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
                onClick={() => {
                  const atIdx = text.lastIndexOf("@");
                  setText(text.substring(0, atIdx) + `@${m.fullName} `);
                  setShowMentions(false);
                }}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${getAvatarColor(m.fullName)}`}>
                  {getInitials(m.fullName)}
                </div>
                <span className="font-medium">{m.fullName}</span>
                <span className="text-muted-foreground ml-auto">{m.role}</span>
              </button>
            ))}
            {filteredMembers.length === 0 && (
              <p className="text-xs text-muted-foreground p-2 text-center">No matches</p>
            )}
          </div>
        )}
      </div>
      <Button
        size="icon"
        className="h-9 w-9 shrink-0"
        disabled={!text.trim() || submitting}
        onClick={submit}
        aria-label="Post comment"
        data-testid="btn-send-comment"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
