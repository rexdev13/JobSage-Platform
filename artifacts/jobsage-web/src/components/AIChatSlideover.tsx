import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui-enhanced";
import { cn } from "@/components/ui-enhanced";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const STARTERS = [
  "What should I do next?",
  "What are my next steps to UK registration?",
  "How do I get a Skilled Worker visa?",
  "How long does GMC registration take?",
];

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2.5 mb-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted/60 text-foreground rounded-tl-sm",
          msg.streaming && "animate-pulse",
        )}
      >
        {msg.content || (msg.streaming ? "…" : "")}
      </div>
    </motion.div>
  );
}

export function AIChatSlideover() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    if (open && messages.length === 0) {
      // Show greeting on first open
      setMessages([
        {
          role: "assistant",
          content: "Hi! I'm SAGE, your AI career guide. Ask me anything about UK healthcare registration, visas, jobs, or your journey. How can I help?",
        },
      ]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setInput("");

    const userMsg: Message = { role: "user", content: trimmed };
    const assistantMsg: Message = { role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    // ── Next-steps fast path: structured recommendations ─────────────────────
    if (/what\s+(should|shall)\s+i\s+do\s+next|what'?s?\s+(my\s+)?next\s+step/i.test(trimmed)) {
      try {
        const resp = await fetch(`${base}/api/ai/next-steps`, { credentials: "include" });
        if (resp.ok) {
          const data = await resp.json() as {
            steps: Array<{ priority: number; title: string; description: string; action: string; href: string }>;
          };
          const steps = data.steps ?? [];
          if (steps.length > 0) {
            const content = `Here are your personalised next steps:\n\n${steps
              .map((s, i) => `${i + 1}. **${s.title}**\n${s.description}`)
              .join("\n\n")}`;
            setMessages((prev) =>
              prev.map((m, i) => i === prev.length - 1 ? { ...m, content, streaming: false } : m)
            );
            setDisclaimer("AI-generated based on your current profile. Always verify regulatory requirements directly with GMC, NMC, or HCPC.");
            setStreaming(false);
            return;
          }
        }
      } catch { /* fall through to regular chat */ }
    }

    const history = messages
      .filter((m) => !m.streaming)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(`${base}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!resp.ok || !resp.body) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1
              ? { ...m, content: "Sorry, I'm having trouble connecting. Please try again.", streaming: false }
              : m,
          ),
        );
        setStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6)) as {
              text?: string;
              done?: boolean;
              disclaimer?: string;
              error?: string;
            };
            if (p.error) {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1
                    ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
                    : m,
                ),
              );
            } else if (p.text) {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1
                    ? { ...m, content: m.content + p.text!, streaming: true }
                    : m,
                ),
              );
            } else if (p.done) {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, streaming: false } : m,
                ),
              );
              if (p.disclaimer) setDisclaimer(p.disclaimer);
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? { ...m, content: "Network error. Please try again.", streaming: false }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="chat-btn"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:bg-primary/90 transition-colors group"
            aria-label="Open AI chat"
          >
            <MessageCircle className="w-6 h-6 group-hover:scale-110 transition-transform" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-background animate-pulse" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Slide-over panel */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop (mobile) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm sm:hidden"
              onClick={() => setOpen(false)}
            />

            <motion.div
              key="chat-panel"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed right-0 bottom-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[380px] h-[70vh] sm:h-[520px] bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border bg-primary/5 shrink-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">SAGE AI</p>
                  <p className="text-[10px] text-muted-foreground">Your UK career guide · Always available</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="Close chat"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setOpen(false); }}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
                {messages.map((msg, i) => (
                  <ChatBubble key={i} msg={msg} />
                ))}
                {/* Starter prompts (shown before first user message) */}
                {messages.length <= 1 && !streaming && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-3 space-y-2"
                  >
                    <p className="text-[10px] text-muted-foreground text-center mb-2">Try asking…</p>
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => void sendMessage(s)}
                        className="w-full text-left text-xs px-3 py-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-foreground/80 leading-snug border border-border"
                      >
                        {s}
                      </button>
                    ))}
                  </motion.div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Disclaimer */}
              {disclaimer && (
                <div className="px-4 py-1.5 border-t border-border bg-muted/20">
                  <p className="text-[9px] text-muted-foreground leading-tight">{disclaimer}</p>
                </div>
              )}

              {/* Input */}
              <div className="px-3 py-3 border-t border-border shrink-0">
                <form
                  onSubmit={(e) => { e.preventDefault(); void sendMessage(input); }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask SAGE anything…"
                    disabled={streaming}
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 placeholder:text-muted-foreground"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!input.trim() || streaming}
                    className="h-9 w-9 p-0 rounded-xl shrink-0"
                  >
                    {streaming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
