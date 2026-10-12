import { useEffect } from "react";
import { Link } from "wouter";
import { ACCOUNT_DELETION_POLICY } from "@workspace/mobile-core";
import { useAuth } from "@workspace/auth-web";
import { getGetPrivacySettingsQueryKey, useGetPrivacySettings } from "@workspace/api-client-react";
import { ArrowLeft, AlertTriangle, CalendarClock, Check, ExternalLink, LockKeyhole, ShieldAlert, UsersRound } from "lucide-react";

export default function AccountDeletionPage() {
  const { user, isLoading: authLoading } = useAuth();
  const settingsQuery = useGetPrivacySettings({
    query: { enabled: !!user?.id, queryKey: getGetPrivacySettingsQueryKey() },
  });

  useEffect(() => {
    document.title = "Account deletion & retention | JOBSAGE";
  }, []);

  const settings = settingsQuery.data;
  const deletionEnabled = settings && user && settings.userId === user.id ? settings.deletionEnabled : undefined;

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <Link href="/" data-testid="link-back-home" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" /> JOBSAGE</Link>

        <header className="relative mt-8 overflow-hidden rounded-[1.75rem] border border-border bg-card px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <div className="absolute -right-8 -top-20 h-72 w-72 rounded-full bg-primary/[0.055]" />
          <div className="relative max-w-3xl">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldAlert className="h-6 w-6" /></div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Approved policy · {ACCOUNT_DELETION_POLICY.version}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Account deletion &amp; retention</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">A clear account of what deletion covers, what must remain for a time, and what happens to shared or independently received information.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div data-testid="status-deletion-enabled" role="status" className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold ${deletionEnabled === true ? "border-emerald-800/20 bg-emerald-700/[0.07] text-emerald-900 dark:text-emerald-200" : deletionEnabled === false ? "border-amber-700/20 bg-amber-600/[0.08] text-amber-950 dark:text-amber-200" : "border-border bg-muted/60 text-muted-foreground"}`}>
                <span className={`h-2 w-2 rounded-full ${deletionEnabled === true ? "bg-emerald-600" : deletionEnabled === false ? "bg-amber-600" : "bg-muted-foreground/50"}`} />
                {authLoading ? "Checking account status…" : !user ? "Sign in to check account status" : settingsQuery.isLoading ? "Loading account status…" : deletionEnabled === undefined ? "Account status unavailable" : deletionEnabled ? "Deletion requests enabled" : "Deletion requests currently disabled"}
              </div>
              {user && deletionEnabled === false && <span data-testid="text-deletion-disabled-explanation" className="text-xs text-muted-foreground">This account cannot submit a deletion request through JOBSAGE right now.</span>}
            </div>
            {user && settingsQuery.isError && <div role="alert" data-testid="status-deletion-status-error" className="mt-3 flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> We couldn’t verify the current deletion setting for this account.</div>}
            {!user && !authLoading && <p data-testid="text-public-deletion-status" className="mt-3 text-xs text-muted-foreground">This is the public deletion policy. <Link href="/login?next=/account-deletion" data-testid="link-deletion-sign-in" className="text-primary underline">Sign in</Link> to check the current request status.</p>}
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Deletion time limits">
          <div data-testid="card-active-system-retention" className="rounded-2xl border border-border bg-card p-5">
            <CalendarClock className="h-5 w-5 text-primary" /><p className="mt-4 font-mono text-3xl font-semibold">{ACCOUNT_DELETION_POLICY.activeSystemDays}<span className="ml-1 text-base font-medium text-muted-foreground">days</span></p><p className="mt-1 text-sm font-medium">Active systems</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Deletion due within this period after a confirmed request.</p>
          </div>
          <div data-testid="card-backup-retention" className="rounded-2xl border border-border bg-card p-5">
            <LockKeyhole className="h-5 w-5 text-primary" /><p className="mt-4 font-mono text-3xl font-semibold">{ACCOUNT_DELETION_POLICY.encryptedBackupDays}<span className="ml-1 text-base font-medium text-muted-foreground">days</span></p><p className="mt-1 text-sm font-medium">Encrypted backups</p><p className="mt-1 text-xs leading-5 text-muted-foreground">May persist beyond normal operational use for up to this long.</p>
          </div>
          <div data-testid="card-restricted-retention" className="rounded-2xl border border-border bg-card p-5">
            <ShieldAlert className="h-5 w-5 text-primary" /><p className="mt-4 font-mono text-3xl font-semibold">{ACCOUNT_DELETION_POLICY.financialYearsFromCompanyYearEnd}<span className="ml-1 text-base font-medium text-muted-foreground">years</span></p><p className="mt-1 text-sm font-medium">Some financial records</p><p className="mt-1 text-xs leading-5 text-muted-foreground">From the relevant company financial-year end, or longer if legally required.</p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Check className="h-5 w-5" /></div>
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Deletion scope</p><h2 className="mt-1 text-xl font-semibold">What JOBSAGE will delete</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">The approved policy includes these personal and account-linked records.</p></div>
            </div>
            <ul className="space-y-3">
              {ACCOUNT_DELETION_POLICY.deletedData.map((item, index) => <li key={item} data-testid={`text-deleted-data-${index}`} className="flex gap-3 text-sm leading-6 text-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{item}</li>)}
            </ul>
          </div>

          <aside className="rounded-2xl border border-border bg-muted/35 p-5 sm:p-7">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><UsersRound className="h-5 w-5" /></div>
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Before you decide</p><h2 className="mt-1 text-xl font-semibold">Important limits</h2></div>
            </div>
            <div className="space-y-4 text-sm leading-6 text-muted-foreground">
              <p><strong className="text-foreground">Shared organisations stay.</strong> Employer-owned organisations, jobs, campaigns and shared records are preserved. Individual employer or staff identities are removed or shown as “Deleted User”. Sole-owner organisations need an ownership transfer or a separate organisation-deletion process.</p>
              <p><strong className="text-foreground">Recipient copies are independent.</strong> JOBSAGE cannot recall information already downloaded, emailed or transferred to an employer, agency or external ATS.</p>
              <p><strong className="text-foreground">Cancel app-store subscriptions separately.</strong> Account deletion may not cancel an Apple App Store or Google Play subscription.</p>
            </div>
          </aside>
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Retention and process</p>
            <h2 className="mt-1 text-xl font-semibold">What happens after confirmation</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">These are policy time limits and obligations, not a claim that deletion has completed or that every provider control has been verified.</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {ACCOUNT_DELETION_POLICY.disclosures.map((item, index) => <li key={item} data-testid={`text-deletion-disclosure-${index}`} className="flex gap-3 rounded-xl border border-border/75 bg-background/70 p-4 text-sm leading-6 text-muted-foreground"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><span>{item}</span></li>)}
          </ol>
          <div className="mt-5 rounded-xl border border-amber-700/15 bg-amber-600/[0.055] p-4 text-sm leading-6 text-muted-foreground">
            <p><strong className="text-foreground">Other policy time limits:</strong> security, fraud-prevention and access logs may be retained for {ACCOUNT_DELETION_POLICY.securityLogMonths} months; closed complaints and disputes for {ACCOUNT_DELETION_POLICY.closedComplaintMonths} months. Financial and tax records may be retained for {ACCOUNT_DELETION_POLICY.financialYearsFromCompanyYearEnd} years from the relevant company financial-year end, or longer where law requires. Documented legal holds last until the applicable obligation ends.</p>
            <p className="mt-2">Lawfully retained records must be separated and access-restricted, and excluded from advertising, recommendations and marketing. Minimal pseudonymous deletion evidence and genuinely anonymous statistics may remain.</p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-primary/20 bg-primary/[0.035] p-5 sm:p-7" aria-labelledby="subscription-heading">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ExternalLink className="h-5 w-5" /></div>
            <div className="max-w-3xl">
              <h2 id="subscription-heading" className="text-xl font-semibold">Cancel a store subscription</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Deleting your JOBSAGE account may not stop billing managed by Apple or Google. Cancel directly in the store where you subscribed.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div data-testid="text-apple-subscription-steps" className="rounded-xl border border-border bg-card p-4"><p className="font-semibold">Apple App Store</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Settings → your name → Subscriptions → choose JOBSAGE → Cancel Subscription.</p></div>
            <div data-testid="text-google-subscription-steps" className="rounded-xl border border-border bg-card p-4"><p className="font-semibold">Google Play</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Profile icon → Payments &amp; subscriptions → Subscriptions → choose JOBSAGE → Cancel subscription.</p></div>
          </div>
        </section>

        <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div><h2 className="font-semibold">Need to review account privacy options?</h2><p className="mt-1 text-sm text-muted-foreground">You can adjust saved communications, revoke push registrations, or make a personal-data request.</p></div>
          <Link href="/privacy-settings" data-testid="link-privacy-settings" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">Open privacy settings</Link>
        </div>

        <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-sm text-muted-foreground">
          <Link href="/privacy" data-testid="link-privacy-policy" className="hover:text-foreground">Privacy policy</Link>
          <Link href="/help" data-testid="link-deletion-help" className="hover:text-foreground">Contact support</Link>
          <Link href="/" data-testid="link-home" className="hover:text-foreground">JOBSAGE home</Link>
        </footer>
      </div>
    </main>
  );
}
