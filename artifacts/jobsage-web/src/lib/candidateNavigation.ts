export type CandidateNavEntry =
  | { label: string; href: string; kind: "route"; badge?: "unread-messages" }
  | { label: string; kind: "action"; action: "enhance-cv" };

export interface CandidateNavSection {
  label: string;
  items: CandidateNavEntry[];
}

export const CANDIDATE_NAVIGATION: CandidateNavSection[] = [
  {
    label: "My Profile",
    items: [
      { label: "CV and Supporting Documents", href: "/documents", kind: "route" },
      { label: "Personal & Professional Details", href: "/profile", kind: "route" },
      { label: "ID Verification", href: "/identity", kind: "route" },
      { label: "CV Enhancement", kind: "action", action: "enhance-cv" },
    ],
  },
  {
    label: "My UK Opportunities",
    items: [
      { label: "Visa Sponsoring Employers", href: "/sponsor-licences", kind: "route" },
      { label: "Matched Jobs", href: "/opportunities", kind: "route" },
      { label: "Application Tracker", href: "/applications", kind: "route" },
      { label: "Interviews", href: "/calendar", kind: "route" },
      { label: "Messages", href: "/inbox", kind: "route", badge: "unread-messages" },
    ],
  },
  {
    label: "UK Career Journey",
    items: [{ label: "Career journey", href: "/path", kind: "route" }],
  },
  {
    label: "Career Readiness",
    items: [
      { label: "Eligibility Check", href: "/eligibility", kind: "route" },
      { label: "Interview Preparation", href: "/interview-prep", kind: "route" },
      { label: "Visa & Legal Guidance", href: "/regulatory-guidance", kind: "route" },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Monthly Reports", href: "/my-report", kind: "route" },
      { label: "Next Steps", href: "/", kind: "route" },
    ],
  },
  {
    label: "Support",
    items: [
      { label: "Help Center", href: "/help", kind: "route" },
      { label: "Feedback", href: "/feedback", kind: "route" },
    ],
  },
];

export function isNavigationItemActive(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(`${href}/`);
}

export function getUnreadBadgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
