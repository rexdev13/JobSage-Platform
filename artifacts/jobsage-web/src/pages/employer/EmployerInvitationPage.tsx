import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEmployerInvitationQueryKey,
  getListEmployerOrganizationsQueryKey,
  useAcceptEmployerInvitation,
  useDeclineEmployerInvitation,
  useGetEmployerInvitation,
} from "@workspace/api-client-react";
import { useLocation, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button, Card, PageTransition } from "@/components/ui-enhanced";
import { Loader2, MailCheck } from "lucide-react";

function messageFrom(error: unknown) {
  return (error as { data?: { error?: string } } | null)?.data?.error ?? "Please try again after checking your account.";
}

export default function EmployerInvitationPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const preview = useGetEmployerInvitation(token, {
    query: { queryKey: getGetEmployerInvitationQueryKey(token), enabled: !!token, retry: false },
  });
  const accept = useAcceptEmployerInvitation();
  const decline = useDeclineEmployerInvitation();
  const mutationError = accept.error ?? decline.error;

  function acceptInvite() {
    accept.mutate({ token }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListEmployerOrganizationsQueryKey() });
        setLocation("/employer/dashboard");
      },
    });
  }

  function declineInvite() {
    decline.mutate({ token }, {
      onSuccess: () => setLocation("/"),
    });
  }

  return (
    <AppLayout>
      <PageTransition className="mx-auto max-w-xl p-6">
        <Card className="space-y-5 p-6 sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          {preview.isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="status-invitation-loading">Checking invitation…</p>
          ) : preview.isError ? (
            <div role="alert" className="space-y-2" data-testid="status-invitation-error">
              <h1 className="text-xl font-semibold">Invitation unavailable</h1>
              <p className="text-sm text-muted-foreground">{messageFrom(preview.error)}</p>
            </div>
          ) : preview.data?.invitation.accepted ? (
            <div className="space-y-2" data-testid="status-invitation-accepted">
              <h1 className="text-xl font-semibold">Invitation already accepted</h1>
              <p className="text-sm text-muted-foreground">This account is already a member of {preview.data.invitation.companyName}.</p>
              <Button type="button" onClick={() => setLocation("/employer/dashboard")} data-testid="button-open-employer-workspace">Open workspace</Button>
            </div>
          ) : preview.data?.invitation ? (
            <>
              <div>
                <p className="text-sm font-medium text-primary">Employer staff invitation</p>
                <h1 className="mt-1 text-xl font-semibold">Join {preview.data.invitation.companyName}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  You were invited as <span className="font-medium capitalize">{preview.data.invitation.role.replaceAll("_", " ")}</span>.
                  Accept only if you recognize this organisation. The invitation expires {new Date(preview.data.invitation.expiresAt).toLocaleDateString()}.
                </p>
              </div>
              {mutationError && <p role="alert" className="text-sm text-destructive">{messageFrom(mutationError)}</p>}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={acceptInvite} disabled={accept.isPending || decline.isPending} data-testid="button-accept-employer-invitation">
                  {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Accept invitation
                </Button>
                <Button type="button" variant="outline" onClick={declineInvite} disabled={accept.isPending || decline.isPending} data-testid="button-decline-employer-invitation">
                  Decline
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">You must be signed in with the verified email address this invitation was sent to.</p>
            </>
          ) : null}
        </Card>
      </PageTransition>
    </AppLayout>
  );
}
