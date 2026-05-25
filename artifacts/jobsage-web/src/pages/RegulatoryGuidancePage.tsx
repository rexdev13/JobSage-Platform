import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition } from "@/components/ui-enhanced";
import { motion } from "framer-motion";
import {
  Stethoscope,
  HeartPulse,
  Smile,
  Users,
  ExternalLink,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Shield,
  AlertCircle,
} from "lucide-react";

interface Step {
  title: string;
  description: string;
  timeline: string;
  link?: { label: string; url: string };
}

interface Pathway {
  icon: React.ElementType;
  label: string;
  regulator: string;
  regulatorUrl: string;
  overview: string;
  steps: Step[];
  estimatedTotal: string;
  notes: string[];
}

const pathways: Record<string, Pathway> = {
  doctor: {
    icon: Stethoscope,
    label: "Doctor (GMC)",
    regulator: "General Medical Council",
    regulatorUrl: "https://www.gmc-uk.org",
    overview:
      "International medical graduates (IMGs) must pass the Professional and Linguistic Assessments Board (PLAB) test or hold an acceptable postgraduate qualification to register with the GMC. Full registration requires completing foundation-level training.",
    estimatedTotal: "12–36 months",
    steps: [
      {
        title: "English Language Proficiency",
        description:
          "Pass IELTS Academic (overall 7.5, no component below 7.0) or OET Medicine (grade B in all components).",
        timeline: "1–6 months",
        link: { label: "GMC language requirements", url: "https://www.gmc-uk.org/registration-and-licensing/join-the-register/before-you-apply/evidence-of-your-english-language-skills" },
      },
      {
        title: "Primary Medical Qualification verification",
        description: "Submit your primary medical degree for GMC verification. May require translation and notarisation.",
        timeline: "4–12 weeks",
        link: { label: "GMC primary qualification guide", url: "https://www.gmc-uk.org/registration-and-licensing/join-the-register/before-you-apply/primary-medical-qualification" },
      },
      {
        title: "PLAB 1 — Written Examination",
        description:
          "Single Best Answer (SBA) paper of 180 questions covering clinical knowledge. Held at British Council centres worldwide.",
        timeline: "2–6 months preparation",
        link: { label: "PLAB 1 info", url: "https://www.gmc-uk.org/registration-and-licensing/join-the-register/plab/plab-1" },
      },
      {
        title: "PLAB 2 — Clinical Skills (OSCE)",
        description:
          "18-station Objective Structured Clinical Examination (OSCE) held at the GMC's Clinical Assessment Centre in Manchester.",
        timeline: "3–12 months after PLAB 1",
        link: { label: "PLAB 2 info", url: "https://www.gmc-uk.org/registration-and-licensing/join-the-register/plab/plab-2" },
      },
      {
        title: "Provisional GMC Registration",
        description:
          "Apply for provisional registration after passing both PLAB parts. Allows supervised clinical practice in approved posts.",
        timeline: "4–8 weeks after PLAB 2",
        link: { label: "Apply for registration", url: "https://www.gmc-uk.org/registration-and-licensing/join-the-register/registration-applications" },
      },
      {
        title: "Full GMC Registration",
        description:
          "Complete a minimum of one year in a GMC-approved post at Foundation Year 2 level (or equivalent) to obtain full registration.",
        timeline: "12 months supervised practice",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Most posts require a Skilled Worker visa. Your employer must hold a Home Office sponsor licence. The Health and Care Worker visa offers reduced fees.",
        timeline: "8–12 weeks",
        link: { label: "Health and Care Worker visa", url: "https://www.gov.uk/health-care-worker-visa" },
      },
    ],
    notes: [
      "Some postgraduate qualifications (e.g. MRCPsych, MRCP) may exempt you from PLAB — check the GMC's list.",
      "GMC registration requires a Certificate of Good Standing (CGS) from each country where you have been registered.",
      "You must have a valid DBS (Disclosure and Barring Service) check before starting clinical practice.",
    ],
  },
  nurse: {
    icon: HeartPulse,
    label: "Nurse / Midwife (NMC)",
    regulator: "Nursing & Midwifery Council",
    regulatorUrl: "https://www.nmc.org.uk",
    overview:
      "International nurses and midwives apply for NMC registration via the Overseas Nursing and Midwifery Assessment. Most applicants take a period of supervised practice and the Objective Structured Clinical Examination (OSCE).",
    estimatedTotal: "6–18 months",
    steps: [
      {
        title: "Check your qualification",
        description:
          "Verify your nursing or midwifery qualification meets NMC standards. The NMC reviews qualifications from 160+ countries.",
        timeline: "2–6 weeks",
        link: { label: "NMC overseas applicants", url: "https://www.nmc.org.uk/registration/joining-the-register/registration-outside-of-the-uk/" },
      },
      {
        title: "English Language Proficiency",
        description:
          "IELTS Academic overall 7.0 (no component below 6.5) or OET Nursing/Midwifery grade B in all components.",
        timeline: "1–6 months",
        link: { label: "NMC English requirements", url: "https://www.nmc.org.uk/registration/joining-the-register/registration-outside-of-the-uk/english-language-requirements/" },
      },
      {
        title: "Submit overseas application",
        description:
          "Complete the NMC online application, provide certified copies of your qualification, and arrange a Certificate of Current Professional Status (CCPS) from your home regulator.",
        timeline: "4–12 weeks",
      },
      {
        title: "Computer-Based Test (CBT)",
        description:
          "Taken at Pearson VUE centres worldwide. Tests theory knowledge in nursing/midwifery to UK standards.",
        timeline: "1–3 months preparation",
        link: { label: "CBT guide", url: "https://www.nmc.org.uk/registration/joining-the-register/registration-outside-of-the-uk/computer-based-test/" },
      },
      {
        title: "Arrive in UK — Supervised Practice",
        description:
          "Undertake supervised practice in a NMC-approved setting. Typical duration 12–16 weeks, with a named supervisor and assessor.",
        timeline: "12–16 weeks",
      },
      {
        title: "OSCE — Objective Structured Clinical Examination",
        description:
          "Practical clinical skills examination taken in the UK. Tests 10 clinical scenarios relevant to UK nursing practice.",
        timeline: "Following supervised practice",
        link: { label: "OSCE info", url: "https://www.nmc.org.uk/registration/joining-the-register/registration-outside-of-the-uk/objective-structured-clinical-examination-osce/" },
      },
      {
        title: "Full NMC Registration",
        description: "After passing the OSCE, apply for full NMC registration. Pin issued within 4 weeks.",
        timeline: "2–4 weeks",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "The Health and Care Worker visa is the usual route. Nursing is on the Shortage Occupation List — reduced visa fees apply.",
        timeline: "8–12 weeks",
        link: { label: "NHS nursing recruitment", url: "https://www.england.nhs.uk/international-recruitment/" },
      },
    ],
    notes: [
      "The NHS International Recruitment Programme provides structured pathways for nurses from specific countries.",
      "Some independent hospitals and care providers also employ internationally trained nurses.",
      "Student nurses who qualified in an EEA country before 31 Dec 2020 may have simplified registration routes — check with NMC.",
    ],
  },
  dentist: {
    icon: Smile,
    label: "Dentist (GDC)",
    regulator: "General Dental Council",
    regulatorUrl: "https://www.gdc-uk.org",
    overview:
      "Overseas-qualified dentists must pass the Overseas Registration Examination (ORE) to register with the GDC, unless they hold a recognised European qualification (EEA/Swiss graduates who qualified before 31 Jan 2020 may have transitional rights).",
    estimatedTotal: "18–48 months",
    steps: [
      {
        title: "Check your eligibility",
        description:
          "Confirm your dental qualification and country of training. The GDC publishes a list of accepted qualifications. EEA graduates may have transitional routes — check the GDC website.",
        timeline: "1–2 weeks",
        link: { label: "GDC overseas registration", url: "https://www.gdc-uk.org/registration/your-registration/join-the-dental-register/overseas-qualified-dentists" },
      },
      {
        title: "English Language Proficiency",
        description:
          "IELTS Academic overall 7.0 (no component below 6.5) or OET Dentistry grade B in all components.",
        timeline: "1–6 months",
      },
      {
        title: "ORE Part 1 — Written Examinations",
        description:
          "Two written papers: MCQ and Short Answer Questions covering dental sciences and clinical knowledge. Held twice yearly in London.",
        timeline: "6–18 months preparation",
        link: { label: "ORE Part 1 info", url: "https://www.gdc-uk.org/registration/your-registration/join-the-dental-register/overseas-qualified-dentists/ore-part-1" },
      },
      {
        title: "ORE Part 2 — Clinical Examination",
        description:
          "OSCE-style clinical examination at a UK dental school. Tests clinical competence across multiple dental disciplines.",
        timeline: "3–12 months after Part 1",
        link: { label: "ORE Part 2 info", url: "https://www.gdc-uk.org/registration/your-registration/join-the-dental-register/overseas-qualified-dentists/ore-part-2" },
      },
      {
        title: "GDC Registration",
        description:
          "Apply for GDC registration after passing both ORE parts. Provide Certificate of Good Standing and DBS check.",
        timeline: "4–8 weeks",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Dentists typically work on the Skilled Worker visa. NHS dental posts and corporate dental groups often provide sponsorship.",
        timeline: "8–12 weeks",
        link: { label: "Health and Care Worker visa", url: "https://www.gov.uk/health-care-worker-visa" },
      },
    ],
    notes: [
      "ORE pass rates are typically 30–40% — dedicated preparation and UK-based clinical attachments are strongly recommended.",
      "The ORE is administered by the Royal College of Surgeons of England and Edinburgh.",
      "Completing a dental foundation training (DFT) post after registration is recommended for NHS work.",
    ],
  },
  other: {
    icon: Users,
    label: "Allied Health Professional (HCPC)",
    regulator: "Health and Care Professions Council",
    regulatorUrl: "https://www.hcpc-uk.org",
    overview:
      "Allied Health Professionals (physiotherapists, radiographers, paramedics, occupational therapists, and 11 other professions) must register with the HCPC. Overseas applicants undergo an assessment of equivalence against UK standards.",
    estimatedTotal: "6–24 months",
    steps: [
      {
        title: "Check your profession",
        description:
          "Confirm your profession is regulated by HCPC (15 regulated professions including physiotherapy, OT, radiography, speech therapy, clinical psychology, and more).",
        timeline: "1 week",
        link: { label: "HCPC regulated professions", url: "https://www.hcpc-uk.org/registration/getting-on-the-register/international-applications/your-profession/" },
      },
      {
        title: "English Language Proficiency",
        description:
          "IELTS Academic overall 7.0 (no component below 6.5). HCPC accepts OET for some professions.",
        timeline: "1–6 months",
        link: { label: "HCPC English requirements", url: "https://www.hcpc-uk.org/registration/getting-on-the-register/international-applications/english-language/" },
      },
      {
        title: "Submit HCPC application",
        description:
          "Complete the international application form, provide certified documents, and pay the application fee (£534 as of 2024).",
        timeline: "4–8 weeks to submit",
        link: { label: "International application", url: "https://www.hcpc-uk.org/registration/getting-on-the-register/international-applications/" },
      },
      {
        title: "HCPC Assessment",
        description:
          "HCPC assesses equivalence of your qualification against UK Standards of Proficiency. Outcome: Accepted, Accepted with Conditions, or Not Accepted.",
        timeline: "3–9 months",
      },
      {
        title: "Aptitude Test or Period of Adaptation (if required)",
        description:
          "If accepted with conditions, you may need to complete an aptitude test or a supervised period of adaptation in a UK setting.",
        timeline: "1–6 months",
      },
      {
        title: "HCPC Registration",
        description:
          "Granted on successful assessment. Biennial renewal required with CPD evidence.",
        timeline: "2–4 weeks after approval",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Most AHP roles qualify for the Skilled Worker visa. Some professions (e.g. physiotherapy, occupational therapy) are on the Shortage Occupation List.",
        timeline: "8–12 weeks",
        link: { label: "Shortage Occupation List", url: "https://www.gov.uk/guidance/skilled-worker-visa-shortage-occupations" },
      },
    ],
    notes: [
      "Processing times vary significantly by profession and country of qualification — build time into your planning.",
      "Some HCPC-regulated professions also have professional bodies (e.g. Chartered Society of Physiotherapy) with additional membership requirements.",
      "NHS employers typically offer NHS pay bands which are published openly — Agenda for Change (AfC) band 5–8d depending on role.",
    ],
  },
};

