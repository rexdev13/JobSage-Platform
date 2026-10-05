import { useEffect, useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { useCreateSupportTicket } from "@workspace/api-client-react";
import type { SupportTicketInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Mail,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";

type Faq = { question: string; answer: string };
type FaqGroup = { id: string; label: string; icon: typeof ShieldCheck; intro: string; items: Faq[] };

const GROUPS: FaqGroup[] = [
  {
    id: "visa",
    label: "UK Visa Sponsorship",
    icon: ShieldCheck,
    intro: "Sponsorship, Skilled Worker eligibility and key visa terms.",
    items: [
      { question: "How does sponsor matching work?", answer: "JOBSAGE compares your profile, profession and stated sponsorship need with verified UK employer and vacancy signals. A sponsor licence does not guarantee that a specific vacancy offers sponsorship, so always confirm the advert and offer details with the employer." },
      { question: "Which occupations are eligible for the Skilled Worker route?", answer: "Eligibility depends on the occupation code, current immigration rules, skill level, salary and the role itself. We surface relevant occupation and employer signals, but the Home Office and your regulated body remain the final authorities." },
      { question: "What are the minimum salary rules?", answer: "The salary threshold can vary by occupation, going rate, discount and the circumstances of the worker. Use JOBSAGE as a planning aid, then check the latest GOV.UK guidance before relying on a proposed salary." },
      { question: "What is a Certificate of Sponsorship (CoS)?", answer: "A CoS is an electronic record a licensed employer assigns to a sponsored worker. The employer must meet its sponsor duties and provide the right role, salary and route details before you can use it in a visa application." },
    ],
  },
  {
    id: "readiness",
    label: "Readiness Checks & AI Analysis",
    icon: Sparkles,
    intro: "What your checks cover, how credits work and how to use the results.",
    items: [
      { question: "How does the AI check my CV against employer criteria?", answer: "The analysis compares information from your profile and available CV evidence with the role requirements, then highlights matches, gaps and practical next steps. It is advisory: review the result and never treat an AI output as legal, regulatory or hiring advice." },
      { question: "How do the 3 free monthly checks work?", answer: "Every free plan receives 3 Readiness Checks per calendar month. The quota card shows the next reset date at 00:00 UTC. Cached results and refreshes of an existing analysis are free; a new analysis uses one check." },
      { question: "What is the difference between a booster pack and Pro?", answer: "A Check Booster Pack adds 20 one-time checks for £4.99. JobSage Pro costs £15.99 per month and provides unlimited Readiness Checks plus priority AI gap analysis. Checkout availability is always shown clearly before you continue." },
    ],
  },
  {
    id: "jobs",
    label: "Jobs & Direct Feeds",
    icon: Ticket,
    intro: "Where vacancy details come from and how we check them.",
    items: [
      { question: "Are employers and vacancies verified?", answer: "We prioritise UK employers that appear on the Home Office sponsor register and verify vacancy links and direct feeds where evidence is available. A verified employer or live link is not a promise that sponsorship is available for every role." },
      { question: "How are direct employer feeds checked?", answer: "We use employer and job-board signals, link health checks and available source evidence to reduce stale or misleading listings. If something looks wrong, contact support with the vacancy title and employer so our team can investigate." },
    ],
  },
  {
    id: "account",
    label: "Account & Payments",
    icon: CircleHelp,
    intro: "Subscriptions, purchases, receipts and account access.",
    items: [
      { question: "How do I upgrade my Readiness Checks?", answer: "Open the quota card in the candidate workspace and choose a Check Booster Pack or JobSage Pro. If live checkout is unavailable, JOBSAGE will say so and will not claim that payment or access has completed." },
      { question: "What are the billing terms?", answer: "The booster pack is a one-time £4.99 purchase. Pro is a £15.99 monthly subscription. Your final payment terms are confirmed by the checkout provider before payment." },
      { question: "How do I cancel Pro?", answer: "Contact support from this page with the account email and subject “Cancel Pro subscription”. We will confirm the next step and any applicable timing. Do not send card details in a support message." },
      { question: "Where can I find receipts?", answer: "Payment receipts are provided by the checkout provider. If you cannot find one, contact support with the approximate payment date and account email, without including full card details." },
    ],
  },
];

const CATEGORIES: SupportTicketInput["category"][] = [
  "Visa Sponsorship",
  "Readiness Checks",
  "Account/Billing",
  "Technical Support",
  "Other",
];

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return error instanceof Error ? error.message : "We could not send your request. Please try again.";
}

function FaqRow({ faq, index }: { faq: Faq; index: string }) {
  const [open, setOpen] = useState(false);
  const panelId = `faq-answer-${index}`;
  return (
    <div className="border-t border-border/70 first:border-t-0">
      <button
        type="button"
        data-testid={`button-faq-${index}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-5 py-4 text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{faq.question}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="pb-5 pr-8 text-sm leading-7 text-muted-foreground" data-testid={`text-faq-answer-${index}`}>
          {faq.answer}
        </div>
      )}
    </div>
  );
}

export default function HelpSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const ticketMutation = useCreateSupportTicket({});
  const defaultName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SupportTicketInput["category"]>("Visa Sponsorship");
  const [form, setForm] = useState({ name: defaultName, email: user?.email ?? "", subject: "", message: "" });
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      name: current.name || defaultName,
      email: current.email || user?.email || "",
    }));
  }, [defaultName, user?.email]);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const timer = window.setTimeout(() => {
      if (target.isConnected) target.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return GROUPS;
    return GROUPS.map((group) => ({ ...group, items: group.items.filter((faq) => `${faq.question} ${faq.answer}`.toLowerCase().includes(needle)) })).filter((group) => group.items.length > 0);
  }, [query]);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function navigateToSection(event: ReactMouseEvent<HTMLAnchorElement>, id: string, beforeScroll?: () => void) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    beforeScroll?.();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setTicketId(null);
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || form.message.trim().length < 10) {
      setFormError("Please complete every field. Your message must be at least 10 characters.");
      return;
    }
    try {
      const result = await ticketMutation.mutateAsync({ data: { ...form, name: form.name.trim(), email: form.email.trim(), subject: form.subject.trim(), message: form.message.trim(), category } });
      if (!result.success) throw new Error("Support could not create your ticket. Please try again.");
      setTicketId(result.ticketId);
      setForm((current) => ({ ...current, subject: "", message: "" }));
      toast({ title: "Message sent", description: `Your support ticket is ${result.ticketId}.` });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <div id="help-top" className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-help-logo">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="JOBSAGE" className="h-10 w-auto" />
          </Link>
          <div className="flex items-center gap-3">
            <a href="#contact" onClick={(event) => navigateToSection(event, "contact")} className="hidden text-sm font-semibold text-muted-foreground hover:text-primary sm:inline" data-testid="link-header-contact">Contact support</a>
            {!user && <Link href="/login" className="inline-flex min-h-10 items-center rounded-lg border border-input px-3 text-sm font-semibold hover:bg-muted" data-testid="link-header-sign-in">Sign in</Link>}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border/70 bg-secondary/45 px-4 pb-12 pt-16 sm:px-6 sm:pb-16">
          <div className="pointer-events-none absolute -right-32 -top-36 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-primary"><MessageSquare className="h-3.5 w-3.5" /> Help &amp; Support</span>
              <h1 className="max-w-2xl text-4xl font-bold leading-[1.06] tracking-tight sm:text-6xl">Help with your UK job search</h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Browse answers about sponsorship, applications, Readiness Checks and your account.</p>
            </div>
            <div className="relative mt-9 max-w-2xl">
              <label htmlFor="help-search" className="sr-only">Search help articles</label>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
              <input id="help-search" data-testid="input-help-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search support topics, e.g. sponsorship or billing" className="h-14 w-full rounded-2xl border border-border bg-background pl-12 pr-11 text-base shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" />
              {query && <button type="button" data-testid="button-clear-help-search" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>}
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_390px] lg:gap-16">
          <section aria-label="Frequently asked questions" className="min-w-0">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Help articles</p><h2 className="mt-2 text-2xl font-bold">Browse common questions</h2></div>
              {query && <p className="text-right text-xs text-muted-foreground">{filteredGroups.reduce((sum, group) => sum + group.items.length, 0)} matches</p>}
            </div>
            <div className="space-y-5">
              {filteredGroups.map((group) => {
                const Icon = group.icon;
                return <article id={group.id} key={group.id} className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                  <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div><div><h3 className="text-lg font-bold">{group.label}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{group.intro}</p></div></div>
                  <div>{group.items.map((faq, index) => <FaqRow faq={faq} index={`${group.id}-${index}`} key={faq.question} />)}</div>
                </article>;
              })}
              {filteredGroups.length === 0 && <div className="rounded-2xl border border-dashed border-border p-10 text-center"><Search className="mx-auto h-7 w-7 text-muted-foreground" /><h3 className="mt-3 font-semibold">No matching answers yet</h3><p className="mt-1 text-sm text-muted-foreground">Try a different phrase or send our team a message.</p></div>}
            </div>
          </section>

          <aside id="contact" className="scroll-mt-24">
            <div className="sticky top-24 rounded-2xl border border-primary/20 bg-primary/[0.06] p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-2xl font-bold">Still need a hand?</h2><p className="mt-1 text-sm font-semibold text-primary">Talk to a person</p></div><div className="rounded-xl bg-primary p-2.5 text-primary-foreground"><Mail className="h-5 w-5" /></div></div>
              <p className="mb-5 text-sm leading-6 text-muted-foreground">Tell us what you need help with.</p>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background px-3 py-1.5 text-xs font-semibold text-primary" data-testid="badge-support-sla"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />We usually reply within 2 business hours.</p>
              <form onSubmit={submitTicket} className="space-y-4">
                <div><label htmlFor="support-name" className="mb-1.5 block text-sm font-semibold">Name</label><input id="support-name" data-testid="input-support-name" value={form.name} onChange={(event) => updateField("name", event.target.value)} required maxLength={120} autoComplete="name" className="field-support" /></div>
                <div><label htmlFor="support-email" className="mb-1.5 block text-sm font-semibold">Email</label><input id="support-email" data-testid="input-support-email" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} required maxLength={254} autoComplete="email" className="field-support" /></div>
                <div><label htmlFor="support-category" className="mb-1.5 block text-sm font-semibold">Category</label><select id="support-category" data-testid="select-support-category" value={category} onChange={(event) => setCategory(event.target.value as SupportTicketInput["category"])} required className="field-support">{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></div>
                <div><label htmlFor="support-subject" className="mb-1.5 block text-sm font-semibold">Subject</label><input id="support-subject" data-testid="input-support-subject" value={form.subject} onChange={(event) => updateField("subject", event.target.value)} required maxLength={180} className="field-support" /></div>
                 <div><label htmlFor="support-message" className="mb-1.5 block text-sm font-semibold">Message</label><textarea id="support-message" data-testid="textarea-support-message" rows={5} value={form.message} onChange={(event) => updateField("message", event.target.value)} required minLength={10} maxLength={5000} className="field-support resize-y" placeholder="Describe the issue or question." /></div>
                 <p className="text-xs text-muted-foreground">All fields are required. Your message must be at least 10 characters.</p>
                {formError && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-support-error">{formError}</p>}
                {ticketId && <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status" data-testid="status-support-success"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Ticket {ticketId} is with our team.</p>}
                 <Button type="submit" data-testid="button-submit-support" disabled={ticketMutation.isPending} className="w-full">{ticketMutation.isPending ? "Sending…" : "Send message"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </form>
              <p className="mt-4 text-center text-xs text-muted-foreground">Please do not include passwords or full payment card details.</p>
            </div>
          </aside>
        </div>
      </main>
      <footer className="border-t border-border/70 bg-secondary/40 px-4 py-8 sm:px-6"><div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Help for JOBSAGE candidates and employers.</p><div className="flex flex-wrap gap-x-4 gap-y-2"><a href="#help-top" onClick={(event) => navigateToSection(event, "help-top")} className="font-semibold text-foreground hover:text-primary" data-testid="link-footer-help">Help Center</a><a href="#visa" onClick={(event) => navigateToSection(event, "visa", () => setQuery(""))} className="hover:text-primary" data-testid="link-footer-visa">Visa FAQ</a><a href="#contact" onClick={(event) => navigateToSection(event, "contact")} className="hover:text-primary" data-testid="link-footer-contact">Contact Us</a></div></div></footer>
    </div>
  );
}