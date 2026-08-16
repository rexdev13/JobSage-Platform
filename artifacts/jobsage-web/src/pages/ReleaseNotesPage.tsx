const PROD = "https://jobsage.co.uk";

const sections = [
  { id: "new-features",    label: "New Features" },
  { id: "ai-automation",   label: "AI & Automation" },
  { id: "ui-improvements", label: "UI Improvements" },
];

// ---------------------------------------------------------------------------
// Small re-usable layout pieces
// ---------------------------------------------------------------------------

function SectionHeading({ id, number, title }: { id: string; number: number; title: string }) {
  return (
    <h2 id={id} className="flex items-center gap-3 text-xl font-bold text-slate-800 mt-12 mb-1 print:mt-8 scroll-mt-8">
      <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold">
        {number}
      </span>
      {title}
    </h2>
  );
}

function FeatureHeading({ id, index, title }: { id: string; index: number; title: string }) {
  return (
    <h3 id={id} className="flex items-baseline gap-2 text-lg font-semibold text-slate-700 mt-8 mb-2 scroll-mt-8">
      <span className="text-primary font-bold text-base">{index}.</span>
      {title}
    </h3>
  );
}

function Links({ items }: { items: { label: string; path: string }[] }) {
  return (
    <div className="not-prose my-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 print:border-slate-300">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">🔗 Links</p>
      <ul className="space-y-1">
        {items.map(({ label, path }) => (
          <li key={path} className="flex items-baseline gap-2 text-sm">
            <span className="text-slate-500 min-w-0 shrink-0">{label}:</span>
            <a
              href={`${PROD}${path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/70 break-all"
            >
              {`${PROD}${path}`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestSteps({ groups }: { groups: { title?: string; steps: string[] }[] }) {
  return (
    <div className="not-prose my-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 print:break-inside-avoid print:border-emerald-300">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-3">🧪 How to Test</p>
      {groups.map((g, gi) => (
        <div key={gi} className={gi > 0 ? "mt-4" : ""}>
          {g.title && (
            <p className="text-sm font-semibold text-slate-700 mb-1">{g.title}</p>
          )}
          <ol className="space-y-1 list-decimal list-inside marker:text-emerald-600 marker:font-semibold marker:text-xs">
            {g.steps.map((s, si) => (
              <li key={si} className="text-sm text-slate-700 leading-relaxed">{s}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: (string | { text: string; sub?: string[] })[] }) {
  return (
    <ul className="my-3 space-y-1.5 list-none pl-0">
      {items.map((item, i) => {
        const text = typeof item === "string" ? item : item.text;
        const sub  = typeof item === "string" ? undefined : item.sub;
        return (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
              <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary/60" />
              <span>{text}</span>
            </span>
            {sub && (
              <ul className="ml-5 mt-1 space-y-1 list-none pl-2 border-l-2 border-slate-200">
                {sub.map((s, si) => (
                  <li key={si} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
                    <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-slate-300" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReleaseNotesPage() {
  return (
    <>
      {/* Print-only styles injected via a <style> tag */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          a { color: #b91c1c !important; text-decoration: underline; }
          .print\\:break-inside-avoid { break-inside: avoid; }
        }
      `}</style>

      {/* ── Top nav (hidden on print) ── */}
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <img src="/logo.png" alt="JOBSAGE" className="h-8" />
          <button
            onClick={() => window.print()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Print / Save PDF
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 print:py-4">

        {/* ── Document header ── */}
        <div className="mb-10 print:mb-6">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">JOBSAGE — Release Notes</h1>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 mt-4">
            <div className="flex gap-2">
              <dt className="font-medium text-slate-400 w-20 shrink-0">Version</dt>
              <dd>Internal Build · Sprint Week</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-slate-400 w-20 shrink-0">Period</dt>
              <dd>Wednesday 12 August – Sunday 16 August 2026</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-slate-400 w-20 shrink-0">Base URL</dt>
              <dd>
                <a href={PROD} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                  {PROD}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        {/* ── Table of Contents ── */}
        <nav className="not-prose mb-10 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 print:border-slate-300 print:break-inside-avoid">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Table of Contents</p>
          <ol className="space-y-2 list-none pl-0">
            {sections.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-primary w-5 text-right">{i + 1}</span>
                <a href={`#${s.id}`} className="text-sm font-medium text-slate-700 hover:text-primary transition no-print:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ═══════════════════════════════════════
            SECTION 1 — NEW FEATURES
        ═══════════════════════════════════════ */}

        <div id="new-features" className="scroll-mt-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-slate-200" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">New Features</h2>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* 1. Waitlist Lead Capture */}
          <FeatureHeading id="waitlist" index={1} title="Waitlist Lead Capture System" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            Candidates can join the JOBSAGE waitlist via two routes: a structured waitlist form or an AI onboarding chat.
            Every submission is stored, tagged by source, and visible to admins in real time.
          </p>
          <BulletList items={[
            "Dual-source capture — leads arrive from the waitlist form (/get-started) or from conversational AI chat on the same page. Each record is tagged chat or form so origin is always clear.",
            "AI chat progressive saving — the chat endpoint saves partial data on every exchange turn. If a user drops off mid-conversation, whatever was collected (name, email, phone, sector) is already persisted.",
            "Smart deduplication — if someone chats first and then fills in the form, the form submission upgrades the existing chat record rather than creating a duplicate entry.",
            "Automatic conversion tracking — when a waitlisted lead creates a full account at /register, their lead record is automatically promoted to Registered status and linked to their new user ID.",
          ]} />
          <Links items={[
            { label: "Waitlist page",       path: "/get-started" },
            { label: "Admin leads table",   path: "/admin/leads" },
          ]} />
          <TestSteps groups={[
            {
              title: "Form flow",
              steps: [
                "Open /get-started in an incognito window and click the Form tab.",
                "Fill in a name, email, phone, and sector, then submit.",
                "Log in to /admin/leads — the submission should appear with source badge Form.",
              ],
            },
            {
              title: "Chat flow",
              steps: [
                "On the same page, switch to the Chat tab.",
                "Converse with the AI through a few turns without completing the full flow.",
                "Check the admin leads table — a partial record should already be saved with source badge AI Chat.",
              ],
            },
            {
              title: "Conversion tracking",
              steps: [
                "Use the email from a waitlist lead to register a new account at /register.",
                "Return to the admin leads table — the lead's status should have automatically changed to Registered.",
              ],
            },
          ]} />

          {/* 2. Admin Leads Dashboard */}
          <FeatureHeading id="admin-leads" index={2} title="Admin Leads Dashboard" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            A full CRM-style leads management table accessible to admin and super_admin accounts.
          </p>
          <BulletList items={[
            "Searchable, paginated table — search by name or email across all leads; results are paged at 25 per page.",
            "Inline status control — every row has a labelled status dropdown (with a chevron arrow to indicate interactivity). Options: New, Contacted, Registered, Unqualified. Changes save instantly without a page reload.",
            {
              text: "Multi-select with bulk actions — tick individual rows or use the header checkbox to select all leads on the page. The bulk action bar then appears with:",
              sub: [
                "Bulk status update — pick a status and press Apply to update all selected leads at once.",
                "Bulk delete — removes all selected leads after confirming in an in-app modal (not a browser popup).",
              ],
            },
            "Source badges — each row displays a coloured badge indicating whether the lead came from the AI Chat or the Form.",
          ]} />
          <Links items={[
            { label: "Admin login",    path: "/admin/login" },
            { label: "Leads table",    path: "/admin/leads" },
          ]} />
          <TestSteps groups={[
            {
              title: "Inline status change",
              steps: [
                "Log in at /admin/login using admin@jobsage.co.uk.",
                "Navigate to /admin/leads.",
                "Click the status dropdown on any row and change it — confirm the badge colour updates immediately.",
              ],
            },
            {
              title: "Bulk status change",
              steps: [
                "Tick two or more checkboxes.",
                "Choose a status from the Set status… dropdown and click Apply.",
                "Confirm all selected rows now show the new status.",
              ],
            },
            {
              title: "Bulk delete",
              steps: [
                "Select one or more leads via their checkboxes.",
                "Click Delete — an in-app modal should appear showing the count.",
                "Confirm — the leads should be removed.",
              ],
            },
            {
              title: "Search",
              steps: [
                "Type a partial name or email into the search box.",
                "Confirm the table filters live; clearing the box restores all results.",
              ],
            },
          ]} />
        </div>

        {/* ═══════════════════════════════════════
            SECTION 2 — AI & AUTOMATION
        ═══════════════════════════════════════ */}

        <div id="ai-automation" className="scroll-mt-8 mt-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-slate-200" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">AI &amp; Automation</h2>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* 3. CV Gap Analysis */}
          <FeatureHeading id="gap-analysis" index={3} title="AI CV Gap Analysis" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            A candidate-facing tool that scores a candidate's profile against a specific job vacancy and returns structured
            feedback — all within a slide-out panel, no page navigation required.
          </p>
          <BulletList items={[
            "Triggered from any vacancy row on the Opportunities page.",
            "Powered by gpt-4o-mini, results are structured into three sections: Matches (existing strengths), Gaps (missing criteria from the JD), and Optimisation Steps (concrete actions to take before applying).",
            "Hard-capped at 10 analyses per user — enforced server-side. The trigger button is disabled with a clear message once the limit is reached.",
          ]} />
          <Links items={[
            { label: "Opportunities page", path: "/opportunities" },
          ]} />
          <TestSteps groups={[
            {
              steps: [
                "Log in as a candidate and go to /opportunities.",
                "Find any vacancy and click the CV Gap Analysis trigger button on that row.",
                "A slide-out sheet should open — confirm it shows Matches, Gaps, and Optimisation Steps sections.",
                "Repeat up to 10 times with different vacancies — on the 11th attempt, confirm the button is disabled and a usage-limit message is shown.",
              ],
            },
          ]} />

          {/* 4. CV Enhancement — Summary */}
          <FeatureHeading id="cv-summary" index={4} title="AI CV Enhancement — Professional Summary Generator" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            Candidates can generate a polished, UK-standard professional summary directly from their profile data using AI.
          </p>
          <BulletList items={[
            "Accessible from the CV section of the candidate profile page.",
            "Two modes: General (a broad, role-agnostic summary) and Focused (the candidate specifies a target job title or direction and the AI tailors the output accordingly).",
            "The generated text is shown in an editable preview — the candidate can review and adjust before saving.",
          ]} />
          <Links items={[
            { label: "Profile page", path: "/profile" },
          ]} />
          <TestSteps groups={[
            {
              steps: [
                "Log in as a candidate and navigate to /profile.",
                "Find the ✨ Enhance CV button in the CV section.",
                "Select General mode and generate — confirm a professional summary appears in the preview editor.",
                'Clear the result, select Focused mode, enter a job title (e.g. "Senior Software Engineer"), and generate again — confirm the output references the specified role.',
                "Edit the text in the preview, then save — confirm the updated summary is reflected on the profile.",
              ],
            },
          ]} />

          {/* 5. CV Enhancement — PDF */}
          <FeatureHeading id="cv-pdf" index={5} title="AI CV Enhancement — PDF Export & Primary CV Integration" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            The CV Enhancement feature now generates a download-ready PDF that is saved as the candidate's active CV
            and flows directly into job applications.
          </p>
          <BulletList items={[
            "Built with pdfkit server-side, the PDF follows UK CV formatting conventions: contact block, section headers, bullet points, and consistent typographic hierarchy.",
            "On confirmation, the generated PDF replaces the candidate's primary CV in their document library.",
            "The saved record is flagged to prevent the AI extraction pipeline from re-processing a document it generated — avoiding redundant calls and data overwrite.",
            "When the candidate next applies for a role, the AI-generated CV is attached automatically, exactly as an uploaded CV would be.",
          ]} />
          <Links items={[
            { label: "Profile page",      path: "/profile" },
            { label: "Documents page",    path: "/documents" },
            { label: "Applications page", path: "/applications" },
          ]} />
          <TestSteps groups={[
            {
              steps: [
                "Complete the CV Enhancement flow (Feature 4 above) and confirm the generated summary.",
                "After saving, navigate to /documents — a new PDF should appear as the primary CV with today's date.",
                "Download the PDF and verify it is formatted correctly (contact details, professional summary, sections).",
                "Apply for any vacancy on /opportunities — confirm the AI-generated CV is attached to the application on /applications.",
              ],
            },
          ]} />
        </div>

        {/* ═══════════════════════════════════════
            SECTION 3 — UI IMPROVEMENTS
        ═══════════════════════════════════════ */}

        <div id="ui-improvements" className="scroll-mt-8 mt-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-slate-200" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">UI Improvements</h2>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* 6. Logo */}
          <FeatureHeading id="logo" index={6} title="Global Logo — Increased Size & Consistency" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            The JOBSAGE logo was standardised to use the official brand image asset (logo.png) across all pages,
            replacing the previous text + shield-icon placeholder that appeared on several screens.
          </p>
          <div className="not-prose my-4 overflow-x-auto rounded-lg border border-slate-200 print:border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Surface</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ["Main app sidebar",               "h-12"],
                  ["Mobile header",                  "h-9"],
                  ["Login & Register pages",          "h-11 md:h-12"],
                  ["Forgot / Reset Password",         "h-11 md:h-12"],
                  ["Get Started & Onboarding",        "h-10 md:h-12"],
                  ["Admin login (dark background)",   "h-11 md:h-12 + brightness filter"],
                  ["Consent page",                   "h-11 md:h-12"],
                ].map(([surface, size]) => (
                  <tr key={surface}>
                    <td className="px-4 py-2 text-slate-700">{surface}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Links items={[
            { label: "/login",           path: "/login" },
            { label: "/register",        path: "/register" },
            { label: "/forgot-password", path: "/forgot-password" },
            { label: "/admin/login",     path: "/admin/login" },
            { label: "/get-started",     path: "/get-started" },
          ]} />
          <TestSteps groups={[
            {
              steps: [
                "Visit each link above — confirm the JOBSAGE logo image appears in place of any text or icon placeholder.",
                "Resize the browser window to a mobile viewport — confirm the logo scales correctly and remains legible.",
                "On /admin/login (dark background) — confirm the logo is visible and bright against the dark header.",
              ],
            },
          ]} />

          {/* 7. Apply button */}
          <FeatureHeading id="apply-button" index={7} title="External Apply Button — Improved Visibility" />
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            The small external-link icon previously shown on vacancy rows was replaced with a clearly labelled
            "Apply on company's website" button, improving discoverability and reducing confusion for candidates who missed the icon.
          </p>
          <Links items={[
            { label: "Opportunities page", path: "/opportunities" },
          ]} />
          <TestSteps groups={[
            {
              steps: [
                "Log in and navigate to /opportunities.",
                "Find a vacancy that has an external apply URL.",
                'Confirm the row shows a full "Apply on company\'s website" button rather than a small icon.',
                "Click the button — confirm it opens the correct external URL in a new tab.",
              ],
            },
          ]} />
        </div>

        {/* ── Footer ── */}
        <footer className="mt-16 pt-6 border-t border-slate-200 text-center text-xs text-slate-400 print:mt-8">
          Prepared by JOBSAGE Engineering · August 2026
        </footer>

      </main>
    </>
  );
}
