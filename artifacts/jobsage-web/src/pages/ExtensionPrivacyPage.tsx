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
        <p className="text-sm text-muted-foreground mb-10">Last updated: 28 July 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground">
          <section>
            <h2 className="text-lg font-semibold mb-2">What the extension does</h2>
            <p className="text-muted-foreground">
              The JOBSAGE Smart Apply extension helps candidates fill in job applications on employer websites
              (such as NHS Jobs and Trac) using their JOBSAGE profile, and automatically logs those applications
              in their JOBSAGE application tracker.
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
                application pages it reads the visible form fields and job details (job title, employer, reference) so
                it can help fill them in and record the application. It does not read pages unrelated to job
                applications beyond this detection check.
              </li>
              <li>
                <span className="font-medium text-foreground">Local extension storage.</span> Small settings (such as
                sidebar state) are stored locally in your browser using Chrome&apos;s extension storage. Nothing is
                stored there that identifies other websites you visit.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Where data goes</h2>
            <p className="text-muted-foreground">
              Data leaves your browser in exactly one direction: to the JOBSAGE service (jobsage.co.uk), over HTTPS,
              and only when you use an extension feature — for example, saving an application to your tracker or
              loading your profile to fill a form. The extension sends nothing to any third party, contains no
              analytics or advertising trackers, and does not sell or share data with anyone.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data we do not collect</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Browsing history or pages you visit outside of job application flows</li>
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
