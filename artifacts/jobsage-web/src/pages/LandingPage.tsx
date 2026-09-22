import { useState, useEffect } from "react";
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
  Building2,
  Target,
  Zap,
  Lock,
  TrendingUp,
  HeartHandshake,
  Lightbulb,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const NAV_LINKS = [
  { label: "Vision", href: "#vision" },
  { label: "How We Work", href: "#how-we-work" },
  { label: "Platform", href: "#platform" },
  { label: "Apply Now", href: "#apply" },
];

function scrollTo(id: string) {
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function Navbar({ onLogin }: { onLogin: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, setLocation] = useLocation();

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
          className="flex items-center"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="JOBSAGE"
            className="h-11 md:h-12 w-auto object-contain"
          />
        </button>

         <nav className="hidden lg:flex items-center gap-8">
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

         <div className="hidden lg:flex items-center gap-3">
          <button
            onClick={() => setLocation("/admin/login")}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 py-1"
          >
            Admin
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogin}
            className="text-sm font-medium"
          >
            Sign In
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/employer/register")}
            className="text-sm font-medium"
          >
            For Employers
          </Button>
          <Button
            size="sm"
            onClick={() => scrollTo("#apply")}
            className="text-sm"
          >
            Apply Now
          </Button>
        </div>

        <button
           className="lg:hidden inline-flex min-h-11 min-w-11 items-center justify-center text-foreground"
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
             className="lg:hidden bg-white/95 backdrop-blur-lg border-b border-border/40 overflow-hidden"
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
                    scrollTo("#apply");
                    setMobileOpen(false);
                  }}
                  className="flex-1"
                >
                  Apply Now
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
  light = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  center?: boolean;
  light?: boolean;
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
        className={`text-xs font-bold uppercase tracking-widest mb-3 ${light ? "text-primary-foreground/60" : "text-accent"}`}
      >
        {eyebrow}
      </motion.p>
      <motion.h2
        variants={fadeUp}
        className={`text-3xl md:text-5xl font-display font-extrabold leading-tight mb-4 ${light ? "text-primary-foreground" : "text-foreground"}`}
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          variants={fadeUp}
          className={`text-lg max-w-2xl mx-auto ${light ? "text-primary-foreground/80" : "text-muted-foreground"}`}
        >
          {subtitle}
        </motion.p>
      )}
    </motion.div>
  );
}

const CANDIDATE_BULLETS = [
  "Exclusive access to industry-specific sponsor-licensed UK employers",
  "Matched with real opportunities, even before roles are advertised",
  "Step-by-step guidance from application to visa to relocation",
  "Connect with immigration solicitors and visa experts",
  "UK industry-specific interview tips and preparation",
  "AI-powered tools to apply faster and smarter",
  "Track your progress with clear milestones toward employment",
  "Analytics on progress and guidance on next steps",
  "Legal advice on offers and further concierge services",
];

const EMPLOYER_BULLETS = [
  "Control and automate your recruitment processes",
  "Instantly source and headhunt candidates worldwide",
  "AI-powered matching with ranked, job-ready talent",
  "Launch recruitment campaigns in one click",
  "Integrate directly with your HR systems",
  "Built-in visa and sponsorship support for international hires",
  "Reduce hiring time while improving candidate quality",
];

const HOW_IT_WORKS_CANDIDATE = [
  {
    step: "01",
    icon: FileText,
    title: "Build your profile",
    desc: "Upload your CV, enter your qualifications, specialty, and career history. Takes minutes.",
  },
  {
    step: "02",
    icon: BrainCircuit,
    title: "Get matched & represented",
    desc: "Our AI evaluates your eligibility and positions you directly with relevant sponsor-licensed employers.",
  },
  {
    step: "03",
    icon: Globe,
    title: "Move forward with support",
    desc: "Receive a personalised roadmap, visa guidance, and step-by-step support from application to your first day in the UK.",
  },
];

const HOW_IT_WORKS_EMPLOYER = [
  {
    step: "01",
    icon: Target,
    title: "Define your requirement",
    desc: "Enter the role, region, and candidate criteria. Our platform immediately begins identifying talent.",
  },
  {
    step: "02",
    icon: Zap,
    title: "Receive ranked candidates",
    desc: "AI-powered matching surfaces the best candidates globally — ranked by suitability, with rationale.",
  },
  {
    step: "03",
    icon: Briefcase,
    title: "Hire with confidence",
    desc: "Contact candidates directly, manage visa sponsorship, and close roles faster than ever before.",
  },
];

