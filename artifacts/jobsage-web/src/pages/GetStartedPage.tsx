import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui-enhanced";
import {
  MessageCircle,
  ClipboardList,
  Send,
  Globe,
  CheckCircle2,
  Bot,
  ChevronRight,
  Loader2,
  UserPlus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveTab = "chat" | "form";

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  profession: string;
  qualificationCountry: string;
  registrationStatus: string;
  requiresSponsorship: string;
  specialty: string;
  timeline: string;
  biggestChallenge: string[];
  gdprConsent: boolean;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
  streaming?: boolean; // true while tokens are still arriving
}

// Qualifying data the API extracts from the conversation history
interface ExtractedQualifiers {
  profession?: string | null;
  qualificationCountry?: string | null;
  registrationStatus?: string | null;
  requiresSponsorship?: string | null;
  specialty?: string | null;
  timeline?: string | null;
}

// ---------------------------------------------------------------------------
// Static option lists
// ---------------------------------------------------------------------------

const PROFESSIONS = [
  "Doctor / Physician",
  "Nurse",
  "Midwife",
  "Physiotherapist",
  "Occupational Therapist",
  "Radiographer",
  "Pharmacist",
  "Paramedic",
  "Dentist",
  "Other Allied Health Professional",
  "Other healthcare worker",
  "I'm not in healthcare",
];

const REGISTRATION_OPTIONS = [
  { value: "registered",   label: "Yes — I already hold GMC / NMC / HCPC registration" },
  { value: "in_progress",  label: "No — I'm actively working towards UK registration" },
  { value: "not_started",  label: "No — I'm not sure how to start" },
  { value: "unsure",       label: "I'm not sure what's required" },
];

const SPONSORSHIP_OPTIONS = [
  { value: "yes",    label: "Yes — I'll need an employer to sponsor my visa" },
  { value: "no",     label: "No — I already have the right to work in the UK" },
  { value: "unsure", label: "Not sure — I need help understanding my options" },
];

const TIMELINE_OPTIONS = [
  { value: "asap",      label: "As soon as possible" },
  { value: "6m",        label: "Within 6 months" },
  { value: "12m",       label: "6–12 months" },
  { value: "2yr",       label: "1–2 years" },
  { value: "exploring", label: "Just exploring for now" },
];

const CHALLENGE_OPTIONS = [
  "Understanding if I'm eligible for UK registration",
  "Getting my UK registration (GMC / NMC / HCPC)",
  "Finding an employer who will sponsor my visa",
  "Understanding the visa / immigration process",
  "All of the above",
  "Something else",
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Hi there! 👋 I'm the JOBSAGE AI. I help internationally trained healthcare professionals understand their pathway to working in the UK — from eligibility and registration through to visa sponsorship and job matching.\n\nTo get started, what is your healthcare profession?",
  },
];

// How many user turns before we show the register CTA
const CTA_AFTER_TURNS = 3;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getUtmParams(): Record<string, string | undefined> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utmSource:   p.get("utm_source")   ?? undefined,
    utmMedium:   p.get("utm_medium")   ?? undefined,
    utmCampaign: p.get("utm_campaign") ?? undefined,
    utmContent:  p.get("utm_content")  ?? undefined,
  };
}

const fieldClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition";

const selectClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition appearance-none cursor-pointer";

// ---------------------------------------------------------------------------
// Sub-components (form helpers)
// ---------------------------------------------------------------------------

function SectionHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="font-display font-semibold text-foreground text-base">{children}</h3>
      {sub && <p className="text-muted-foreground text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function RadioCard({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-all ${
            value === opt.value
              ? "border-primary bg-primary/5 text-foreground font-medium"
              : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
        >
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full border-2 mr-2 align-middle ${
              value === opt.value ? "border-primary bg-primary" : "border-muted-foreground/40"
            }`}
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CheckCard({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-all ${
        checked
          ? "border-primary bg-primary/5 text-foreground font-medium"
          : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded mr-2 align-middle border-2 flex-shrink-0 ${
          checked ? "border-primary bg-primary" : "border-muted-foreground/40"
        }`}
      >
        {checked && (
          <svg className="w-2 h-2 text-white" viewBox="0 0 8 8" fill="none">
            <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------

function SuccessState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-12 px-4"
    >
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
        <CheckCircle2 className="h-8 w-8 text-primary" />
      </div>
      <h2 className="font-display text-2xl font-bold text-foreground mb-3">You're on the list!</h2>
      <p className="text-muted-foreground max-w-sm mx-auto mb-8">
        We've received your details and will be in touch shortly with your personalised UK pathway assessment.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/register">
          <Button size="lg" className="w-full sm:w-auto">
            Create your free account
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline" size="lg" className="w-full sm:w-auto">
            Back to homepage
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Lead form
// ---------------------------------------------------------------------------

function LeadForm({
  form,
  setField,
  toggleChallenge,
  onSubmit,
  submitting,
  error,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  toggleChallenge: (c: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* ── Contact ── */}
      <section>
        <SectionHeading sub="We'll use this to send you your pathway assessment.">
          Your contact details
        </SectionHeading>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                First name <span className="text-destructive">*</span>
              </label>
              <input required value={form.firstName} onChange={(e) => setField("firstName", e.target.value)} placeholder="Jane" className={fieldClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Last name</label>
              <input value={form.lastName} onChange={(e) => setField("lastName", e.target.value)} placeholder="Okonkwo" className={fieldClass} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Email address <span className="text-destructive">*</span>
            </label>
            <input required type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="jane@example.com" className={fieldClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Phone number <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="+1 555 000 0000" className={fieldClass} />
          </div>
        </div>
      </section>

      {/* ── Q1 + Q5 + Q2 — Background ── */}
      <section>
        <SectionHeading sub="Helps us match you to the right UK regulatory pathway.">
          About your healthcare background
        </SectionHeading>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              What is your healthcare profession? <span className="text-muted-foreground font-normal">(Q1)</span>
            </label>
            <select value={form.profession} onChange={(e) => setField("profession", e.target.value)} className={selectClass}>
              <option value="">Select your profession…</option>
              {PROFESSIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              What is your main specialty or clinical area? <span className="text-muted-foreground font-normal">(Q5 · optional)</span>
            </label>
            <input value={form.specialty} onChange={(e) => setField("specialty", e.target.value)} placeholder="e.g. Emergency Medicine, ICU Nursing, Cardiology…" className={fieldClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Which country did you qualify or train in? <span className="text-muted-foreground font-normal">(Q2)</span>
            </label>
            <input value={form.qualificationCountry} onChange={(e) => setField("qualificationCountry", e.target.value)} placeholder="e.g. Nigeria, India, Philippines…" className={fieldClass} />
          </div>
        </div>
      </section>

      {/* ── Q3 — Registration ── */}
      <section>
        <SectionHeading sub="Do you currently hold registration with the GMC, NMC, or HCPC? (Q3)">
          Your UK registration status
        </SectionHeading>
        <RadioCard options={REGISTRATION_OPTIONS} value={form.registrationStatus} onChange={(v) => setField("registrationStatus", v)} />
      </section>

      {/* ── Q4 — Sponsorship ── */}
      <section>
        <SectionHeading sub="Will you need a UK employer to sponsor your visa? (Q4)">
          Visa sponsorship
        </SectionHeading>
        <RadioCard options={SPONSORSHIP_OPTIONS} value={form.requiresSponsorship} onChange={(v) => setField("requiresSponsorship", v)} />
      </section>

      {/* ── Q6 — Timeline ── */}
      <section>
        <SectionHeading sub="How soon are you looking to start working in the UK? (Q6)">
          Your timeline
        </SectionHeading>
        <select value={form.timeline} onChange={(e) => setField("timeline", e.target.value)} className={selectClass}>
          <option value="">Select a timeframe…</option>
          {TIMELINE_OPTIONS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
        </select>
      </section>

      {/* ── Q7 — Biggest challenge ── */}
      <section>
        <SectionHeading sub="Select all that apply. (Q7)">
          What is your biggest challenge right now?
        </SectionHeading>
        <div className="space-y-2">
          {CHALLENGE_OPTIONS.map((c) => (
            <CheckCard key={c} label={c} checked={form.biggestChallenge.includes(c)} onChange={() => toggleChallenge(c)} />
          ))}
        </div>
      </section>

      {/* ── GDPR ── */}
      <section>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.gdprConsent}
            onChange={(e) => setField("gdprConsent", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary cursor-pointer"
          />
          <span className="text-sm text-muted-foreground leading-relaxed">
            I agree to JOBSAGE storing and processing my information to assess my UK career pathway and send me relevant updates. I understand I can withdraw consent at any time.{" "}
            <Link href="/extension-privacy">
              <span className="underline underline-offset-2 text-foreground cursor-pointer">Privacy Policy</span>
            </Link>
          </span>
        </label>
      </section>

      {error && (
        <p className="text-sm text-destructive rounded-lg bg-destructive/10 px-4 py-3">{error}</p>
      )}

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
        ) : (
          <>Get my free pathway assessment<ChevronRight className="ml-1 h-4 w-4" /></>
        )}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------

function ChatUI({
  messages,
  chatInput,
  setChatInput,
  onSend,
  streaming,
  onSwitchToForm,
}: {
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  onSwitchToForm: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-input bg-background shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-secondary/30">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">JOBSAGE AI</p>
          <p className="text-xs text-muted-foreground">UK healthcare career advisor</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Online
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-[340px] max-h-[420px] overflow-y-auto px-5 py-4 space-y-4 scroll-smooth">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mr-2 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-secondary text-foreground rounded-bl-sm"
              } ${msg.streaming ? "animate-pulse" : ""}`}
            >
              {msg.content || (msg.streaming ? "…" : "")}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/60 px-4 py-3 flex gap-2 items-end bg-background">
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={streaming ? "JOBSAGE AI is typing…" : "Type your message… (Enter to send)"}
          disabled={streaming}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition min-h-[42px] max-h-28 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ scrollbarWidth: "thin" }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!chatInput.trim() || streaming}
          className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent transition"
        >
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {/* Fallback nudge */}
      <div className="border-t border-border/40 bg-secondary/20 px-5 py-3 text-center">
        <p className="text-xs text-muted-foreground">
          Prefer a form instead?{" "}
          <button type="button" onClick={onSwitchToForm} className="text-primary font-medium underline underline-offset-2">
            Switch to the form
          </button>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register CTA — shown after CTA_AFTER_TURNS user messages
// ---------------------------------------------------------------------------

function RegisterCta({ onSwitchToForm }: { onSwitchToForm: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
    >
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
        <UserPlus className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Ready to see your full UK pathway?</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Create a free account for your personalised eligibility assessment, step-by-step plan, and matched sponsor employers.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0 w-full sm:w-auto">
        <Link href="/register">
          <Button size="sm" className="w-full sm:w-auto">
            Create free account
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={onSwitchToForm} className="w-full sm:w-auto">
          Fill out form instead
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GetStartedPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");

  // Form state
  const [form, setForm] = useState<FormState>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    profession: "",
    qualificationCountry: "",
    registrationStatus: "",
    requiresSponsorship: "",
    specialty: "",
    timeline: "",
    biggestChallenge: [],
    gdprConsent: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  // Count how many turns the user has had — drives CTA visibility
  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const showCta = userTurnCount >= CTA_AFTER_TURNS && !streaming;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChallenge(challenge: string) {
    setForm((prev) => ({
      ...prev,
      biggestChallenge: prev.biggestChallenge.includes(challenge)
        ? prev.biggestChallenge.filter((c) => c !== challenge)
        : [...prev.biggestChallenge, challenge],
    }));
  }

  // Apply extracted qualifying data from the AI into the form (pre-fill)
  function applyExtracted(extracted: ExtractedQualifiers) {
    if (extracted.profession)           setField("profession",           extracted.profession);
    if (extracted.qualificationCountry) setField("qualificationCountry", extracted.qualificationCountry);
    if (extracted.registrationStatus)   setField("registrationStatus",   extracted.registrationStatus);
    if (extracted.requiresSponsorship)  setField("requiresSponsorship",  extracted.requiresSponsorship);
    if (extracted.specialty)            setField("specialty",             extracted.specialty);
    if (extracted.timeline)             setField("timeline",              extracted.timeline);
  }

  async function handleChatSend() {
    const userMsg = chatInput.trim();
    if (!userMsg || streaming) return;

    setChatInput("");

    // Optimistically add user message + empty streaming assistant bubble
    const assistantBubble: ChatMessage = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, { role: "user", content: userMsg }, assistantBubble]);
    setStreaming(true);

    // Build history for the API (exclude the just-added empty assistant bubble)
    const history = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch("/api/leads/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, history }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error("Network error");
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
            const payload = JSON.parse(line.slice(6)) as {
              text?: string;
              done?: boolean;
              extracted?: ExtractedQualifiers;
              error?: string;
            };

            if (payload.error) {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1
                    ? { ...m, content: "Sorry, I'm having trouble right now. Please try again.", streaming: false }
                    : m,
                ),
              );
              break;
            }

            if (payload.text) {
              accumulated += payload.text;
              const snap = accumulated;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: snap, streaming: true } : m,
                ),
              );
            }

            if (payload.done) {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, streaming: false } : m,
                ),
              );
              // Pre-fill the form with any qualifying data the AI extracted
              if (payload.extracted) {
                applyExtracted(payload.extracted);
              }
            }
          } catch {
            // malformed SSE line — skip
          }
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

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.gdprConsent) {
      setFormError("Please confirm your consent before submitting.");
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const utm = getUtmParams();
    try {
      const res = await fetch("/api/leads/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...utm,
          landingPath: window.location.pathname,
          referrerUrl: document.referrer || undefined,
        }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data["error"] === "string" ? data["error"] : "Submission failed");
      }
      setSubmitted(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function switchToForm() {
    setActiveTab("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <span className="font-display font-bold text-xl text-primary tracking-tight cursor-pointer select-none">
              JOBSAGE
            </span>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="sm">Sign in</Button>
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="bg-gradient-to-b from-primary/5 via-background to-background py-10 px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-3.5 py-1 text-xs font-semibold uppercase tracking-wide mb-5">
            <Globe className="h-3.5 w-3.5" />
            For internationally trained healthcare professionals
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-foreground tracking-tight leading-tight mb-4">
            Start your <span className="text-primary">UK career</span> journey
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
            Find out if you qualify to work in the UK, which steps to take, and which sponsor-licensed employers can hire you — in minutes.
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-6 text-xs text-muted-foreground">
            {["GMC · NMC · HCPC eligible", "Free assessment", "No commitment"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                {t}
              </span>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pb-16 pt-8">
        {/* Tab toggle */}
        <div className="flex rounded-xl border border-input bg-secondary/40 p-1 mb-8">
          <TabButton
            active={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            icon={<MessageCircle className="h-4 w-4" />}
            label="Chat with AI"
            badge="Recommended"
          />
          <TabButton
            active={activeTab === "form"}
            onClick={() => setActiveTab("form")}
            icon={<ClipboardList className="h-4 w-4" />}
            label="Fill out Form"
          />
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <ChatUI
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSend={handleChatSend}
                streaming={streaming}
                onSwitchToForm={switchToForm}
              />
              {showCta && <RegisterCta onSwitchToForm={switchToForm} />}
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {submitted ? (
                <SuccessState />
              ) : (
                <LeadForm
                  form={form}
                  setField={setField}
                  toggleChallenge={toggleChallenge}
                  onSubmit={handleFormSubmit}
                  submitting={submitting}
                  error={formError}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border/50 py-5 px-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} JOBSAGE Ltd ·{" "}
        <Link href="/extension-privacy">
          <span className="underline underline-offset-2 cursor-pointer hover:text-foreground">Privacy Policy</span>
        </Link>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button helper
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
        active
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
      {badge && active && (
        <span className="hidden sm:inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {badge}
        </span>
      )}
    </button>
  );
}
