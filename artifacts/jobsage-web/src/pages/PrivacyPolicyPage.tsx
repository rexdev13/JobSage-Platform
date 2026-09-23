import { useEffect } from "react";
import { Link } from "wouter";
import { Shield, ArrowLeft } from "lucide-react";

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = "Privacy Policy | JOBSAGE";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to JOBSAGE
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">JOBSAGE Privacy Policy</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-10">
          <p>Effective Date: 23 September 2026</p>
          <p>Version: 1.1.0</p>
        </div>

        <div className="p-4 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground mb-10">
          Legal notice: This policy describes the current JOBSAGE service but is not legal advice. Qualified legal review is recommended, particularly after any change to the operator, processors, or product.
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-foreground">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
            <p className="text-muted-foreground">
              Welcome to JOBSAGE ("we", "our", "us"). We operate jobsage.co.uk and the JOBSAGE platform. This Privacy Policy explains how we collect, use, share, and protect your personal data when you use our web application, mobile application, Chrome extension (Smart Apply), and associated services.
            </p>
            <p className="text-muted-foreground mt-2">
              We provide decision intelligence, compliance tracking, matching, and application assistance for international candidates seeking healthcare and professional roles in the UK, as well as talent search and applicant management tools for employers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Data We Collect</h2>
            <p className="text-muted-foreground mb-2">Depending on how you use our platform (as a candidate or an employer), we may collect the following categories of data:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><span className="font-medium text-foreground">Account & Contact Data:</span> Names, email addresses, phone numbers, and authentication credentials.</li>
              <li><span className="font-medium text-foreground">Candidate Professional Data:</span> Education history, professional qualifications, regulatory registration status (e.g., GMC, NMC, HCPC), DBS/safeguarding information, immigration and sponsorship needs, target regions, employment history, and language proficiency.</li>
              <li><span className="font-medium text-foreground">Document & Verification Data:</span> Uploaded CVs, cover letters, letters of recommendation, photos, passport details, and selfie identity verification data.</li>
              <li><span className="font-medium text-foreground">Application & Activity Data:</span> Vacancy details, application statuses, tracker records, inbox messages, and Smart Apply usage data.</li>
              <li><span className="font-medium text-foreground">Employer/Organisation Data:</span> Company names, sponsor licence details, job postings, team member contacts, and candidate search/review activity.</li>
              <li><span className="font-medium text-foreground">Waitlist & Lead Data:</span> Information provided through lead forms or the AI waitlist chat, including conversation content, contact details, career interests, attribution data, consent records, and our follow-up history.</li>
              <li><span className="font-medium text-foreground">Platform Email Data:</span> JOBSAGE email aliases may receive employer replies. We process sender and recipient addresses, subject lines, message bodies, delivery metadata, and automated reply classifications so replies can appear in the candidate inbox and application tracker.</li>
              <li><span className="font-medium text-foreground">Google Calendar Data:</span> When a marketing user connects Google Calendar, we receive the connected Google account email, writable calendar identifiers and names, free/busy availability intervals, and information about JOBSAGE-managed interview events such as event identifiers, links, attendees, times, and Google Meet links.</li>
              <li><span className="font-medium text-foreground">Technical & Audit Data:</span> Session cookies, essential authentication tokens, hashed IP addresses for consent tracking, and platform audit logs.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Google Calendar Data and Google API Services</h2>
            <p className="text-muted-foreground mb-2">
              Google Calendar is an optional feature for JOBSAGE marketing users who choose to connect a calendar. To provide this feature, JOBSAGE requests the Google OAuth scope <span className="font-mono text-xs text-foreground">https://www.googleapis.com/auth/calendar</span>.
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><span className="font-medium text-foreground">What we access:</span> The connected Google account email, writable calendar names and identifiers, free/busy intervals used for availability checks, and event information for interview bookings created or managed by JOBSAGE.</li>
              <li><span className="font-medium text-foreground">Why we access it:</span> To identify a writable calendar, check whether a proposed interview time is available, create a calendar invitation with a Google Meet link, update JOBSAGE-managed bookings, and cancel those bookings when requested.</li>
              <li><span className="font-medium text-foreground">What we store:</span> The OAuth refresh token is encrypted before storage. We also store the connected account email, calendar identifier and name, connection timestamp, and JOBSAGE booking references needed to keep the calendar and platform booking in sync. Availability checks are used to calculate slots and are not used to build advertising or behavioral profiles.</li>
              <li><span className="font-medium text-foreground">Sharing:</span> We do not sell Google Calendar data or use it for advertising. Calendar event invitations and updates are sent through Google Calendar to the attendees selected for the booking. We do not transfer Google Calendar data to unrelated third parties.</li>
              <li><span className="font-medium text-foreground">Control and deletion:</span> Connecting a calendar is optional. A marketing user can disconnect it from JOBSAGE, which removes the stored OAuth credential and connected-account metadata. The user can also revoke JOBSAGE's access from their Google Account settings. Account and booking records may be retained where needed for service operations, legal obligations, dispute resolution, or audit purposes, as described in this policy.</li>
              <li><span className="font-medium text-foreground">Limited Use:</span> JOBSAGE's use and transfer of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className="text-primary hover:underline">Google API Services User Data Policy</a>, including its Limited Use requirements. We do not use Google Calendar data to train general-purpose AI models, determine creditworthiness, sell advertising, or for any purpose unrelated to the user-facing calendar booking feature.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Purposes and Lawful Bases</h2>
            <p className="text-muted-foreground mb-2">We process your data under the following lawful bases under UK GDPR and equivalent frameworks:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><span className="font-medium text-foreground">Contractual Necessity:</span> To provide the JOBSAGE service, create accounts, maintain candidate profiles, parse CVs, and enable employer applicant workflows.</li>
              <li><span className="font-medium text-foreground">Legitimate Interests:</span> To improve platform performance, track application trends, secure our systems, communicate critical service updates, and assist users via AI outputs.</li>
              <li><span className="font-medium text-foreground">Consent:</span> Where consent is the appropriate basis, including optional marketing and processing that you actively request. You may withdraw consent at any time without affecting processing already carried out.</li>
              <li><span className="font-medium text-foreground">Legal Obligation:</span> To comply with legal demands and maintain security audit trails.</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              Some profile and verification information may be sensitive. We process it only where it is needed for a feature you request and where an additional condition required by applicable data protection law is available.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Automated Processing and AI</h2>
            <p className="text-muted-foreground">
              We use artificial intelligence (AI) to provide CV parsing, profile enhancement, candidate matching, eligibility analysis, cover letter drafting, vacancy analysis, and identity-document and selfie checks. AI-generated outputs are advisory and intended for assistance only. JOBSAGE does not use these outputs to make a solely automated decision that produces legal or similarly significant effects for you. You, an employer, or an authorised JOBSAGE reviewer should check relevant outputs before relying on them.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Data Sharing and Disclosures</h2>
            <p className="text-muted-foreground mb-2">We do not sell personal data or use behavioural advertising. We share your data only in the following circumstances:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><span className="font-medium text-foreground">With Employers:</span> Relevant candidate profile, eligibility, application, and document information may be made available when you apply, ask us to send material, or participate in platform candidate-discovery and applicant workflows. We do not send uploaded documents to an employer or regulator unless you take an action that requests or permits that use.</li>
              <li><span className="font-medium text-foreground">Service Providers (Processors):</span> We use third parties to operate our platform, including Replit (hosting, database, object storage and connected-service infrastructure), OpenAI via Replit AI Integrations (AI processing), Resend (outbound and inbound email delivery), and Calendly (scheduling and lead appointment synchronisation where configured by JOBSAGE staff).</li>
              <li><span className="font-medium text-foreground">Authorised JOBSAGE Staff:</span> Staff with appropriate roles may access lead contact details, conversations, account data, verification material, audit records, and application information where needed for support, review, security, recruitment operations, or follow-up.</li>
              <li><span className="font-medium text-foreground">Public Job Boards and Employer Sites:</span> We collect and verify publicly available vacancy and sponsor information. Smart Apply can read the application page you visit and use your JOBSAGE data to draft or pre-fill answers. Data reaches the target site when it is entered into that site or when you initiate a supported submission or delivery action.</li>
              <li><span className="font-medium text-foreground">Legal Requirements:</span> If required by law or to protect rights and safety.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. International Transfers</h2>
            <p className="text-muted-foreground">
              Our service providers may process data outside the UK or the European Economic Area (EEA). Where transfer safeguards are required, we rely on the provider's applicable transfer mechanism, such as an adequacy decision or approved contractual safeguards, and assess any additional measures that are reasonably required.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Data Retention</h2>
            <p className="text-muted-foreground">
              We retain personal data only for as long as necessary to fulfill the purposes outlined in this policy, maintain your active account, comply with legal obligations, or resolve disputes. When data is no longer required, it is securely deleted or anonymised.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Security</h2>
            <p className="text-muted-foreground">
              We implement reasonable technical and organisational measures to protect your data against unauthorised access, alteration, or destruction. However, no internet-based service can be 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Children</h2>
            <p className="text-muted-foreground">
              JOBSAGE is a professional platform not intended for individuals under the age of 18. We do not knowingly collect data from minors.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">11. Cookies</h2>
            <p className="text-muted-foreground">
              We use only essential cookies required for the operation of the platform (e.g., session management, authentication, security). We do not currently use non-essential tracking or advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">12. Your Rights</h2>
            <p className="text-muted-foreground mb-2">Under applicable data protection law, you have the right to:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Access a copy of your personal data</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Restrict or object to processing</li>
              <li>Data portability</li>
              <li>Withdraw consent where processing is based on consent</li>
              <li>Complain to the UK Information Commissioner's Office or another competent supervisory authority</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              These rights can depend on the circumstances and may be subject to lawful exceptions. We may need to verify your identity before completing a request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">13. Changes to this Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy periodically. Significant changes will be communicated via the platform or email.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">14. Contact Us</h2>
            <p className="text-muted-foreground">
              For privacy-related inquiries or to exercise your rights, please contact us at: <a href="mailto:privacy@jobsage.co.uk" className="text-primary hover:underline">privacy@jobsage.co.uk</a>.
            </p>
          </section>
          <div className="pt-4 border-t border-border flex flex-wrap gap-4 text-sm">
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            <Link href="/extension-privacy" className="text-primary hover:underline">Smart Apply Extension Privacy</Link>
            <Link href="/" className="text-primary hover:underline">JOBSAGE home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
