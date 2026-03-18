import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui-enhanced";
import {
  Shield,
  ChevronRight,
  CheckCircle2,
  FileText,
  BrainCircuit,
  Briefcase,
  Users,
  Star,
  ChevronDown,
  ArrowRight,
  Stethoscope,
  GraduationCap,
  Globe,
  Menu,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const NAV_LINKS = [
  { label: "About", href: "#about" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
];

function scrollTo(id: string) {
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function Navbar({ onLogin }: { onLogin: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-lg shadow-sm border-b border-border/40"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center space-x-3"
        >
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-md">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-display font-extrabold text-primary tracking-tight">
            JOBSAGE
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <button
              key={l.href}
              onClick={() => scrollTo(l.href)}
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogin}
            className="text-sm font-medium"
          >
            Sign In
          </Button>
          <Button
            size="sm"
            onClick={() => scrollTo("#pricing")}
            className="text-sm"
          >
            Get Started
          </Button>
        </div>

        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white/95 backdrop-blur-lg border-b border-border/40 overflow-hidden"
          >
            <div className="px-6 pb-5 pt-2 flex flex-col gap-4">
              {NAV_LINKS.map((l) => (
                <button
                  key={l.href}
                  onClick={() => {
                    scrollTo(l.href);
                    setMobileOpen(false);
                  }}
                  className="text-left text-sm font-medium text-muted-foreground hover:text-primary transition-colors py-1"
                >
                  {l.label}
                </button>
              ))}
              <div className="flex gap-3 pt-2 border-t border-border/40">
                <Button variant="outline" size="sm" onClick={onLogin} className="flex-1">
                  Sign In
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    scrollTo("#pricing");
                    setMobileOpen(false);
                  }}
                  className="flex-1"
                >
                  Get Started
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" as const } },
};

const stagger = {
  show: { transition: { staggerChildren: 0.1 } },
};

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  center = true,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className={center ? "text-center" : ""}
    >
      <motion.p
        variants={fadeUp}
        className="text-xs font-bold uppercase tracking-widest text-accent mb-3"
      >
        {eyebrow}
      </motion.p>
      <motion.h2
        variants={fadeUp}
        className="text-3xl md:text-5xl font-display font-extrabold text-foreground leading-tight mb-4"
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          variants={fadeUp}
          className="text-lg text-muted-foreground max-w-2xl mx-auto"
        >
          {subtitle}
        </motion.p>
      )}
    </motion.div>
  );
}

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: FileText,
    title: "Build your profile",
    desc: "Enter your qualifications, specialty, nationality, and career history. Takes about 5 minutes.",
  },
  {
    step: "02",
    icon: BrainCircuit,
    title: "Run your eligibility check",
    desc: "Our AI rules engine instantly evaluates your suitability against GMC, NMC, and HCPC requirements.",
  },
  {
    step: "03",
    icon: CheckCircle2,
    title: "Get your roadmap",
    desc: "Receive a personalised, step-by-step remediation plan and matched roles — ready to act on.",
  },
];

const FEATURES = [
  {
    icon: Shield,
    title: "Regulatory Eligibility",
    desc: "Instant GMC, NMC, and HCPC compliance checks based on your specific professional profile.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Globe,
    title: "Visa Sponsorship Feasibility",
    desc: "Assess your Skilled Worker visa prospects and sponsorship likelihood before you apply.",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: BrainCircuit,
    title: "AI Remediation Plans",
    desc: "Personalised, prioritised step-by-step guidance to close any gaps in your eligibility.",
    color: "bg-purple-500/10 text-purple-600",
  },
  {
    icon: Briefcase,
    title: "Opportunity Matching",
    desc: "Discover matched NHS and academic roles that fit your verified profile and eligibility status.",
    color: "bg-green-500/10 text-green-600",
  },
  {
    icon: FileText,
    title: "Document Management",
    desc: "Securely upload and track all your key credentials, certificates, and verification documents.",
    color: "bg-orange-500/10 text-orange-600",
  },
  {
    icon: Users,
    title: "Human Expert Review",
    desc: "Complex or borderline cases escalated to qualified human reviewers for thorough assessment.",
    color: "bg-rose-500/10 text-rose-600",
  },
];