const FEATURES = [
  {
    icon: Shield,
    title: "Regulatory Eligibility",
    desc: "Instant GMC, NMC, and HCPC checks with three clear outcomes: Eligible, Not Yet Eligible, or Ineligible — all with full rule-level explainability.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Globe,
    title: "Visa Sponsorship Feasibility",
    desc: "Assess Skilled Worker visa prospects and sponsorship likelihood before applying, with expert legal connections.",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: BrainCircuit,
    title: "AI Remediation Plans",
    desc: "Personalised, prioritised step-by-step guidance to close any eligibility gaps, with built-in progress tracking.",
    color: "bg-purple-500/10 text-purple-600",
  },
  {
    icon: Briefcase,
    title: "Opportunity Matching",
    desc: "Only sponsor-licensed, eligible roles are shown — every match is actionable and compliant.",
    color: "bg-green-500/10 text-green-600",
  },
  {
    icon: Target,
    title: "Proactive Headhunting",
    desc: "Employers don't wait for applicants — we identify and engage top-performing professionals already succeeding elsewhere.",
    color: "bg-orange-500/10 text-orange-600",
  },
  {
    icon: Users,
    title: "Human Expert Review",
    desc: "Complex or borderline cases escalated to qualified human reviewers for thorough, auditable assessment.",
    color: "bg-rose-500/10 text-rose-600",
  },
  {
    icon: Building2,
    title: "Sponsor Licence Directory",
    desc: "A live, searchable register of all UK sponsor-licensed organisations, filterable by industry and vacancy status.",
    color: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: TrendingUp,
    title: "Progress & Analytics",
    desc: "Monthly reports on applications, eligibility progress, and AI-generated recommendations for next steps.",
    color: "bg-teal-500/10 text-teal-600",
  },
];

const TRUST_PILLARS = [
  {
    icon: HeartHandshake,
    title: "Built on Trust",
    desc: "We work with a high level of selectivity and discretion. Every candidate we represent is carefully assessed, and every employer we engage with is verified. This ensures that every introduction is credible, relevant, and built on mutual trust.",
  },
  {
    icon: Shield,
    title: "Driven by Compliance",
    desc: "Operating within the UK's regulatory and immigration framework is not optional — it is fundamental. We ensure that all processes align with sponsor licence requirements, visa regulations, and legal standards, giving candidates clarity and confidence at every stage.",
  },
  {
    icon: Lightbulb,
    title: "Powered by Intelligence",
    desc: "Our approach is not reactive — it is informed, selective, and deliberate. We combine deep candidate representation with targeted global headhunting, identifying individuals of real value. This is not volume-based recruitment. It is representation-led, headhunting-driven decision making.",
  },
];

const TESTIMONIALS = [
  {
    name: "Dr Adaeze Okafor",
    role: "Cardiologist, Lagos → UK",
    avatar: "AO",
    quote:
      "JOBSAGE saved me months of confusion. I knew exactly what certificates I needed before I even applied to the GMC. I wasn't left to navigate the system alone — I was represented.",
    rating: 5,
  },
  {
    name: "Sadia Rehman",
    role: "Registered Nurse, Pakistan → NHS",
    avatar: "SR",
    quote:
      "As an internationally trained nurse I had no idea where to begin. JOBSAGE mapped out every single step, flagged exactly what I was missing, and connected me directly with NHS employers.",
    rating: 5,
  },
  {
    name: "Dr Tomasz Wiśniewski",
    role: "General Surgeon, Poland → UK",
    avatar: "TW",
    quote:
      "The visa sponsorship assessment was spot on. The team introduced me with precision — I didn't apply and wait. I was moved forward with intent.",
    rating: 5,
  },
  {
    name: "Aisha Kamara",
    role: "Midwife, Sierra Leone → NHS",
    avatar: "AK",
    quote:
      "Clear, honest and genuinely useful. A structured plan I could actually follow. I'm now NMC-registered and working in a Birmingham trust.",
    rating: 5,
  },
];