type Tab = "doctor" | "nurse" | "dentist" | "other";

function StepCard({ step, index }: { step: Step; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex gap-4"
    >
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </div>
        <div className="w-0.5 bg-border flex-1 mt-2" />
      </div>
      <div className="pb-6 flex-1 min-w-0">
        <button
          className="w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="font-semibold text-foreground text-sm">{step.title}</h4>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Clock className="w-3 h-3" /> {step.timeline}
              </span>
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            )}
          </div>
        </button>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-2 text-sm text-muted-foreground leading-relaxed"
          >
            <p>{step.description}</p>
            {step.link && (
              <a
                href={step.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-primary hover:underline text-xs font-medium"
              >
                <ExternalLink className="w-3 h-3" /> {step.link.label}
              </a>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default function RegulatoryGuidancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("doctor");
  const pathway = pathways[activeTab]!;
  const Icon = pathway.icon;

  return (
    <AppLayout>
      <PageTransition>
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground">Regulatory Guidance</h1>
                <p className="text-sm text-muted-foreground">
                  Step-by-step UK registration pathways for international healthcare professionals
                </p>
              </div>
            </div>
          </motion.div>

          {/* Disclaimer */}
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Information is provided for guidance only and may change. Always verify current requirements
              directly with the relevant regulatory body before taking action.
            </span>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(pathways) as [Tab, Pathway][]).map(([key, p]) => {
              const TabIcon = p.icon;
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-card border border-border text-foreground hover:bg-accent"
                  }`}
                >
                  <TabIcon className="w-4 h-4" />
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Pathway card */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* Overview */}
            <Card className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl font-bold text-foreground">{pathway.label}</h2>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary font-medium">
                      <Clock className="w-3 h-3" /> Est. {pathway.estimatedTotal}
                    </span>
                  </div>
                  <a
                    href={pathway.regulatorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mt-1 transition-colors"
                  >
                    <Shield className="w-3 h-3" /> {pathway.regulator}
                    <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{pathway.overview}</p>
            </Card>

            {/* Steps */}
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-6">Registration Pathway</h3>
              <div>
                {pathway.steps.map((step, i) => (
                  <StepCard key={i} step={step} index={i} />
                ))}
              </div>
            </Card>

            {/* Notes */}
            {pathway.notes.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" /> Key Points to Remember
                </h3>
                <ul className="space-y-2">
                  {pathway.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary mt-1 shrink-0">•</span>
                      {note}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </motion.div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
