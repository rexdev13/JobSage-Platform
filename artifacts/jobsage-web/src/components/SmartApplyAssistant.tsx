import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Send, Sparkles, ChevronDown, Loader2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui-enhanced";

interface Message {
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
}

interface SmartApplyAssistantProps {
  roleId: number;
  roleTitle: string;
  currentQuestion?: { id: string; question: string };
  onUseAnswer: (text: string) => void;
  triggerQuestion?: { id: string; question: string } | null;
  onTriggerConsumed?: () => void;
}

const BASE_URL = () => import.meta.env.BASE_URL.replace(/\/$/, "");

export function SmartApplyAssistant({
  roleId,
  roleTitle,
  currentQuestion,
  onUseAnswer,
  triggerQuestion,
  onTriggerConsumed,
}: SmartApplyAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [lastAssistantMsg, setLastAssistantMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: `Hi! I've read your CV and profile for the **${roleTitle}** application. Ask me anything — or click "Ask AI" next to any question for instant help.`,
        },
      ]);
    }
  }, [isOpen, messages.length, roleTitle]);

  useEffect(() => {
    if (triggerQuestion) {
      if (!isOpen) setIsOpen(true);
      void sendMessage(`Help me answer this question: "${triggerQuestion.question}"`);
      onTriggerConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerQuestion]);

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;

    if (!text) setInput("");

    const userMsg: Message = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    const assistantPlaceholder: Message = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, assistantPlaceholder]);
    setStreaming(true);
    setLastAssistantMsg("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${BASE_URL()}/api/smart-apply/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: ctrl.signal,
        body: JSON.stringify({
          roleId,
          message: msg,
          questionId: currentQuestion?.id,
          questionText: currentQuestion?.question,
        }),
      });

      if (!resp.ok || !resp.body) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "Sorry, I couldn't get a response. Please try again." },
        ]);
        setStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; error?: string };
            if (payload.error) {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: "Sorry, something went wrong. Please try again." },
              ]);
              setStreaming(false);
              return;
            }
            if (payload.text) {
              accumulated += payload.text;
              setLastAssistantMsg(accumulated);
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: accumulated, streaming: true },
              ]);
            }
            if (payload.done) {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: accumulated, streaming: false },
              ]);
              setLastAssistantMsg(accumulated);
              setStreaming(false);
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "Connection error. Please try again." },
        ]);
      }
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function handleUseAnswer() {
    if (lastAssistantMsg) onUseAnswer(lastAssistantMsg);
  }

  return (
    <>
      {/* Floating toggle button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-[60] w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
            aria-label="Open AI Assistant"
          >
            <Bot className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[60] w-80 bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: "min(420px, calc(100vh - 120px))" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-primary/5 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-primary-foreground" />
                </div>
                <span className="text-xs font-semibold text-foreground">AI Assistant</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Minimise"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.content || (msg.streaming && (
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    ))}
                    {msg.streaming && msg.content && (
                      <span className="inline-block w-1 h-3 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* "Use this answer" button — shown after last assistant reply */}
            {lastAssistantMsg && !streaming && currentQuestion && (
              <div className="px-3 pb-1 shrink-0">
                <button
                  onClick={handleUseAnswer}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
                >
                  <ClipboardCheck className="w-3 h-3" />
                  Use this answer
                </button>
              </div>
            )}

            {/* Input */}
            <div className="px-3 pb-3 pt-1 shrink-0 border-t border-border">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything…"
                  rows={1}
                  disabled={streaming}
                  className="flex-1 resize-none text-xs px-2.5 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 min-h-[36px] max-h-[80px]"
                  style={{ height: "36px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "36px";
                    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
                  }}
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || streaming}
                  className="w-8 h-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
                  aria-label="Send"
                >
                  {streaming ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