const TESTIMONIALS = [
  {
    name: "Dr Adaeze Okafor",
    role: "Cardiologist, Lagos → UK",
    avatar: "AO",
    quote:
      "JOBSAGE saved me months of confusion. I knew exactly what certificates I needed before I even applied to the GMC. The remediation plan was incredibly specific.",
    rating: 5,
  },
  {
    name: "Sadia Rehman",
    role: "Registered Nurse, Pakistan → NHS",
    avatar: "SR",
    quote:
      "As an internationally trained nurse I had no idea where to begin with NMC registration. JOBSAGE mapped out every single step and flagged the IELTS score I was missing.",
    rating: 5,
  },
  {
    name: "Dr Tomasz Wiśniewski",
    role: "General Surgeon, Poland → UK",
    avatar: "TW",
    quote:
      "The visa sponsorship assessment was spot on. My employer confirmed the same outcome weeks later. I wish I'd found JOBSAGE before my first failed application.",
    rating: 5,
  },
  {
    name: "Aisha Kamara",
    role: "Midwife, Sierra Leone → NHS",
    avatar: "AK",
    quote:
      "Clear, honest and genuinely useful. No vague advice — just a structured plan I could actually follow. I'm now NMC-registered and working in a Birmingham trust.",
    rating: 5,
  },
];

