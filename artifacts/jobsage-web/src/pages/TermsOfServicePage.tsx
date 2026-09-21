import { useEffect } from "react";
import { Link } from "wouter";
import { FileText, ArrowLeft } from "lucide-react";

export default function TermsOfServicePage() {
  useEffect(() => {
    document.title = "Terms of Service | JOBSAGE";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to JOBSAGE
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">JOBSAGE Terms of Service</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-10">
          <p>Effective Date: 21 September 2026</p>
          <p>Version: 1.0.0</p>
        </div>

        <div className="p-4 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground mb-10">
          Legal notice: These terms describe the current JOBSAGE service but are not legal advice. Qualified legal review is recommended before relying on them for a particular business or jurisdiction.
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-foreground">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
            <p className="text-muted-foreground">
              Welcome to JOBSAGE ("we", "our", "us"). These Terms of Service ("Terms") govern your access to and use of jobsage.co.uk, our web and mobile applications, and the Smart Apply browser extension (collectively, the "Service").
            </p>
            <p className="text-muted-foreground mt-2">
              By registering for an account or using the Service, you agree to be bound by these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Eligibility and Accounts</h2>
            <p className="text-muted-foreground">
              You must be at least 18 years old to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to provide accurate, current, and complete information during registration and keep it updated.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Description of Service</h2>
            <p className="text-muted-foreground mb-2">JOBSAGE provides tools for two types of users:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><span className="font-medium text-foreground">Candidates:</span> Tools to evaluate UK healthcare and professional readiness, build profiles, store documents, track vacancies, receive AI assistance (e.g., CV parsing, cover letters, application form drafting), and connect with employers.</li>
              <li><span className="font-medium text-foreground">Employers:</span> Tools to post vacancies, search for and review candidates, manage applications, and communicate with candidates.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Disclaimers and No Guarantees</h2>
            <p className="text-muted-foreground mb-2">The Service is strictly an advisory and technological tool. We do not guarantee:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Any offer of employment, sponsorship, visa, or immigration outcome.</li>
              <li>Any regulatory, licensing, or professional registration approval (e.g., GMC, NMC, HCPC).</li>
              <li>The availability, accuracy, or legitimacy of any vacancy posted on or external to the platform.</li>
              <li>The identity or background of any employer or candidate.</li>
              <li>The absolute accuracy or suitability of AI-generated content (including eligibility analyses and drafted documents).</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              You are responsible for checking information, external sites, application content, and current regulatory requirements before relying on them. Nothing in the Service is legal, immigration, recruitment, or professional regulatory advice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Smart Apply and AI Features</h2>
            <p className="text-muted-foreground">
              Our Smart Apply extension and AI tools assist in drafting and pre-filling forms. You remain fully in control of reviewing, editing, and submitting all information. JOBSAGE will not submit applications on your behalf without your explicitly initiated delivery action. AI-generated content must be manually reviewed for accuracy before use.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Employer Obligations</h2>
            <p className="text-muted-foreground">
              Employers must use the Service in compliance with all applicable employment, non-discrimination, immigration, and data protection laws. Employers are responsible for the accuracy of their job postings and ensuring they hold any necessary sponsor licences or permissions to hire candidates they engage through the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. User Content and Intellectual Property</h2>
            <p className="text-muted-foreground">
              You retain ownership of the data, documents, and content you submit ("User Content"). By submitting User Content, you grant JOBSAGE a limited, worldwide, non-exclusive license to use, store, process, and display your User Content solely to operate, maintain, and improve the Service. JOBSAGE and its underlying technology, branding, and intellectual property remain our exclusive property.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Acceptable Use</h2>
            <p className="text-muted-foreground mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Use the Service for any unlawful or fraudulent purpose.</li>
              <li>Submit false, misleading, or defamatory information.</li>
              <li>Interfere with the operation or security of the Service.</li>
              <li>Attempt to scrape, reverse-engineer, or systematically extract data from the platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Third-Party Links and Services</h2>
            <p className="text-muted-foreground">
              The Service may contain links to or integrate with third-party websites, APIs, or services. We are not responsible for the content, privacy practices, or availability of these external resources.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Service Changes and Availability</h2>
            <p className="text-muted-foreground">
              We strive to keep the Service operational, but availability is not guaranteed. We may modify, suspend, or discontinue features and will give reasonable notice of material changes where practical. You should retain copies of information you need outside the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">11. Suspension and Termination</h2>
            <p className="text-muted-foreground">
              We may suspend or terminate access where we reasonably believe you have materially breached these Terms, misused the Service, created a security risk, or where suspension is required by law. Where appropriate, we will give notice and an opportunity to correct the issue. You may stop using the Service and request account deletion or data removal by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">12. Communications</h2>
            <p className="text-muted-foreground">
              By using the Service, you consent to receive operational communications from us (e.g., account updates, security alerts). You may opt-out of discretionary marketing communications where applicable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">13. Limitation of Liability and Indemnity</h2>
            <p className="text-muted-foreground">
              Nothing in these Terms excludes or limits liability that cannot lawfully be excluded, including liability for fraud, fraudulent misrepresentation, or death or personal injury caused by negligence. Subject to that, JOBSAGE is not responsible for losses that were not reasonably foreseeable, losses caused by information or services outside our control, or business losses suffered by a consumer. Any liability will be determined proportionately under applicable law.
            </p>
            <p className="text-muted-foreground mt-2">
              If you use the Service on behalf of a business, that business is responsible for direct losses JOBSAGE reasonably incurs because of its material breach of these Terms or unlawful misuse of the Service, subject to applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">14. Changes to these Terms</h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. We will identify the current version and effective date and give reasonable notice of material changes where practical. If you continue using the Service after revised Terms take effect, the revised Terms will apply.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">15. Contact Us</h2>
            <p className="text-muted-foreground">
              If you have any questions about these Terms, please contact us at: <a href="mailto:privacy@jobsage.co.uk" className="text-primary hover:underline">privacy@jobsage.co.uk</a>.
            </p>
          </section>
          <div className="pt-4 border-t border-border flex flex-wrap gap-4 text-sm">
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
            <Link href="/extension-privacy" className="text-primary hover:underline">Smart Apply Extension Privacy</Link>
            <Link href="/" className="text-primary hover:underline">JOBSAGE home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
