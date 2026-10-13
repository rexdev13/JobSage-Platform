import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEmployerJobsQueryKey,
  getListEmployerOrganizationsQueryKey,
  getListEmployerStaffQueryKey,
  useArchiveEmployerOrganization,
  useAssignEmployerJob,
  useCreateEmployerStaffInvitation,
  useListEmployerJobs,
  useListEmployerStaff,
  useRemoveEmployerStaffMember,
  useRevokeEmployerStaffInvitation,
  useTransferEmployerOwnership,
  useUpdateEmployerStaffRole,
} from "@workspace/api-client-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button, Card, PageTransition } from "@/components/ui-enhanced";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEmployerOrganizations, type EmployerStaffRole } from "@/hooks/useEmployerOrganizations";
import { Loader2, ShieldCheck, UserMinus, Users } from "lucide-react";

const invitationSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  role: z.enum(["employer_admin", "recruiter", "hiring_manager", "employer_viewer"]),
});
type InvitationFormValues = z.infer<typeof invitationSchema>;

const STAFF_ROLE_LABELS: Record<EmployerStaffRole, string> = {
  employer_owner: "Owner",
  employer_admin: "Organisation admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  employer_viewer: "Read-only viewer",
};
const INVITABLE_ROLES = ["employer_admin", "recruiter", "hiring_manager", "employer_viewer"] as const;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { data?: { error?: string } } | null)?.data?.error ?? fallback;
}