const PRICING = [
  {
    name: "Individual",
    price: "£180",
    period: "/ year",
    trial: "3-day free trial included",
    desc: "Everything a candidate needs to assess and plan their UK healthcare journey.",
    features: [
      "Eligibility check (GMC · NMC · HCPC)",
      "Regulatory gap summary",
      "Sponsor-licensed employer access",
      "Remediation plan",
      "Document upload",
    ],
    cta: "Start Free Trial",
    highlight: false,
  },
  {
    name: "Premium Individual",
    price: "£420",
    period: "/ year",
    trial: "3-day free trial included",
    desc: "Advanced intelligence and priority support for professionals who need certainty.",
    features: [
      "Everything in Individual",
      "Advanced pathway intelligence",
      "AI cover letter generation",
      "Profile boost & visibility",
      "Visa sponsorship assessment",
      "Human expert review access",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlight: true,
  },
  {
    name: "Institutional",
    price: "£5,000",
    period: "/ year",
    trial: "",
    desc: "For NHS trusts, staffing agencies, and international employers.",
    features: [
      "Candidate pipeline (read-only)",
      "Headhunting & talent search",
      "Eligibility & sponsorship filters",
      "AI-ranked candidate shortlists",
      "Direct candidate contact",
      "CSV export & reporting",
      "Dedicated account manager",
    ],
    cta: "Contact Sales",
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
    q: "What does it mean to be 'represented' by JOBSAGE?",
    a: "Unlike a job board where you apply and wait, JOBSAGE actively positions you with sponsor-licensed employers relevant to your profession. We assess your profile, prepare you for the UK market, and introduce you with intent — not as an application in a queue.",
  },
  {
    q: "How does the employer headhunting tool work?",
    a: "Employers define their vacancy requirements, and our AI immediately searches the JOBSAGE candidate pool to surface the best-matched professionals — ranked by suitability, with rationale. Employers can contact candidates directly without waiting for inbound applications.",
  },
  {
    q: "How accurate are the eligibility checks?",
    a: "Our rules engine is built on the published eligibility criteria from each regulatory body and is updated whenever those criteria change. For complex or borderline cases, our human expert review option provides an additional layer of quality assurance.",
  },
  {
    q: "Can I use JOBSAGE if I am already in the UK on another visa?",
    a: "Yes. JOBSAGE can assess your visa sponsorship feasibility regardless of your current immigration status. The platform evaluates whether your profile meets the Skilled Worker route requirements and what, if anything, needs to change.",
  },
  {
    q: "How does the free trial work?",
    a: "Every new account receives a 3-day free trial with full access to Premium Individual features. No credit card is required to start.",
  },
  {
    q: "Is my data secure?",
    a: "We use reasonable technical and organisational safeguards to protect personal data. We use essential service providers for hosting, storage, email, and AI processing as described in our Privacy Policy; we do not sell personal data. You can withdraw consent where it applies and request access, correction, or deletion.",
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

        {/* Red radial glow behind hero */}
        <div className="absolute inset-0 z-[1] pointer-events-none" aria-hidden>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full"
            style={{ background: "radial-gradient(ellipse at center, hsl(12 95% 52% / 0.12) 0%, hsl(0 70% 38% / 0.06) 45%, transparent 75%)" }} />
        </div>

        <div className="relative z-10 flex-1 flex items-center justify-center px-4 pt-16">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className="max-w-4xl w-full"
          >
            <div className="text-center mb-12">
              {/* Hero logo */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="flex justify-center mb-8"
              >
                <img
                  src={`${import.meta.env.BASE_URL}logo.png`}
                  alt="JOBSAGE"
                  className="h-14 md:h-20 w-auto object-contain drop-shadow-sm"
                />
              </motion.div>

              <div className="inline-flex items-center px-4 py-2 rounded-full bg-primary/10 text-primary font-semibold text-sm mb-6 border border-primary/20 backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-primary mr-2 animate-pulse" />
                One Platform. Two Powerful Engines.
              </div>
              <h1 className="text-5xl md:text-7xl font-display font-extrabold text-foreground leading-tight tracking-tight mb-4">
                Unlock the UK.{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                  Unlock Global Talent.
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Seamlessly connecting global talent with UK opportunity, backed by compliance, intelligence, and end-to-end support.
              </p>
            </div>

            {/* Dual Panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Candidate Panel */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 flex flex-col gap-4"
              >
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-3">
                    <Globe className="w-3.5 h-3.5" /> For Candidates
                  </div>
                  <h2 className="text-xl font-display font-extrabold text-foreground mb-1">Unlock the UK</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">Your complete pathway to working in the UK — a simplified, one stop shop.</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {CANDIDATE_BULLETS.slice(0, 5).map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-foreground/80">
                      <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => setLocation("/register")}
                  className="w-full mt-auto"
                >
                  Start your journey
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
                <p className="text-xs text-center text-muted-foreground">From your first application to your first day in the UK, we guide every step.</p>
              </motion.div>

              {/* Employer Panel */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="bg-primary text-primary-foreground rounded-2xl p-6 flex flex-col gap-4"
              >
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-foreground/10 text-primary-foreground text-xs font-bold uppercase tracking-wider mb-3">
                    <Building2 className="w-3.5 h-3.5" /> For Employers
                  </div>
                  <h2 className="text-xl font-display font-extrabold mb-1">Unlock Global Talent</h2>
                  <p className="text-sm text-primary-foreground/80 leading-relaxed">Find, attract, and hire the right talent globally, faster than ever.</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {EMPLOYER_BULLETS.slice(0, 5).map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-primary-foreground/90">
                      <CheckCircle2 className="w-4 h-4 text-primary-foreground/70 shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/employer/register")}
                  className="w-full mt-auto bg-white text-primary border-white hover:bg-white/90 font-semibold"
                >
                  Hire smarter
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
                <p className="text-xs text-center text-primary-foreground/70">Don't wait for talent to apply — go out and find it.</p>
              </motion.div>
            </div>

            <div className="text-center mt-10">
              <button
                onClick={() => scrollTo("#vision")}
                className="flex flex-col items-center gap-2 text-muted-foreground/60 hover:text-muted-foreground transition-colors mx-auto text-sm"
              >
                <span>Learn more</span>
                <motion.div
                  animate={{ y: [0, 6, 0] }}
                  transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                >
                  <ChevronDown className="w-5 h-5" />
                </motion.div>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Vision & Mission ─── */}
      <section id="vision" className="bg-primary text-primary-foreground py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-widest text-primary-foreground/60 mb-3">Our Vision</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl md:text-3xl font-display font-extrabold mb-4 leading-tight">
                Build the bridge between global talent and the UK.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-primary-foreground/80 leading-relaxed">
                To build the bridge between global talent and the UK, bringing the right people in, and enabling UK employers with sponsor licences to identify and secure them before anyone else.
              </motion.p>
              <motion.p variants={fadeUp} className="text-primary-foreground/80 leading-relaxed mt-4">
                To provide a platform where the best candidates are not searching for jobs. They are found, matched, and moved.
              </motion.p>
            </motion.div>

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-widest text-primary-foreground/60 mb-3">Our Mission</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl md:text-3xl font-display font-extrabold mb-4 leading-tight">
                Represent talent. Enable hiring. Guide the journey.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-primary-foreground/80 leading-relaxed">
                To actively represent exceptional global professionals, positioning them for real opportunities with UK sponsor-licensed employers and guiding them through a seamless journey from selection to relocation.
              </motion.p>
              <motion.p variants={fadeUp} className="text-primary-foreground/80 leading-relaxed mt-4">
                Through intelligent global headhunting, we enable companies to discover, engage, and secure top talent ahead of the market — reducing costs, accelerating hiring, and putting control back where it belongs.
              </motion.p>
            </motion.div>
          </div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-8 border-t border-primary-foreground/15 pt-12"
          >
            {[
              { icon: Stethoscope, label: "Professions covered", value: "GMC · NMC · HCPC" },
              { icon: GraduationCap, label: "Checks completed", value: "10,000+" },
              { icon: Globe, label: "Countries served", value: "45+" },
            ].map(({ icon: Icon, label, value }) => (
              <motion.div key={label} variants={fadeUp} className="flex flex-col items-center text-center">
                <Icon className="w-8 h-8 text-primary-foreground/50 mb-3" />
                <p className="text-3xl font-extrabold font-display mb-1">{value}</p>
                <p className="text-primary-foreground/70 text-sm">{label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Why We Do What We Do ─── */}
      <section className="py-24 px-4 bg-background">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Why We Do What We Do"
            title={<>Because the system was never built<br className="hidden md:block" /> for the candidate.</>}
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            className="mt-10 max-w-3xl mx-auto text-center space-y-5 text-muted-foreground leading-relaxed"
          >
            <p>
              Today, recruitment is overwhelmingly designed around employers, leaving highly skilled professionals without representation, guidance, or real access to the opportunities they deserve. Talent is expected to navigate complexity alone, often reduced to applications rather than recognised for true potential.
            </p>
            <p className="text-foreground font-semibold text-lg">We exist to change that.</p>
            <p>
              We believe exceptional individuals deserve active representation, personalised support, and direct access to UK opportunities — not just a place in a queue.
            </p>
            <p>
              At the same time, we challenge how hiring works. The best talent is rarely applying for jobs — they are already succeeding, already employed, and often overlooked by traditional recruitment. That's why we don't wait for applications. We proactively identify, engage, and move top-performing professionals into better opportunities.
            </p>
            <p className="text-foreground font-medium italic">
              Because the future of hiring isn't reactive. It's represented, targeted, and moved.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ─── How We Do What We Do ─── */}
      <section id="how-we-work" className="py-24 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="How We Do What We Do"
            title="Representation for talent. Precision headhunting for employers."
            subtitle="Two distinct approaches, one unified platform."
          />

          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-16">
            {/* Candidate journey */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Globe className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-display font-bold text-foreground">For Candidates</h3>
              </div>
              <div className="relative flex flex-col gap-8">
                <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 to-transparent" />
                {HOW_IT_WORKS_CANDIDATE.map(({ step, icon: Icon, title, desc }) => (
                  <div key={step} className="flex gap-5 relative">
                    <div className="w-10 h-10 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0 bg-background z-10">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-accent/70 tracking-widest">{step}</span>
                      <h4 className="font-bold text-foreground mt-0.5 mb-1">{title}</h4>
                      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Employer journey */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-display font-bold text-foreground">For Employers</h3>
              </div>
              <div className="relative flex flex-col gap-8">
                <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-accent/40 to-transparent" />
                {HOW_IT_WORKS_EMPLOYER.map(({ step, icon: Icon, title, desc }) => (
                  <div key={step} className="flex gap-5 relative">
                    <div className="w-10 h-10 rounded-xl bg-accent/8 border border-accent/15 flex items-center justify-center shrink-0 bg-background z-10">
                      <Icon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-accent/70 tracking-widest">{step}</span>
                      <h4 className="font-bold text-foreground mt-0.5 mb-1">{title}</h4>
                      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── What We Do ─── */}
      <section className="py-24 px-4 bg-background">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="What We Do"
            title="We connect exceptional global talent with real UK opportunity."
            subtitle="Through representation, access, and proactive headhunting."
          />

          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-muted/30 rounded-2xl p-8 border border-border/50"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                <Globe className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-display font-bold text-foreground mb-3">For Candidates</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">
                We don't leave talent to navigate the system alone. We represent high-calibre professionals for the UK market, giving them direct access to sponsor-licensed employers. Through a personalised, hands-on approach, we ensure every candidate is prepared, guided, and introduced with purpose — not lost in applications. We turn ambition into real, structured opportunity.
              </p>
            </motion.div>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-primary text-primary-foreground rounded-2xl p-8"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-foreground/10 flex items-center justify-center mb-5">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-display font-bold mb-3">For Employers</h3>
              <p className="text-primary-foreground/80 leading-relaxed text-sm">
                We don't wait for applications — we deliver the right people. We enable international employers to access and secure top global talent through targeted headhunting, focusing on professionals who are already performing and ready for the next step. The result is faster hiring, stronger candidates, and significantly lower recruitment costs, without compromising on quality.
              </p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8 text-center p-6 rounded-2xl border border-accent/20 bg-accent/5"
          >
            <p className="text-foreground font-semibold text-lg">
              We deliver a platform where talent is represented, not overlooked — and hiring is proactive, not reactive.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ─── How We Can Help ─── */}
      <section className="py-24 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="How We Can Help"
            title="Precise support for each side of the equation."
          />

          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-background rounded-2xl p-8 border border-border/50"
            >
              <motion.div variants={fadeUp} className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                <Globe className="w-6 h-6" />
              </motion.div>
              <motion.h3 variants={fadeUp} className="text-xl font-display font-bold text-foreground mb-3">
                Unlocking access to the UK for candidates
              </motion.h3>
              <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed text-sm mb-5">
                If you are a high-calibre professional looking to build your career in the UK, we provide more than guidance — we provide representation. We help you navigate complex visa pathways, position your profile strategically, and connect directly with sponsor-licensed employers.
              </motion.p>
              <motion.ul variants={stagger} className="flex flex-col gap-3">
                {["You are not left to apply and wait", "You are prepared, represented, and advanced with intent", "Direct access to sponsor-licensed employers in your sector", "Step-by-step guidance from visa to your first day"].map((point) => (
                  <motion.li key={point} variants={fadeUp} className="flex items-start gap-2 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    {point}
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-background rounded-2xl p-8 border border-border/50"
            >
              <motion.div variants={fadeUp} className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-5">
                <Building2 className="w-6 h-6" />
              </motion.div>
              <motion.h3 variants={fadeUp} className="text-xl font-display font-bold text-foreground mb-3">
                Securing the right talent for employers
              </motion.h3>
              <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed text-sm mb-5">
                If you are an international employer, we give you direct access to exceptional global talent — without relying on applications or traditional recruitment processes. Through targeted headhunting, we identify professionals already performing at a high level and introduce them with precision.
              </motion.p>
              <motion.ul variants={stagger} className="flex flex-col gap-3">
                {["You don't wait for candidates — you access and secure them", "AI-ranked shortlists from the hidden talent market", "Compliance-ready introductions for visa sponsorship", "Full end-to-end recruitment support from vacancy to placement"].map((point) => (
                  <motion.li key={point} variants={fadeUp} className="flex items-start gap-2 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    {point}
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Who We Can Help ─── */}
      <section className="py-20 px-4 bg-background">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Who We Can Help"
            title="We work with those who position for opportunity — not those who wait for it."
          />
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="flex gap-5 p-6 rounded-2xl border border-border/50 bg-muted/20"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2">High-performing professionals</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Ready to take the next step in their careers and move into the UK market. Those who don't want to rely on applications, but want to be strategically represented, positioned, and connected to real opportunities with sponsor-licensed employers relevant to their industry.
                </p>
              </div>
            </motion.div>
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="flex gap-5 p-6 rounded-2xl border border-border/50 bg-muted/20"
            >
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2">Forward-thinking organisations</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Those that understand the value of global talent and want direct access to exceptional individuals beyond active job seekers. Organisations looking to move away from reactive hiring and instead identify and secure proven professionals through targeted headhunting.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Apply Now ─── */}
      <section id="apply" className="py-24 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Apply Now"
            title="Start your journey today."
            subtitle="Whether you're a candidate seeking representation or an employer seeking talent — your next step starts here."
          />

          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Candidate CTA */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-background rounded-2xl p-8 border border-border/50 flex flex-col gap-5"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Globe className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xl font-display font-bold text-foreground mb-2">Candidates — Apply to be represented</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  If you are a high-calibre professional seeking to advance your career in the UK, apply to be considered for representation. We work selectively with individuals who demonstrate strong potential and alignment with UK market needs.
                </p>
              </div>
              <div className="bg-muted/40 rounded-xl p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground mb-1">If selected, you will be:</p>
                <ul className="flex flex-col gap-1.5">
                  {["Personally guided and strategically positioned", "Directly introduced to sponsor-licensed employers", "Supported from application to relocation"].map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" /> {p}
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-3 text-muted-foreground/80">This is not an application for a job. It is entry into a process designed to move you forward.</p>
              </div>
              <Button
                size="lg"
                onClick={() => setLocation("/register")}
                className="w-full mt-auto"
              >
                Apply for candidate representation
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>

            {/* Employer CTA */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="bg-primary text-primary-foreground rounded-2xl p-8 flex flex-col gap-5"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary-foreground/10 flex items-center justify-center">
                <Building2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xl font-display font-bold mb-2">Employers — Submit your details</h3>
                <p className="text-primary-foreground/80 text-sm leading-relaxed">
                  If you are an international employer looking to access exceptional global talent, request to engage with our headhunting process. We work closely with organisations that value precision, efficiency, and access to talent beyond traditional channels.
                </p>
              </div>
              <div className="bg-primary-foreground/10 rounded-xl p-4 text-sm text-primary-foreground/90">
                <p className="font-semibold mb-1">We deliver:</p>
                <ul className="flex flex-col gap-1.5">
                  {["Targeted introductions aligned to your needs", "AI-ranked candidates with match rationale", "Built-in visa and sponsorship compliance support"].map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground/60 shrink-0" /> {p}
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-3 text-primary-foreground/70">We review every submission carefully and engage where there is a strong match.</p>
              </div>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setLocation("/employer/register")}
                className="w-full mt-auto bg-white text-primary border-white hover:bg-white/90 font-semibold"
              >
                Submit your details
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Trust, Compliance & Intelligence ─── */}
      <section className="py-24 px-4 bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Trust, Compliance & Intelligence"
            title="A model grounded in trust, guided by compliance, and executed with intelligence."
            light
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {TRUST_PILLARS.map(({ icon: Icon, title, desc }) => (
              <motion.div
                key={title}
                variants={fadeUp}
                className="bg-primary-foreground/8 rounded-2xl p-7 border border-primary-foreground/15"
              >
                <div className="w-12 h-12 rounded-xl bg-primary-foreground/10 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <h3 className="font-bold text-primary-foreground text-lg mb-3">{title}</h3>
                <p className="text-primary-foreground/75 text-sm leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Platform Features ─── */}
      <section id="platform" className="py-24 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Platform"
            title={<>Everything you need.<br className="hidden md:block" /> All in one place.</>}
            subtitle="JOBSAGE brings together candidate representation, regulatory intelligence, visa assessment, and global headhunting into a single, seamless platform."
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {FEATURES.map(({ icon: Icon, title, desc, color }) => (
              <motion.div
                key={title}
                variants={fadeUp}
                className="bg-background rounded-2xl p-6 border border-border/50 hover:shadow-md transition-shadow duration-200"
              >
                <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center mb-4`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-foreground mb-2 text-sm">{title}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section className="py-24 px-4 bg-background">
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
            subtitle="Annual plans. 3-day free trial on all candidate plans. No credit card required to start."
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6 items-start"
          >
            {PRICING.map(({ name, price, period, trial, desc, features, cta, highlight }) => (
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
                  {trial && (
                    <p className={`text-xs font-semibold mt-1 ${highlight ? "text-primary-foreground/70" : "text-accent"}`}>
                      {trial}
                    </p>
                  )}
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
                  variant="outline"
                  onClick={() => setLocation(cta === "Contact Sales" ? "/employer/register" : "/register")}
                  className={`w-full ${highlight ? "bg-white text-primary border-white hover:bg-white/90 font-bold" : ""}`}
                >
                  {cta}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </motion.div>
            ))}
          </motion.div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            3-day free trial · No credit card required
          </p>
        </div>
      </section>

      {/* ─── FAQs ─── */}
      <section className="py-24 px-4 bg-background">
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

      {/* ─── Final CTA ─── */}
      <section className="py-20 px-4 bg-primary text-primary-foreground">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="text-3xl md:text-5xl font-display font-extrabold mb-5 leading-tight">
            Hire smarter. Move faster. Build globally.
          </h2>
          <p className="text-primary-foreground/80 mb-10 text-lg">
            Start your journey today. Whether you are a candidate seeking representation or an employer seeking talent — JOBSAGE puts control in the right hands.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              variant="outline"
              onClick={() => setLocation("/register")}
              className="bg-white text-primary border-white hover:bg-white/90 font-bold text-lg px-10"
            >
              Apply as a Candidate
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setLocation("/employer/register")}
              className="bg-transparent text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10 font-bold text-lg px-10"
            >
              Register as an Employer
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
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
                Connecting exceptional global talent with UK opportunity through representation, compliance, and intelligence.
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
                  <li><button onClick={() => setLocation("/register")} className="hover:text-background transition-colors">Register — Candidate</button></li>
                  <li><button onClick={() => setLocation("/employer/register")} className="hover:text-background transition-colors">Register — Employer</button></li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-background mb-3">Legal</p>
                <ul className="flex flex-col gap-2">
                  <li><button onClick={() => setLocation("/privacy")} className="hover:text-background transition-colors">Privacy Policy</button></li>
                  <li><button onClick={() => setLocation("/terms")} className="hover:text-background transition-colors">Terms of Service</button></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-background/10 pt-6 text-xs text-center">
            © {new Date().getFullYear()} JOBSAGE. All rights reserved. JOBSAGE is a decision-support tool and does not constitute professional legal or regulatory advice.
          </div>
        </div>
      </footer>
    </div>
  );
}
