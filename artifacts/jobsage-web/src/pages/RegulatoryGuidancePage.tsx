import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition } from "@/components/ui-enhanced";
import { motion } from "framer-motion";
import { useGetMyProfile } from "@workspace/api-client-react";
import {
  Stethoscope,
  HeartPulse,
  Smile,
  Users,
  GraduationCap,
  BookOpen,
  Wrench,
  Heart,
  Globe,
  ExternalLink,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  teacher: {
    icon: GraduationCap,
    label: "Teacher (QTS)",
    regulator: "Teaching Regulation Agency",
    regulatorUrl: "https://www.gov.uk/government/organisations/teaching-regulation-agency",
    overview:
      "Internationally-trained teachers can obtain Qualified Teacher Status (QTS) through several routes. Since 2023, teachers from many countries can apply directly for QTS via the international recognition route without additional assessment, based on their existing qualifications and experience.",
    estimatedTotal: "3–18 months",
    steps: [
      {
        title: "Check the international recognition route",
        description:
          "Teachers qualified in Australia, Canada, EU/EEA, Gibraltar, New Zealand, Northern Ireland, Scotland, Switzerland, or the USA can apply directly for QTS. Other countries may have different routes.",
        timeline: "1–2 weeks",
        link: { label: "QTS international route", url: "https://www.gov.uk/government/publications/apply-for-qualified-teacher-status-qts-if-you-trained-outside-the-uk" },
      },
      {
        title: "English Language Proficiency",
        description:
          "Required if English is not your first language or your qualification was not taught in English. IELTS Academic overall 6.5 or equivalent accepted.",
        timeline: "1–4 months",
      },
      {
        title: "Apply for QTS via TRA",
        description:
          "Submit your application through the Teaching Regulation Agency's online portal. Provide your teaching qualification, transcripts, proof of teaching experience, and good standing confirmation from your home regulatory authority.",
        timeline: "4–12 weeks for decision",
        link: { label: "Apply for QTS", url: "https://apply-for-qts-in-england.education.gov.uk/" },
      },
      {
        title: "Assessment Only (AO) route (if required)",
        description:
          "If your country is not on the direct recognition list, you may pursue the Assessment Only route: demonstrate teaching competence against the Teachers' Standards without further training.",
        timeline: "6–12 months",
        link: { label: "Assessment Only route", url: "https://www.gov.uk/government/publications/the-assessment-only-route-to-qts" },
      },
      {
        title: "DBS Enhanced Check",
        description:
          "All teachers working in UK schools require an Enhanced Disclosure and Barring Service (DBS) check before starting work. Usually arranged by the employer.",
        timeline: "2–4 weeks",
        link: { label: "DBS checks for teachers", url: "https://www.gov.uk/dbs-check-applicant-guidance" },
      },
      {
        title: "Induction Year (ECT)",
        description:
          "Newly qualified teachers complete a two-year Early Career Teacher (ECT) induction supported by a mentor. Required for full independent teaching in maintained schools.",
        timeline: "2 years",
        link: { label: "ECT induction", url: "https://www.gov.uk/guidance/early-career-framework" },
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Teaching roles typically require a Skilled Worker visa. Many schools and multi-academy trusts hold sponsor licences. Teaching is on the Immigration Salary List.",
        timeline: "8–12 weeks",
        link: { label: "Teacher visa guidance", url: "https://www.gov.uk/skilled-worker-visa" },
      },
    ],
    notes: [
      "The iQTS (international QTS) route allows you to gain QTS while training outside of England.",
      "Scottish and Welsh teaching registration (GTC Scotland, EWC) are separate from England's QTS.",
      "Subject knowledge in maths, science, and languages is in high demand across UK schools.",
      "Teachers from some countries can gain QTS automatically — check the GOV.UK list as it is updated regularly.",
    ],
  },
  academic: {
    icon: BookOpen,
    label: "Academic / Researcher",
    regulator: "No mandatory registration",
    regulatorUrl: "https://www.ukri.org",
    overview:
      "Academic and research roles in UK universities do not require a mandatory regulatory registration. Appointment is based on qualifications, publications, and research impact. UK Research and Innovation (UKRI) and university HR requirements govern funding eligibility and employment terms.",
    estimatedTotal: "Variable (role-dependent)",
    steps: [
      {
        title: "Credential recognition",
        description:
          "UK universities assess overseas PhD and academic qualifications on merit. NARIC/ENIC can provide a Statement of Comparability to validate your degree level for formal purposes.",
        timeline: "2–4 weeks for ENIC statement",
        link: { label: "ENIC credential comparison", url: "https://www.enic.org.uk/" },
      },
      {
        title: "English Language Proficiency",
        description:
          "Required for roles that involve student-facing teaching or supervision. IELTS Academic overall 7.0–7.5 or equivalent, depending on institution.",
        timeline: "1–4 months",
      },
      {
        title: "Research Excellence Framework (REF) awareness",
        description:
          "Understand how REF shapes UK academic hiring. Institutions prioritise candidates with strong publication records in 2* or 4* journals and verifiable impact case studies.",
        timeline: "Ongoing",
        link: { label: "REF 2029 guidance", url: "https://www.ref.ac.uk/" },
      },
      {
        title: "UKRI eligibility",
        description:
          "If applying for UKRI-funded posts or grants, confirm your eligibility under the Terms and Conditions of Research Council Grants. Some fellowships require prior UK affiliation.",
        timeline: "Review before applying",
        link: { label: "UKRI eligibility", url: "https://www.ukri.org/apply-for-funding/before-you-apply/check-if-you-are-eligible-for-research-and-innovation-funding/" },
      },
      {
        title: "Right-to-Work & DBS",
        description:
          "UK universities require right-to-work documentation. Roles involving student contact require a Standard or Enhanced DBS check arranged by the employer.",
        timeline: "2–4 weeks",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Academic posts requiring a visa typically use the Skilled Worker or Global Talent route. The Global Talent visa suits established researchers and does not require employer sponsorship.",
        timeline: "4–12 weeks",
        link: { label: "Global Talent visa", url: "https://www.gov.uk/global-talent" },
      },
    ],
    notes: [
      "Membership of learned societies (e.g. Royal Society, British Academy, learned subject associations) strengthens applications.",
      "UK academics are typically employed on the USS or LGPS pension scheme — consider this in salary negotiations.",
      "Many research-intensive universities use the Athena Swan charter; demonstrating awareness of EDI can help applications.",
    ],
  },
  engineer: {
    icon: Wrench,
    label: "Engineer (CEng / IEng)",
    regulator: "Engineering Council (via Licensed Bodies)",
    regulatorUrl: "https://www.engc.org.uk",
    overview:
      "Engineering in the UK is not legally regulated for most roles, but Chartered Engineer (CEng) or Incorporated Engineer (IEng) status through a licensed professional body (IMechE, IET, ICE, etc.) is highly valued by employers and required for senior or safety-critical positions.",
    estimatedTotal: "6–36 months",
    steps: [
      {
        title: "Identify your professional body",
        description:
          "Select the relevant licensed body: IMechE (mechanical), IET (electrical/electronic), ICE (civil), IChemE (chemical), CIBSE (building services), or one of the other 35 Engineering Council licensed bodies.",
        timeline: "1–2 weeks",
        link: { label: "Engineering Council licensed bodies", url: "https://www.engc.org.uk/licenced-members/" },
      },
      {
        title: "Overseas qualification assessment",
        description:
          "Submit your engineering degree for assessment against UK standard (BEng/MEng equivalent). ENIC can provide a formal Statement of Comparability. Your professional body may conduct their own review.",
        timeline: "4–12 weeks",
        link: { label: "ENIC comparison", url: "https://www.enic.org.uk/" },
      },
      {
        title: "Membership application",
        description:
          "Apply for membership of your chosen professional body at the appropriate grade (e.g. MIMechE, MIET, MICE). Provide your academic transcripts, CPD record, and two professional references.",
        timeline: "8–16 weeks",
      },
      {
        title: "Professional Review Interview (PRI) — for CEng/IEng",
        description:
          "Demonstrate competence against the UK Standard for Professional Engineering Competence (UK-SPEC) through a written submission and interview with two assessors.",
        timeline: "3–6 months preparation",
        link: { label: "UK-SPEC", url: "https://www.engc.org.uk/ukspec/" },
      },
      {
        title: "Chartership award",
        description:
          "On passing the PRI, you are awarded CEng or IEng designation. Annual CPD reporting required for continued registration.",
        timeline: "Awarded within 4–8 weeks of PRI",
      },
      {
        title: "Right-to-Work & DBS",
        description:
          "Most engineering roles require proof of right to work. Safety-critical roles (rail, nuclear, utilities) may require additional security or DBS checks.",
        timeline: "2–4 weeks",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Engineering roles typically use the Skilled Worker visa. Many engineering disciplines (civil, electrical, mechanical) appear on the Immigration Salary List. Some roles may qualify for the Global Talent visa.",
        timeline: "8–12 weeks",
        link: { label: "Skilled Worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
      },
    ],
    notes: [
      "CEng status can accelerate career progression significantly — many senior and project engineer roles list it as desirable or essential.",
      "Some overseas professional qualifications (e.g. US PE, European Eur Ing) may receive partial recognition — discuss with your professional body.",
      "Health and Safety at Work Act 1974 applies to all UK workplaces; familiarity with UK HSE regulations is expected.",
    ],
  },
  socialWorker: {
    icon: Heart,
    label: "Social Worker (SWE)",
    regulator: "Social Work England",
    regulatorUrl: "https://www.socialworkengland.org.uk",
    overview:
      "Social work is a protected title in England, regulated by Social Work England (SWE). Internationally-trained social workers must have their qualifications assessed and demonstrate they meet the Professional Standards before registering.",
    estimatedTotal: "6–18 months",
    steps: [
      {
        title: "Check qualification equivalence",
        description:
          "Contact Social Work England and ENIC to have your overseas social work qualification assessed against a UK degree-level social work qualification. SWE will determine if it meets the required standard.",
        timeline: "6–12 weeks",
        link: { label: "SWE international applicants", url: "https://www.socialworkengland.org.uk/registration/international-applications/" },
      },
      {
        title: "English Language Proficiency",
        description:
          "IELTS Academic overall 7.0 (no component below 6.5) or equivalent. Evidence required if English is not your first language.",
        timeline: "1–4 months",
      },
      {
        title: "Submit SWE registration application",
        description:
          "Apply via the SWE online portal. Provide your qualification evidence, references, DBS declaration, and health declaration. Application fee: £90.",
        timeline: "4–12 weeks",
        link: { label: "SWE application portal", url: "https://www.socialworkengland.org.uk/registration/" },
      },
      {
        title: "Competence assessment (if required)",
        description:
          "If SWE determines your qualification needs further assessment, you may be required to complete a period of supervised practice in a UK social work setting before full registration is granted.",
        timeline: "3–12 months",
      },
      {
        title: "DBS Enhanced Check",
        description:
          "All registered social workers must hold a valid Enhanced DBS check with Children and Adults Barred List check. Arranged by your employer.",
        timeline: "2–4 weeks",
        link: { label: "DBS guidance", url: "https://www.gov.uk/dbs-check-applicant-guidance" },
      },
      {
        title: "Full SWE Registration",
        description:
          "On approval, you join the SWE register. Annual renewal required (£30/year), with CPD evidence (120 hours per 3-year period).",
        timeline: "2–4 weeks after approval",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "Social work roles typically require a Skilled Worker visa. Local authorities, NHS trusts, and charities often hold sponsor licences. Social work is on the Immigration Salary List.",
        timeline: "8–12 weeks",
        link: { label: "Skilled Worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
      },
    ],
    notes: [
      "The Care Act 2014, Mental Capacity Act 2005, and Children Act 1989 are the core legislative frameworks you will work within.",
      "Scottish social workers register with the Scottish Social Services Council (SSSC) — a separate regulator from SWE.",
      "Continuing Professional Development (CPD) is mandatory for ongoing SWE registration — keep records from day one.",
      "Child protection and adult safeguarding experience are highly valued by UK local authority employers.",
    ],
  },
  general: {
    icon: Globe,
    label: "Other / General",
    regulator: "No mandatory UK-wide registration",
    regulatorUrl: "https://www.gov.uk/check-if-you-need-a-licence",
    overview:
      "For professionals in sectors without a mandatory UK regulatory body, the key steps involve verifying your right to work, obtaining relevant UK certifications where required, and navigating the visa and sponsorship process. Check the GOV.UK licence finder to see if your specific role has any licensing requirements.",
    estimatedTotal: "3–12 months",
    steps: [
      {
        title: "Right-to-Work check",
        description:
          "Before starting employment, your employer must carry out a right-to-work check. If you need a visa, this must be in place first. Share Code checks are used for biometric residence permit holders.",
        timeline: "Before start date",
        link: { label: "Right-to-work guidance", url: "https://www.gov.uk/prove-right-to-work" },
      },
      {
        title: "Check for role-specific licensing",
        description:
          "Some professions (e.g. financial services, legal, healthcare support) have sector-specific licensing or registration requirements. Use the GOV.UK licence finder to check your role.",
        timeline: "1 week",
        link: { label: "GOV.UK licence finder", url: "https://www.gov.uk/licence-finder" },
      },
      {
        title: "Credential recognition",
        description:
          "Have overseas qualifications assessed by ENIC (formerly UK NARIC) for a formal Statement of Comparability. This helps employers understand your qualification level.",
        timeline: "2–4 weeks",
        link: { label: "ENIC statement of comparability", url: "https://www.enic.org.uk/" },
      },
      {
        title: "DBS check (if applicable)",
        description:
          "Roles working with children, vulnerable adults, or in certain regulated sectors require a DBS check (Basic, Standard, or Enhanced). Arranged by the employer.",
        timeline: "2–4 weeks",
        link: { label: "DBS check types", url: "https://www.gov.uk/dbs-check-applicant-guidance" },
      },
      {
        title: "Professional References",
        description:
          "UK employers typically require 2–3 professional references covering the last 5 years. Ensure referees can confirm employment dates, role, and conduct in English.",
        timeline: "Ongoing",
      },
      {
        title: "Visa & Sponsorship",
        description:
          "If you require a visa, the Skilled Worker visa is the most common route for professionals. Your employer must hold a Home Office sponsor licence. Some senior roles may qualify for the Global Talent visa.",
        timeline: "8–12 weeks",
        link: { label: "Skilled Worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
      },
    ],
    notes: [
      "The National Living Wage (NLW) and National Minimum Wage (NMW) apply to all workers in the UK — check current rates on GOV.UK.",
      "UK employment contracts must provide a written Statement of Particulars within the first day of employment.",
      "Auto-enrolment pension schemes are mandatory — most employers use NEST or a workplace pension provider.",
      "Understanding IR35 is important if you plan to work through a limited company or as a contractor.",
    ],
  },
};

type TabKey = keyof typeof pathways;

function professionToTab(profession: string | undefined): TabKey {
  if (!profession) return "general";
  const p = profession.toLowerCase().replace(/ /g, "_");
  if (p === "doctor" || p === "clinical_academic") return "doctor";
  if (p === "nurse" || p === "midwife") return "nurse";
  if (p === "dentist") return "dentist";
  if (p === "allied_health_professional" || p.includes("physiother") || p.includes("occupational") ||
      p.includes("paramedic") || p.includes("radiograph") || p.includes("speech"))
    return "other";
  if (p === "teacher" || p.includes("teach") || p.includes("school")) return "teacher";
  if (p === "academic" || p === "lecturer" || p === "professor" || p.includes("research")) return "academic";
  if (p === "engineer" || p.includes("engineer")) return "engineer";
  if (p === "social_worker" || p.includes("social_work") || p.includes("social_care")) return "socialWorker";
  return "general";
}

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
  const { data: profile } = useGetMyProfile();
  const defaultTab = professionToTab(profile?.profession);
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  const pathway = pathways[activeTab]!;
  const Icon = pathway.icon;

  const tabEntries = Object.entries(pathways) as [TabKey, Pathway][];

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
                  Step-by-step UK registration and certification pathways for international professionals
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

          {/* Profession selector */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Browse by profession</p>
            <div className="flex gap-2 flex-wrap">
              {tabEntries.map(([key, p]) => {
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
