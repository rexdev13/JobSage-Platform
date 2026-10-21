import { Link } from "wouter";
import { Chrome, ArrowLeft } from "lucide-react";

/**
 * Public privacy policy for the JOBSAGE Smart Apply Chrome extension.
 * Required by the Chrome Web Store for extensions using cookies and
 * host permissions. Linked from the store listing.
 */
export default function ExtensionPrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to JOBSAGE
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Chrome className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">JOBSAGE Smart Apply — Privacy Policy</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-10">Last updated: 21 October 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground">
          <section>
            <h2 className="text-lg font-semibold mb-2">What the extension does</h2>
            <p className="text-muted-foreground">
              The JOBSAGE Smart Apply extension helps candidates fill in job applications on employer websites
              (such as NHS Jobs and Trac) using their JOBSAGE profile, and lets them save application details
              to their JOBSAGE application tracker. Optional AI assistance can draft answers or map supported
              professional profile facts to form fields for the candidate to review. You submit the employer
              application yourself; logging an application is not submission to the employer.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data the extension accesses</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Your JOBSAGE session cookie.</span> The extension reads
                your existing JOBSAGE sign-in cookie (for jobsage.co.uk only) so it can act on your behalf — fetching
                your profile and saving applications to your tracker. It never reads cookies from any other website.
              </li>
              <li>
                <span className="font-medium text-foreground">Application page information.</span> The content script
                is available on HTTPS pages. On an application started from JOBSAGE, or a page you activate from
                the extension icon, the helper reads form labels/options, supported field values and job context.
                It uses application URLs and redirect metadata to associate the correct role with your tracker.
                Sensitive candidate-only controls are checked locally only to show whether you completed them.
                Their answers are not remembered, sent for AI processing or filled by AI.
              </li>
              <li>
                <span className="font-medium text-foreground">Local extension storage.</span> The extension stores
                interface preferences and dismissed hostnames. Answer remembering is off until you enable it.
                While enabled, eligible answers you edit are saved automatically in this browser, with their
                question, source hostname/path, employer scope and usage timestamps. Application URL query strings
                are not saved in new answer-library records. Turning remembering off stops saving and reuse;
                individual and Delete all controls erase saved answers. Session storage contains tab activation,
                application-link/redirect context. The extension does not persist the full profile,
                CV or session credential in extension storage. These records are not a general browsing history.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Where data goes</h2>
            <p className="text-muted-foreground">
              Authenticated extension API requests go to JOBSAGE (jobsage.co.uk) over HTTPS. For AI mapping
              or drafting, JOBSAGE sends
              the question, field labels/options, job context and selected professional profile facts to OpenAI
              through Replit AI Integrations. Relevant CV text and saved application facts can be used to fill
              supported fields and draft answers. Common sensitive disclosure lines and personal email addresses
              are filtered from CV text before AI processing; these checks are not a guarantee of complete redaction.
              Private profile notes are excluded, and employer email fields use your JOBSAGE address.
              Fields stay blank when the saved facts are insufficient. Do not put health, financial or identity-document details
              into AI requests or remembered answers; automated content checks are safeguards, not a guarantee
              that every sensitive phrase can be recognised.
            </p>
            <p className="text-muted-foreground mt-3">
              When the helper mounts, it requests Google Fonts CSS from fonts.googleapis.com and font files from
              fonts.gstatic.com where the employer page permits them. Google receives ordinary request metadata,
              including your IP address, browser headers and any referrer allowed by the page&apos;s referrer policy.
              The extension does not intentionally send your JOBSAGE profile or answers to the font service.
            </p>
            <p className="text-muted-foreground mt-3">
              Filling a field or attaching your current JOBSAGE CV makes that information available to the employer
              website and its scripts immediately. The site may autosave or upload it before final submission.
              If attachment is unavailable, you can save the CV through Chrome&apos;s Save As dialog. The extension
              does not read unrelated local files. Your CV can contain information you chose to include, including
              health or financial information; review it before attaching it. CV files are transferred as complete
              files, not redacted documents. Free-text checks do not reliably exclude all sensitive content, so we
              do not claim that this feature can never handle those categories. The employer&apos;s own privacy policy applies
              to information it receives.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data we do not collect</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>A general browsing history or page content unrelated to job application flows</li>
              <li>Cookies, passwords, or credentials for any site other than JOBSAGE</li>
              <li>Passwords for employer sites, clipboard reads or unrelated local files</li>
              <li>General keylogging, advertising analytics or a comprehensive browsing-history database</li>
              <li>Targeted collection of health, bank-account, card or payment information from application controls</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data retention and your rights</h2>
            <p className="text-muted-foreground">
              Applications you save through the extension are stored in your JOBSAGE account and handled under the
              JOBSAGE service privacy terms. You can delete tracked applications from your account at any time.
              You can delete remembered answers in the helper or remove the extension&apos;s local storage by
              uninstalling it. Local deletion does not erase tracker records, copies already received by an
              employer or data already processed by a provider. Account-held information is covered by the{" "}
              <Link href="/privacy" className="text-primary underline">general JOBSAGE Privacy Policy</Link>.
              We do not promise a separate provider retention period or zero-retention arrangement here.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Chrome Web Store Limited Use</h2>
            <p className="text-muted-foreground">
              JOBSAGE Smart Apply&apos;s use and transfer of user data must comply with the Chrome Web Store User
              Data Policy, including the Limited Use requirements. Extension-derived data is for the disclosed
              application-assistance and tracking purpose, not sale, personalised advertising, unrelated profiling,
              creditworthiness or lending. Transfers and human access must stay within that policy&apos;s permitted
              exceptions. Provider retention/training terms and operational staff-access controls require
              verification; this policy does not claim a technical restriction or provider guarantee that has
              not been established.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Contact</h2>
            <p className="text-muted-foreground">
              Questions about this policy or your data? Contact us at{" "}
              <a href="mailto:privacy@jobsage.co.uk" className="text-primary hover:underline">privacy@jobsage.co.uk</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
