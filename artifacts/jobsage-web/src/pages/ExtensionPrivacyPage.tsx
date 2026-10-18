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
        <p className="text-sm text-muted-foreground mb-10">Last updated: 18 October 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground">
          <section>
            <h2 className="text-lg font-semibold mb-2">What the extension does</h2>
            <p className="text-muted-foreground">
              The JOBSAGE Smart Apply extension helps candidates fill in job applications on employer websites
              (such as NHS Jobs and Trac) using their JOBSAGE profile, and lets them save application details
              to their JOBSAGE application tracker. Optional AI assistance can draft answers or map supported
              profile facts to form fields for the candidate to review.
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
                <span className="font-medium text-foreground">Page content on job application sites.</span> When you
                visit a page, the extension checks whether it is a supported job application form. On recognised
                application pages it reads visible form labels and relevant job details (such as the role, employer,
                and page URL) so it can help fill fields and connect a saved application to the role. It does not read
                unrelated page content beyond the local form-detection check.
              </li>
              <li>
                <span className="font-medium text-foreground">Local extension storage.</span> The extension stores
                interface preferences, sites where you have dismissed the helper, and answers you explicitly save
                to its local answer library. It also uses short-lived session storage to carry a JOBSAGE-selected
                application link across employer redirects. It does not cache your full profile or CV in extension
                storage, and this is not a general browsing history.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Where data goes</h2>
            <p className="text-muted-foreground">
              Extension API requests go to JOBSAGE (jobsage.co.uk) over HTTPS. When Smart Apply maps profile facts
              into a tracked application form, or when you ask it to generate an answer, JOBSAGE sends the relevant
              question, role context, and candidate profile or CV facts to OpenAI for that AI processing. The
              extension does not send
              form data directly to an employer. If you choose to submit a completed form, the employer receives the
              information through the employer website&apos;s normal submission flow. JOBSAGE does not sell this data
              or use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data we do not collect</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>A general browsing history or page content unrelated to job application flows</li>
              <li>Cookies, passwords, or credentials for any site other than JOBSAGE</li>
              <li>Keystrokes, clipboard contents, or personal files</li>
              <li>Financial or payment information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data retention and your rights</h2>
            <p className="text-muted-foreground">
              Applications you save through the extension are stored in your JOBSAGE account and handled under the
              JOBSAGE service privacy terms. You can delete tracked applications from your account at any time.
              Uninstalling the extension removes all locally stored extension data immediately.
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