const PRICING = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    desc: "Get a feel for the platform and run a basic eligibility check.",
    features: [
      "One eligibility check",
      "Basic regulatory gap summary",
      "Document upload (up to 3 files)",
      "Community access",
    ],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Professional",
    price: "£29",
    period: "/ month",
    desc: "Everything you need to navigate your UK healthcare career move.",
    features: [
      "Unlimited eligibility checks",
      "Full AI remediation plan",
      "Visa sponsorship assessment",
      "Opportunity matching",
      "Unlimited document storage",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For NHS trusts, staffing agencies, and medical schools.",
    features: [
      "Bulk candidate assessment",
      "Recruiter dashboard",
      "API access",
      "Human expert review queue",
      "Audit trail & compliance export",
      "Dedicated account manager",
    ],
    cta: "Contact Us",
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Which regulatory bodies does JOBSAGE cover?",
    a: "JOBSAGE currently covers the GMC (General Medical Council), NMC (Nursing & Midwifery Council), and HCPC (Health and Care Professions Council), covering the vast majority of regulated healthcare professions in the UK.",
  },
  {
    q: "Is JOBSAGE a substitute for official regulatory advice?",
    a: "No. JOBSAGE is a decision-intelligence tool that helps you understand your likely eligibility and plan your journey. We always recommend confirming any specific requirements directly with the relevant regulatory body before submitting an application.",
  },
  {
    q: "How accurate are the eligibility checks?",
    a: "Our rules engine is built on the published eligibility criteria from each regulatory body and is updated whenever those criteria change. For complex or borderline cases, our human expert review option provides an additional layer of quality assurance.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data is encrypted at rest and in transit. We are GDPR-compliant and will never share your personal information with third parties without your explicit consent. You can withdraw consent and request data deletion at any time.",
  },
  {
    q: "Can I use JOBSAGE if I am already in the UK on another visa?",
    a: "Yes. JOBSAGE can assess your visa sponsorship feasibility regardless of your current immigration status. The platform evaluates whether your profile meets the Skilled Worker route requirements and what, if anything, needs to change.",
  },
  {
    q: "How long does a full eligibility check take?",
    a: "Most checks complete within 60 seconds. For cases that require human expert review, you can expect a response within 2 working days.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full py-5 text-left gap-4"
      >
        <span className="font-semibold text-foreground text-sm md:text-base">{q}</span>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <p className="text-muted-foreground text-sm leading-relaxed pb-5">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar onLogin={() => setLocation("/login")} />

      {/* ─── Hero ─── */}
      <section className="relative min-h-screen flex flex-col overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
            alt=""
            className="w-full h-full object-cover opacity-60 mix-blend-multiply"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/75 to-background" />
        </div>

        <div className="relative z-10 flex-1 flex items-center justify-center px-4 pt-16">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className="max-w-3xl text-center"
          >
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-accent/10 text-accent font-semibold text-sm mb-8 border border-accent/20 backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-accent mr-2 animate-pulse" />
              Decision Intelligence for Healthcare Professionals
            </div>
            <h1 className="text-5xl md:text-7xl font-display font-extrabold text-foreground leading-tight tracking-tight mb-6">
              Determine your{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                eligibility
              </span>{" "}
              before you apply.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              The intelligent platform for UK healthcare and academic professionals. Evaluate regulatory requirements, visa feasibility, and discover clear remediation pathways.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                onClick={() => setLocation("/register")}
                className="w-full sm:w-auto text-lg px-10"
              >
                Get Started
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setLocation("/login")}
                className="w-full sm:w-auto text-lg px-10 bg-white/50 backdrop-blur-sm border-primary/20"
              >
                Sign In
              </Button>
            </div>

            <button
              onClick={() => scrollTo("#about")}
              className="mt-16 flex flex-col items-center gap-2 text-muted-foreground/60 hover:text-muted-foreground transition-colors mx-auto text-sm"
            >
              <span>Learn more</span>
              <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
              >
                <ChevronDown className="w-5 h-5" />
              </motion.div>
            </button>
          </motion.div>
        </div>
      </section>

      {/* ─── About / Trust bar ─── */}
      <section id="about" className="bg-primary text-primary-foreground py-14 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
          >
            <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-widest text-primary-foreground/60 mb-4">
              About JOBSAGE
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-2xl md:text-4xl font-display font-extrabold mb-6 leading-tight">
              Built for internationally trained healthcare professionals navigating the UK system.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-primary-foreground/80 max-w-3xl mx-auto leading-relaxed text-lg">
              JOBSAGE was created because the UK healthcare registration process is needlessly complex. We combine AI-driven rules intelligence with human expertise to give doctors, nurses, midwives, and allied health professionals a clear, honest view of their eligibility — and a concrete plan to get there.
            </motion.p>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-8"
          >
            {[
              { icon: Stethoscope, label: "Professions covered", value: "GMC · NMC · HCPC" },
              { icon: GraduationCap, label: "Checks run", value: "10,000+" },
              { icon: Globe, label: "Countries served", value: "45+" },
            ].map(({ icon: Icon, label, value }) => (
              <motion.div key={label} variants={fadeUp} className="flex flex-col items-center">
                <Icon className="w-8 h-8 text-primary-foreground/60 mb-3" />
                <p className="text-3xl font-extrabold font-display mb-1">{value}</p>
                <p className="text-primary-foreground/70 text-sm">{label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="py-24 px-4 bg-background">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="How it works"
            title="From profile to plan in minutes."
            subtitle="Three simple steps. No jargon, no confusion — just a clear path forward."
          />
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-10 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px bg-gradient-to-r from-primary/20 via-accent/40 to-primary/20" />
            {HOW_IT_WORKS.map(({ step, icon: Icon, title, desc }) => (
              <motion.div
                key={step}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-40px" }}
                className="relative flex flex-col items-center text-center"
              >
                <div className="w-20 h-20 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center mb-5 relative z-10 bg-background shadow-sm">
                  <Icon className="w-9 h-9 text-primary" />
                </div>
                <span className="text-xs font-bold text-accent/70 tracking-widest mb-2">{step}</span>
                <h3 className="text-lg font-bold text-foreground mb-3">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="py-24 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Features"
            title={<>Everything you need.<br className="hidden md:block" /> All in one place.</>}
            subtitle="JOBSAGE brings together regulatory intelligence, visa assessment, and career matching into a single, seamless platform."
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {FEATURES.map(({ icon: Icon, title, desc, color }) => (
              <motion.div
                key={title}
                variants={fadeUp}
                className="bg-background rounded-2xl p-6 border border-border/50 hover:shadow-md transition-shadow duration-200"
              >
                <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-4`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-foreground mb-2">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section id="testimonials" className="py-24 px-4 bg-background">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Testimonials"
            title="Trusted by healthcare professionals worldwide."
            subtitle="Hear from internationally trained clinicians who used JOBSAGE to navigate their UK journey."
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {TESTIMONIALS.map(({ name, role, avatar, quote, rating }) => (
              <motion.div
                key={name}
                variants={fadeUp}
                className="bg-muted/30 rounded-2xl p-7 border border-border/40 flex flex-col gap-4"
              >
                <div className="flex gap-1">
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-foreground leading-relaxed text-sm flex-1">"{quote}"</p>
                <div className="flex items-center gap-3 pt-2 border-t border-border/40">
                  <div className="w-10 h-10 rounded-full bg-primary/15 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                    {avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{name}</p>
                    <p className="text-muted-foreground text-xs">{role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="py-24 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Pricing"
            title="Simple, transparent pricing."
            subtitle="Start free. Upgrade when you're ready. Cancel anytime."
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6 items-start"
          >
            {PRICING.map(({ name, price, period, desc, features, cta, highlight }) => (
              <motion.div
                key={name}
                variants={fadeUp}
                className={`rounded-2xl p-7 border flex flex-col gap-5 ${
                  highlight
                    ? "bg-primary text-primary-foreground border-primary shadow-xl shadow-primary/20 scale-105"
                    : "bg-background border-border/50"
                }`}
              >
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${highlight ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {name}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold font-display">{price}</span>
                    {period && <span className={`text-sm mb-1 ${highlight ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{period}</span>}
                  </div>
                  <p className={`text-sm mt-2 ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{desc}</p>
                </div>
                <ul className="flex flex-col gap-3 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${highlight ? "text-primary-foreground/80" : "text-accent"}`} />
                      <span className={highlight ? "text-primary-foreground/90" : "text-foreground"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={highlight ? "outline" : "outline"}
                  onClick={() => setLocation("/register")}
                  className={`w-full ${highlight ? "bg-white text-primary border-white hover:bg-white/90 font-bold" : ""}`}
                >
                  {cta}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── FAQs ─── */}
      <section id="faqs" className="py-24 px-4 bg-background">
        <div className="max-w-3xl mx-auto">
          <SectionHeading
            eyebrow="FAQs"
            title="Common questions."
            subtitle="Everything you need to know before you get started."
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-12 rounded-2xl border border-border/50 bg-muted/20 px-6"
          >
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── CTA Banner ─── */}
      <section className="py-20 px-4 bg-primary text-primary-foreground">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="text-3xl md:text-5xl font-display font-extrabold mb-5 leading-tight">
            Ready to plan your UK career move?
          </h2>
          <p className="text-primary-foreground/80 mb-8 text-lg">
            Join thousands of internationally trained professionals who have used JOBSAGE to navigate their path to UK practice.
          </p>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setLocation("/register")}
            className="bg-white text-primary border-white hover:bg-white/90 font-bold text-lg px-12"
          >
            Get Started Free
            <ChevronRight className="w-5 h-5 ml-2" />
          </Button>
        </motion.div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="bg-foreground text-background/70 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between gap-8 mb-10">
            <div className="max-w-xs">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-background/15 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-background" />
                </div>
                <span className="text-lg font-display font-extrabold text-background">JOBSAGE</span>
              </div>
              <p className="text-sm leading-relaxed">
                Decision intelligence for regulated UK healthcare and academic professionals.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
              <div>
                <p className="font-semibold text-background mb-3">Platform</p>
                <ul className="flex flex-col gap-2">
                  {NAV_LINKS.map((l) => (
                    <li key={l.href}>
                      <button
                        onClick={() => scrollTo(l.href)}
                        className="hover:text-background transition-colors"
                      >
                        {l.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-background mb-3">Account</p>
                <ul className="flex flex-col gap-2">
                  <li><button onClick={() => setLocation("/login")} className="hover:text-background transition-colors">Sign In</button></li>
                  <li><button onClick={() => setLocation("/register")} className="hover:text-background transition-colors">Register</button></li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-background mb-3">Legal</p>
                <ul className="flex flex-col gap-2">
                  <li><span className="cursor-default">Privacy Policy</span></li>
                  <li><span className="cursor-default">Terms of Service</span></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-background/10 pt-6 text-xs text-center">
            © {new Date().getFullYear()} JOBSAGE Ltd. All rights reserved. JOBSAGE is a decision-support tool and does not constitute professional legal or regulatory advice.
          </div>
        </div>
      </footer>
    </div>
  );
}
