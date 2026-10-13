import { useQueryClient } from "@tanstack/react-query";
import {
  getListEmployerOrganizationsQueryKey,
  useRestoreEmployerOrganization,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button, Card, PageTransition } from "@/components/ui-enhanced";
import { useEmployerOrganizations } from "@/hooks/useEmployerOrganizations";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function EmployerOrganizationRestorePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organizations = useEmployerOrganizations();
  const restore = useRestoreEmployerOrganization();
  const archived = organizations.data?.archivedOrganizations ?? [];

  function restoreOrganization(id: number, companyName: string) {
    if (!confirm(`Restore ${companyName}? Staff access will become available again.`)) return;
    restore.mutate({ id }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListEmployerOrganizationsQueryKey() });
        toast({ title: "Organisation restored", description: `${companyName} is available again.` });
        setLocation("/employer/dashboard");
      },
      onError: error => toast({
        title: "Organisation not restored",
        description: (error as { data?: { error?: string } } | null)?.data?.error ?? "The restore window may have expired.",
        variant: "destructive",
      }),
    });
  }

  return (
    <AppLayout>
      <PageTransition className="mx-auto max-w-2xl space-y-5 p-6">
        <header className="flex items-center gap-3">
          <ArchiveRestore className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Restore an organisation</h1>
            <p className="text-sm text-muted-foreground">An archived organisation can be restored by its owner within 30 days.</p>
          </div>
        </header>
        {organizations.isLoading ? (
          <Card className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />Loading…</Card>
        ) : organizations.isError ? (
          <Card role="alert" className="p-5 text-sm text-destructive">Archived organisations could not be loaded.</Card>
        ) : archived.length === 0 ? (
          <Card className="space-y-3 p-6">
            <h2 className="font-semibold">No organisation is available to restore</h2>
            <p className="text-sm text-muted-foreground">The restore window may have ended. You can create a new employer workspace instead.</p>
            <Button type="button" variant="outline" onClick={() => setLocation("/employer/onboarding")}>Set up an employer workspace</Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {archived.map(organization => (
              <Card key={organization.id} className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid={`row-archived-organization-${organization.id}`}>
                <div>
                  <h2 className="font-semibold">{organization.companyName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Restore by {new Date(organization.restoreUntil).toLocaleDateString()}
                  </p>
                </div>
                <Button type="button" disabled={restore.isPending}
                  onClick={() => restoreOrganization(organization.id, organization.companyName)}
                  data-testid={`button-restore-organization-${organization.id}`}>
                  {restore.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Restore organisation
                </Button>
              </Card>
            ))}
            <Button type="button" variant="ghost" onClick={() => setLocation("/employer/onboarding")}>Create a new employer workspace instead</Button>
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