export default function EmployerStaffPage() {
  const [, setLocation] = useLocation();
  const { activeOrganization } = useEmployerOrganizations();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const staffQuery = useListEmployerStaff({
    query: { queryKey: getListEmployerStaffQueryKey(), enabled: true, retry: false },
  });
  const jobsQuery = useListEmployerJobs({
    query: { queryKey: getListEmployerJobsQueryKey(), enabled: true, retry: false },
  });
  const invite = useCreateEmployerStaffInvitation();
  const revokeInvite = useRevokeEmployerStaffInvitation();
  const changeRole = useUpdateEmployerStaffRole();
  const removeMember = useRemoveEmployerStaffMember();
  const assignJob = useAssignEmployerJob();
  const transferOwnership = useTransferEmployerOwnership();
  const archiveOrganization = useArchiveEmployerOrganization();
  const form = useForm<InvitationFormValues>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { email: "", role: "recruiter" },
  });

  const data = staffQuery.data;
  const isOwner = activeOrganization?.role === "employer_owner";
  const isOwnerOrAdmin = isOwner || activeOrganization?.role === "employer_admin";

  async function refreshStaff() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListEmployerStaffQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListEmployerJobsQueryKey() }),
    ]);
  }

  async function onInvite(values: InvitationFormValues) {
    try {
      await invite.mutateAsync({ data: values });
      form.reset({ email: "", role: "recruiter" });
      await refreshStaff();
      toast({ title: "Invitation sent", description: `${values.email} can accept from their verified account.` });
    } catch (error) {
      toast({ title: "Invitation not sent", description: errorMessage(error, "Try again later."), variant: "destructive" });
    }
  }

  function changeMemberRole(userId: string, role: InvitationFormValues["role"]) {
    changeRole.mutate({ userId, data: { role } }, {
      onSuccess: () => { void refreshStaff(); toast({ title: "Staff role updated." }); },
      onError: error => toast({ title: "Role not changed", description: errorMessage(error, "Try again."), variant: "destructive" }),
    });
  }

  function removeStaff(userId: string) {
    if (!confirm("Remove this person from the organisation? Their access will end immediately.")) return;
    removeMember.mutate({ userId }, {
      onSuccess: () => { void refreshStaff(); toast({ title: "Staff member removed." }); },
      onError: error => toast({ title: "Staff member not removed", description: errorMessage(error, "Try again."), variant: "destructive" }),
    });
  }

  function setJobAssignment(jobListingId: number, userId: string, assigned: boolean) {
    assignJob.mutate({ data: { jobListingId, userId, assigned } }, {
      onSuccess: () => { void refreshStaff(); },
      onError: error => toast({ title: "Assignment not updated", description: errorMessage(error, "Try again."), variant: "destructive" }),
    });
  }

  function transfer(userId: string) {
    if (!userId || !confirm("Transfer ownership? You will become an organisation admin.")) return;
    transferOwnership.mutate({ data: { userId } }, {
      onSuccess: () => {
        void refreshStaff();
        toast({ title: "Ownership transferred", description: "Your access is now organisation admin." });
      },
      onError: error => toast({ title: "Ownership not transferred", description: errorMessage(error, "Try again."), variant: "destructive" }),
    });
  }

  function archive(confirmCompanyName: string) {
    if (confirmCompanyName !== activeOrganization?.companyName) return;
    archiveOrganization.mutate({ data: { confirmCompanyName } }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListEmployerOrganizationsQueryKey() });
        toast({ title: "Organisation archived", description: "The owner can restore it within 30 days." });
        setLocation("/employer/organizations/restore");
      },
      onError: error => toast({ title: "Organisation not archived", description: errorMessage(error, "Try again."), variant: "destructive" }),
    });
  }

  const members = data?.members ?? [];
  const jobs = jobsQuery.data?.jobs ?? [];
  const assignments = data?.assignments ?? [];

  return (
    <AppLayout>
      <PageTransition className="mx-auto max-w-5xl space-y-6 p-6">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{activeOrganization?.companyName ?? "Employer workspace"}</p>
            <h1 className="text-2xl font-bold">Organisation staff</h1>
          </div>
        </header>

        {staffQuery.isLoading ? (
          <Card className="p-8 text-center" data-testid="status-staff-loading">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" aria-hidden="true" />
            Loading staff…
          </Card>
        ) : staffQuery.isError ? (
          <Card className="p-6 text-sm text-destructive" role="alert" data-testid="status-staff-error">
            {errorMessage(staffQuery.error, "Staff details could not be loaded.")}
          </Card>
        ) : (
          <>
            {isOwnerOrAdmin && (
              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="font-semibold">Invite a colleague</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Invitations expire after seven days and can only be accepted by the verified email address.</p>
                </div>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onInvite)} className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email address</FormLabel>
                        <FormControl><Input type="email" autoComplete="email" data-testid="input-staff-email" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger data-testid="select-staff-invite-role"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {INVITABLE_ROLES.map(role => <SelectItem key={role} value={role}>{STAFF_ROLE_LABELS[role]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={invite.isPending} data-testid="button-send-staff-invitation">
                      {invite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      Send invitation
                    </Button>
                  </form>
                </Form>
              </Card>
            )}

            <Card className="overflow-hidden">
              <div className="border-b p-5">
                <h2 className="font-semibold">Active staff</h2>
                <p className="mt-1 text-sm text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</p>
              </div>
              <div className="divide-y">
                {members.map(member => (
                  <div key={member.userId} data-testid={`row-staff-${member.userId}`} className="grid gap-3 p-4 sm:grid-cols-[1fr_210px_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.email}</p>
                      <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                    </div>
                    {isOwnerOrAdmin && member.role !== "employer_owner" ? (
                      <Select value={member.role} onValueChange={value => changeMemberRole(member.userId, value as InvitationFormValues["role"])}>
                        <SelectTrigger aria-label={`Role for ${member.email}`} data-testid={`select-role-${member.userId}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INVITABLE_ROLES.map(role => <SelectItem key={role} value={role}>{STAFF_ROLE_LABELS[role]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">{STAFF_ROLE_LABELS[member.role]}</p>
                    )}
                    {isOwnerOrAdmin && member.role !== "employer_owner" && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeStaff(member.userId)}
                        aria-label={`Remove ${member.email}`} data-testid={`button-remove-staff-${member.userId}`}>
                        <UserMinus className="mr-2 h-4 w-4" aria-hidden="true" /> Remove
                      </Button>
                    )}
                  </div>
                ))}
                {members.length === 0 && <p className="p-5 text-sm text-muted-foreground">No active staff members are listed.</p>}
              </div>
            </Card>

            {(data?.invitations.length ?? 0) > 0 && (
              <Card className="overflow-hidden">
                <div className="border-b p-5"><h2 className="font-semibold">Pending invitations</h2></div>
                <div className="divide-y">
                  {data!.invitations.map(item => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`row-invitation-${item.id}`}>
                      <div>
                        <p className="font-medium">{item.email}</p>
                        <p className="text-sm text-muted-foreground">{STAFF_ROLE_LABELS[item.role]} · expires {new Date(item.expiresAt).toLocaleDateString()}</p>
                      </div>
                      {isOwnerOrAdmin && <Button type="button" variant="outline" size="sm" disabled={revokeInvite.isPending}
                        onClick={() => revokeInvite.mutate({ id: item.id }, {
                          onSuccess: () => { void refreshStaff(); toast({ title: "Invitation revoked." }); },
                          onError: error => toast({ title: "Invitation not revoked", description: errorMessage(error, "Try again."), variant: "destructive" }),
                        })} data-testid={`button-revoke-invitation-${item.id}`}>Revoke</Button>}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {isOwnerOrAdmin && (
              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="font-semibold">Job access</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Staff can only access applications and job details for roles assigned here.</p>
                </div>
                {jobs.map(job => (
                  <section key={job.id} className="border-t pt-4" aria-label={`Staff access for ${job.title}`}>
                    <h3 className="mb-3 font-medium">{job.title}</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {members.filter(member => member.role !== "employer_owner").map(member => {
                        const assigned = assignments.some(item => item.jobListingId === job.id && item.userId === member.userId);
                        return (
                          <label key={member.userId} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                            <input type="checkbox" checked={assigned} disabled={assignJob.isPending}
                              onChange={event => setJobAssignment(job.id, member.userId, event.currentTarget.checked)}
                              aria-label={`${assigned ? "Unassign" : "Assign"} ${member.email} to ${job.title}`}
                              data-testid={`checkbox-assignment-${job.id}-${member.userId}`} />
                            <span className="min-w-0 truncate">{member.email}</span>
                          </label>
                        );
                      })}
                      {!members.some(member => member.role !== "employer_owner") && (
                        <p className="text-sm text-muted-foreground">Invite staff before assigning job access.</p>
                      )}
                    </div>
                  </section>
                ))}
                {jobs.length === 0 && <p className="text-sm text-muted-foreground">Create a job before assigning staff access.</p>}
              </Card>
            )}

            {isOwner && (
              <OwnershipControls
                members={members.filter(member => member.role !== "employer_owner")}
                onTransfer={transfer}
                pending={transferOwnership.isPending}
                companyName={activeOrganization?.companyName ?? ""}
                onArchive={archive}
                archivePending={archiveOrganization.isPending}
              />
            )}
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}

function OwnershipControls({
  members, onTransfer, pending, companyName, onArchive, archivePending,
}: {
  members: Array<{ userId: string; email: string; role: EmployerStaffRole }>;
  onTransfer: (userId: string) => void;
  pending: boolean;
  companyName: string;
  onArchive: (companyName: string) => void;
  archivePending: boolean;
}) {
  const [transferUserId, setTransferUserId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <Card className="space-y-5 border-destructive/30 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Owner controls</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor="transfer-owner" className="mb-2 block text-sm font-medium">Transfer ownership</label>
          <Select value={transferUserId} onValueChange={setTransferUserId}>
            <SelectTrigger id="transfer-owner" data-testid="select-new-owner"><SelectValue placeholder="Choose an active staff member" /></SelectTrigger>
            <SelectContent>
              {members.map(member => <SelectItem key={member.userId} value={member.userId}>{member.email} · {STAFF_ROLE_LABELS[member.role]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" disabled={!transferUserId || pending} onClick={() => onTransfer(transferUserId)}
          data-testid="button-transfer-ownership">Transfer ownership</Button>
      </div>
      <div className="border-t pt-4">
        <label htmlFor="archive-company-confirmation" className="mb-2 block text-sm font-medium">Archive organisation</label>
        <p className="mb-3 text-sm text-muted-foreground">This hides the organisation and blocks staff access. It can be restored by the owner within 30 days.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input id="archive-company-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)}
            placeholder={`Type ${companyName} to confirm`} data-testid="input-archive-confirmation" />
          <Button type="button" variant="destructive" disabled={confirmation !== companyName || archivePending}
            onClick={() => onArchive(confirmation)} data-testid="button-archive-organization">Archive organisation</Button>
        </div>
      </div>
    </Card>
  );
}
