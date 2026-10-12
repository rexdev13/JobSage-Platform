import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { getGetPrivacySettingsQueryKey, useClearSmartApplyDrafts, useGetPrivacySettings, useRequestPersonalData, useRevokePushDevices, useUpdatePrivacySettings } from "@workspace/api-client-react";
import { useAuth } from "@workspace/auth-web";
import { ArrowLeft, Bell, Check, CircleAlert, Download, LockKeyhole, Megaphone, RotateCcw, Shield, Smartphone, Trash2 } from "lucide-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type ExportFormValues = { password: string; confirmed: boolean };
type ToggleRowProps = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  testId: string;
};

function ToggleRow({ title, description, checked, onCheckedChange, disabled, testId }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-border/70 py-5 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={title}
        data-testid={testId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}

function StatusMessage({ children, kind = "success", testId }: { children: string; kind?: "success" | "error"; testId: string }) {
  const success = kind === "success";
  return (
    <div role={success ? "status" : "alert"} data-testid={testId} className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${success ? "border-emerald-800/15 bg-emerald-700/[0.06] text-emerald-900 dark:text-emerald-200" : "border-destructive/20 bg-destructive/5 text-destructive"}`}>
      {success ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export default function PrivacySettingsPage() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = getGetPrivacySettingsQueryKey();
  const settingsQuery = useGetPrivacySettings({ query: { enabled: !!user?.id, queryKey } });
  const settings = settingsQuery.data;
  const [marketing, setMarketing] = useState(false);
  const [optionalAnalytics, setOptionalAnalytics] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const exportForm = useForm<ExportFormValues>({ defaultValues: { password: "", confirmed: false } });

  const updateMutation = useUpdatePrivacySettings({
    request: { headers: { "x-jobsage-privacy-account": user?.id ?? "" } },
  });
  const exportMutation = useRequestPersonalData({
    request: { headers: { "x-jobsage-privacy-account": user?.id ?? "" } },
  });
  const clearMutation = useClearSmartApplyDrafts({
    request: { headers: { "x-jobsage-privacy-account": user?.id ?? "" } },
  });
  const revokeMutation = useRevokePushDevices({
    request: { headers: { "x-jobsage-privacy-account": user?.id ?? "" } },
  });

  useEffect(() => {
    document.title = "Privacy settings | JOBSAGE";
  }, []);

  useEffect(() => {
    if (!settings || settings.userId !== user?.id) return;
    setMarketing(settings.marketing);
    setOptionalAnalytics(settings.optionalAnalytics);
    setNotifications(settings.notifications ?? {});
  }, [settings, user?.id]);

  useEffect(() => {
    setMarketing(false);
    setOptionalAnalytics(false);
    setNotifications({});
    setClearConfirmed(false);
    setRevokeConfirmed(false);
    exportForm.reset({ password: "", confirmed: false });
    updateMutation.reset();
    exportMutation.reset();
    clearMutation.reset();
    revokeMutation.reset();
    void queryClient.invalidateQueries({ queryKey });
    return () => {
      updateMutation.reset();
      exportMutation.reset();
      clearMutation.reset();
      revokeMutation.reset();
    };
  }, [user?.id]);

  const notificationEntries = useMemo(() => Object.entries(notifications).sort(([a], [b]) => a.localeCompare(b)), [notifications]);
  const notificationTitle = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  const saveChoices = () => {
    updateMutation.mutate(
      { data: { marketing, optionalAnalytics, notifications } },
      { onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); } },
    );
  };

  const submitExport = exportForm.handleSubmit(({ password, confirmed }) => {
    if (!user?.id || !confirmed) return;
    exportMutation.mutate({
      data: { expectedAccountId: user.id, password, confirmed: true },
    }, { onSuccess: () => exportForm.reset({ password: "", confirmed: false }) });
  });

  if (authLoading) {
    return <main className="min-h-[100dvh] bg-background px-4 py-10"><div className="mx-auto max-w-4xl animate-pulse space-y-5"><div className="h-4 w-32 rounded bg-muted" /><div className="h-12 w-72 rounded bg-muted" /><div className="h-48 rounded-2xl bg-muted" /><div className="h-48 rounded-2xl bg-muted" /></div></main>;
  }

  if (!isAuthenticated || !user) {
    return (
      <main className="min-h-[100dvh] bg-background px-4 py-12">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10">
          <Link href="/" data-testid="link-back-home" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to JOBSAGE</Link>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your account, your choices</p>
          <h1 className="mt-2 text-3xl font-semibold">Privacy settings</h1>
          <p className="mt-3 max-w-xl leading-7 text-muted-foreground">Sign in to review and change the privacy preferences saved to your JOBSAGE account.</p>
          <Link href="/login?next=/privacy-settings" data-testid="link-sign-in" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">Sign in to continue</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <Link href="/" data-testid="link-back-home" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" /> JOBSAGE</Link>
        <header className="relative mb-8 mt-8 overflow-hidden rounded-[1.75rem] border border-border bg-card px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full bg-primary/[0.06]" />
          <div className="relative max-w-3xl">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Shield className="h-6 w-6" /></div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Privacy controls</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Your data. Your call.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">Review what you have saved, choose the messages you want, and take action on data held for your own account.</p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span data-testid="text-account-id">Account: <span className="font-mono text-foreground">{user.id}</span></span>
              {settings && <span data-testid="text-policy-version">Privacy record · policy {settings.policyVersion}</span>}
            </div>
          </div>
        </header>

        {settingsQuery.isLoading && <div role="status" data-testid="status-settings-loading" className="mb-6 space-y-3 rounded-2xl border border-border bg-card p-6"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /><span className="sr-only">Loading your saved privacy settings</span></div>}
        {settingsQuery.isError && <div role="alert" data-testid="status-settings-error" className="mb-6 flex flex-col gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">We couldn’t load your saved privacy settings. Your existing choices have not been changed.</p><button type="button" data-testid="button-retry-settings" onClick={() => void settingsQuery.refetch()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground"><RotateCcw className="h-4 w-4" /> Try again</button></div>}

        {settings && settings.userId === user.id && (
          <>
            <section aria-labelledby="choices-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Megaphone className="h-5 w-5" /></div>
                <div><h2 id="choices-heading" className="text-xl font-semibold">Communication &amp; optional use</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">These switches reflect the preferences currently saved to your account. Changes take effect after you save.</p></div>
              </div>
              <div className="mt-5">
                <ToggleRow title="Marketing preference" description="Saved opt-in for optional JOBSAGE promotions. Requested service emails and job-alert choices are separate." checked={marketing} onCheckedChange={(value) => { updateMutation.reset(); setMarketing(value); }} disabled={updateMutation.isPending} testId="switch-marketing" />
                <ToggleRow title="Optional analytics preference" description="This choice is saved for optional analytics. No optional analytics collector is currently connected; essential service and security logs are separate." checked={optionalAnalytics} onCheckedChange={(value) => { updateMutation.reset(); setOptionalAnalytics(value); }} disabled={updateMutation.isPending} testId="switch-optional-analytics" />
              </div>
              <div className="mt-7 border-t border-border pt-5">
                <div className="mb-1 flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /><h3 className="font-semibold">Notifications</h3></div>
                <p className="mb-2 text-sm leading-6 text-muted-foreground">Weekly job alerts and employer-reply emails honour the relevant choices below. Document, eligibility and native push delivery integrations are not yet connected. Essential account, requested-service and security messages may still be sent.</p>
                {notificationEntries.length > 0 ? notificationEntries.map(([key, enabled]) => (
                  <ToggleRow key={key} title={notificationTitle(key)} description="Control notifications for this saved category." checked={enabled} onCheckedChange={(value) => { updateMutation.reset(); setNotifications((previous) => ({ ...previous, [key]: value })); }} disabled={updateMutation.isPending} testId={`switch-notification-${key}`} />
                )) : <p data-testid="text-notification-categories-empty" className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">No notification categories are currently listed in your saved settings.</p>}
              </div>
              <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">Preferences are saved to your JOBSAGE account.</p>
                <button type="button" data-testid="button-save-preferences" onClick={saveChoices} disabled={updateMutation.isPending || settingsQuery.isLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{updateMutation.isPending ? "Saving preferences…" : "Save preferences"}</button>
              </div>
              {updateMutation.isSuccess && <StatusMessage testId="status-preferences-saved">Your privacy preferences were saved.</StatusMessage>}
              {updateMutation.isError && <StatusMessage kind="error" testId="status-preferences-error">We couldn’t save these changes. Please try again.</StatusMessage>}
            </section>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section aria-labelledby="devices-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Smartphone className="h-5 w-5" /></div>
                <h2 id="devices-heading" className="mt-4 text-xl font-semibold">Push registrations</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Revoke push registrations linked to your account. This affects your own registered devices and can be set up again later.</p>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-foreground">
                  <input data-testid="checkbox-confirm-revoke-push" type="checkbox" checked={revokeConfirmed} onChange={(event) => setRevokeConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
                  <span>I understand this will revoke my push registrations.</span>
                </label>
                <button type="button" data-testid="button-revoke-push" onClick={() => revokeMutation.mutate({ data: { confirmed: true } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); } })} disabled={!revokeConfirmed || revokeMutation.isPending} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{revokeMutation.isPending ? "Revoking registrations…" : "Revoke my push registrations"}</button>
                {revokeMutation.isSuccess && <StatusMessage testId="status-push-revoked">Your push registrations were revoked.</StatusMessage>}
                {revokeMutation.isError && <StatusMessage kind="error" testId="status-push-revoke-error">We couldn’t revoke your push registrations. Please try again.</StatusMessage>}
              </section>

              <section aria-labelledby="drafts-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Trash2 className="h-5 w-5" /></div>
                <h2 id="drafts-heading" className="mt-4 text-xl font-semibold">Smart Apply drafts</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Clear Smart Apply server-side drafts belonging to your account. This does not submit or change applications on external employer sites.</p>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-foreground">
                  <input data-testid="checkbox-confirm-clear-drafts" type="checkbox" checked={clearConfirmed} onChange={(event) => setClearConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
                  <span>I understand this permanently clears my saved Smart Apply drafts.</span>
                </label>
                <button type="button" data-testid="button-clear-drafts" onClick={() => clearMutation.mutate({ data: { confirmed: true } })} disabled={!clearConfirmed || clearMutation.isPending} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{clearMutation.isPending ? "Clearing drafts…" : "Clear my Smart Apply drafts"}</button>
                {clearMutation.isSuccess && <StatusMessage testId="status-drafts-cleared">Your Smart Apply server drafts were cleared.</StatusMessage>}
                {clearMutation.isError && <StatusMessage kind="error" testId="status-drafts-clear-error">We couldn’t clear your drafts. Please try again.</StatusMessage>}
              </section>
            </div>

            <section aria-labelledby="export-heading" className="mt-6 rounded-2xl border border-primary/20 bg-primary/[0.035] p-5 shadow-sm sm:p-7">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Download className="h-5 w-5" /></div>
                <div><h2 id="export-heading" className="text-xl font-semibold">Request your personal-data export</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">This creates an authenticated support request and gives you a receipt. It does not generate or deliver an export file.</p></div>
              </div>
              <Form {...exportForm}>
                <form onSubmit={submitExport} className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <input type="text" name="username" value={user.email ?? ""} autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
                  <FormField control={exportForm.control} name="password" rules={{ required: "Enter your password to verify your account." }} render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm your password</FormLabel>
                      <FormControl><Input data-testid="input-export-password" type="password" autoComplete="current-password" placeholder="Your account password" {...field} /></FormControl>
                      <FormDescription>Used to verify this request.</FormDescription>
                      {exportForm.formState.errors.password && <p role="alert" data-testid="error-export-password" className="text-sm text-destructive">{exportForm.formState.errors.password.message}</p>}
                    </FormItem>
                  )} />
                  <FormField control={exportForm.control} name="confirmed" rules={{ validate: (value) => value || "Please confirm your request." }} render={({ field }) => (
                    <FormItem className="space-y-2">
                      <div className="flex min-h-11 items-center gap-3">
                        <FormControl><input data-testid="checkbox-confirm-export" type="checkbox" checked={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} className="h-4 w-4 accent-primary" /></FormControl>
                        <FormLabel className="cursor-pointer">I’m requesting a personal-data export.</FormLabel>
                      </div>
                      {exportForm.formState.errors.confirmed && <p role="alert" data-testid="error-export-confirmation" className="text-sm text-destructive">{exportForm.formState.errors.confirmed.message}</p>}
                    </FormItem>
                  )} />
                  <button type="submit" data-testid="button-request-export" disabled={exportMutation.isPending || exportMutation.isSuccess} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-wait disabled:opacity-60">{exportMutation.isPending ? "Sending request…" : exportMutation.isSuccess ? "Request received" : "Request export"}</button>
                </form>
              </Form>
              {exportMutation.isSuccess && exportMutation.data && <div role="status" data-testid="status-export-requested" className="mt-5 rounded-xl border border-primary/20 bg-card p-4"><p className="font-semibold text-foreground">Request received · {exportMutation.data.status}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{exportMutation.data.message}</p><p className="mt-2 font-mono text-xs text-muted-foreground">Receipt {exportMutation.data.ticketId}</p><p className="mt-2 text-xs font-medium text-primary">This receipt confirms a support request only. No export file has been generated or delivered.</p></div>}
              {exportMutation.isError && <StatusMessage kind="error" testId="status-export-error">We couldn’t submit the request. Please check your password and try again.</StatusMessage>}
            </section>
          </>
        )}
        <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-sm text-muted-foreground">
          <Link href="/privacy" data-testid="link-privacy-policy" className="hover:text-foreground">Privacy policy</Link>
          <Link href="/account-deletion" data-testid="link-account-deletion" className="hover:text-foreground">Deletion &amp; retention</Link>
          <Link href="/help" data-testid="link-privacy-help" className="hover:text-foreground">Privacy support</Link>
        </footer>
      </div>
    </main>
  );
}
