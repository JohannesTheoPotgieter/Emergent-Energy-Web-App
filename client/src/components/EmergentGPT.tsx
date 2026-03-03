import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, X, Send, Loader2, Sparkles, Trash2, Minimize2 } from "lucide-react";
import { usePermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function EmergentGPT() {
  const { allowed, loading } = usePermission("emergent_gpt", "view");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [location] = useLocation();

  const projectMatch = location.match(/\/projects\/([^/?]+)/);
  const projectName = projectMatch ? decodeURIComponent(projectMatch[1]) : undefined;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && !minimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: newMessages,
          screenPath: location,
          projectName,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: err.error || "Sorry, something went wrong." };
          return updated;
        });
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      if (reader) {
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") { streamDone = true; break; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulated += parsed.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: accumulated };
                  return updated;
                });
              }
              if (parsed.error) {
                accumulated += `\n\nError: ${parsed.error}`;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: accumulated };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: "Sorry, I couldn't connect to the AI service. Please try again." };
        return updated;
      });
    }

    setStreaming(false);
  }, [input, messages, streaming, location, projectName]);

  if (loading || !allowed) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[60] flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        data-testid="button-emergent-gpt-open"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white px-4 py-3 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        data-testid="button-emergent-gpt-expand"
      >
        <Sparkles className="h-5 w-5" />
        <span className="text-sm font-medium">Emergent GPT</span>
        {messages.length > 0 && (
          <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs">{messages.length}</span>
        )}
      </button>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 z-[60] w-[380px] sm:w-[420px] max-h-[600px] flex flex-col shadow-2xl border-emerald-200" data-testid="panel-emergent-gpt">
      <CardHeader className="p-3 pb-2 border-b bg-gradient-to-r from-emerald-500 to-teal-600 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-white font-semibold">Emergent GPT</CardTitle>
              <p className="text-[10px] text-emerald-100">AI Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
                onClick={() => setMessages([])}
                data-testid="button-emergent-gpt-clear"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => setMinimized(true)}
              data-testid="button-emergent-gpt-minimize"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => { setOpen(false); setMinimized(false); }}
              data-testid="button-emergent-gpt-close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1 p-3" style={{ maxHeight: "440px" }}>
          <div ref={scrollRef} className="space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 space-y-3" data-testid="emergent-gpt-welcome">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                  <Sparkles className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Hi! I'm Emergent GPT</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    I can help you with your projects, finances, tasks, and more.
                    {projectName && (
                      <span className="block mt-1 text-emerald-600 font-medium">
                        Currently viewing: {projectName}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center pt-2">
                  {[
                    "Which projects are behind schedule?",
                    "Show me overdue tasks",
                    projectName ? `Summarize ${projectName}` : "Revenue overview",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => { setInput(suggestion); }}
                      className="text-[11px] px-2.5 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
                      data-testid={`button-gpt-suggestion-${suggestion.slice(0, 20).replace(/\s+/g, '-')}`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  )}
                  data-testid={`message-${msg.role}-${i}`}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content || (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Thinking...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask about your projects..."
              disabled={streaming}
              className="text-sm"
              data-testid="input-emergent-gpt"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              size="icon"
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-emergent-gpt-send"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Emergent GPT uses AI to answer questions about your data
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
