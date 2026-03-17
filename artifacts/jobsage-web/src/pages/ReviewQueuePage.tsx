import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition } from "@/components/ui-enhanced";
import {
  useListReviewQueue,
  useGetReviewCase,
  useAnnotateReviewCase,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListReviewQueueQueryKey } from "@workspace/api-client-react";
import { Users, CheckCircle2, AlertCircle, Clock, ChevronRight, Loader2 } from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

const DISCLAIMER = "This platform provides decision support only. Final decisions rest with the relevant regulator.";

function StatusBadge({ status }: { status: string }) {
  if (status === "reviewed")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle2 className="w-3 h-3" /> Reviewed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function AnnotationForm({ caseId, onDone }: { caseId: number; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [pathway, setPathway] = useState("");
  const queryClient = useQueryClient();
  const { mutate, isPending, isError } = useAnnotateReviewCase({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReviewQueueQueryKey() });
        onDone();
      },
    },
  });

  return (
    <div className="mt-4 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Add Reviewer Annotation</h4>
      <textarea
        className="w-full rounded border border-border bg-background text-sm p-2.5 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
        placeholder="Clinical notes and decision rationale…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <input
        className="w-full rounded border border-border bg-background text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
        placeholder="Recommended pathway (optional)"
        value={pathway}
        onChange={(e) => setPathway(e.target.value)}
      />
      {isError && (
        <p className="text-xs text-destructive">Failed to save annotation. Please try again.</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() =>
            mutate({
              caseId,
              data: { notes, recommendedPathway: pathway || undefined },
            })
          }
          disabled={isPending || !notes.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Annotation"}
        </button>
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CaseDetail({ caseId, onBack }: { caseId: number; onBack: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, isError } = useGetReviewCase(caseId);

  if (isLoading)
    return (
      <Card className="p-8 text-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Loading case…</p>
      </Card>
    );

  if (isError || !data)
    return (
      <Card className="p-8 text-center border-destructive/20">
        <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Could not load case details.</p>
      </Card>
    );

  const { case: rc, decision, profile, annotations } = data;

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        ← Back to queue
      </button>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Case #{rc.id}</h2>
          <StatusBadge status={rc.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Flag reason:</span> {rc.flagReason}
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Outcome:</span>{" "}
          <span className="capitalize">{decision?.outcome?.replace("_", " ") ?? "Unknown"}</span>
        </p>
        {decision?.explanationText && (
          <p className="text-sm text-muted-foreground">{decision.explanationText}</p>
        )}
        {decision?.reasonCodes && decision.reasonCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {decision.reasonCodes.map((rc) => (
              <span
                key={rc}
                className="px-2 py-0.5 rounded-full bg-muted text-xs font-mono text-muted-foreground"
              >
                {rc}
              </span>
            ))}
          </div>
        )}
      </Card>

      {profile && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Candidate Profile</h3>
          <div className="grid grid-cols-2 gap-y-2 text-xs">
            {[
              ["Profession", profile.profession],
              ["Specialty", profile.specialty],
              ["Qualification country", profile.qualificationCountry],
              ["Registration status", profile.registrationStatus],
              ["Experience (years)", profile.experienceYears?.toString() ?? "—"],
              ["Requires sponsorship", profile.requiresSponsorship ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="text-muted-foreground">{label}: </span>
                <span className="font-medium text-foreground capitalize">{value ?? "—"}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {annotations.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Annotations</h3>
          <div className="space-y-3">
            {annotations.map((a) => (
              <div key={a.id} className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="font-medium text-foreground">{a.notes}</p>
                {a.recommendedPathway && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Recommended pathway: {a.recommendedPathway}
                  </p>
                )}
                <p className="mt-1 text-muted-foreground text-xs">
                  {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rc.status === "pending" && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-2.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/5 transition-colors"
        >
          Add Annotation &amp; Mark Reviewed
        </button>
      )}

      {showForm && <AnnotationForm caseId={rc.id} onDone={() => setShowForm(false)} />}
    </div>
  );
}

export default function ReviewQueuePage() {
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "reviewed">("");

  const { data, isLoading, isError } = useListReviewQueue(
    statusFilter ? { status: statusFilter } : undefined
  );

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner message={DISCLAIMER} />

        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Human Review Queue
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review flagged cases and add clinical annotations.
          </p>
        </div>

        {selectedCaseId ? (
          <CaseDetail caseId={selectedCaseId} onBack={() => setSelectedCaseId(null)} />
        ) : (
          <>
            <div className="flex gap-2 text-sm">
              {(["", "pending", "reviewed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-1.5 rounded-full border font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {isLoading && (
              <Card className="p-8 text-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading review queue…</p>
              </Card>
            )}

            {isError && (
              <Card className="p-8 text-center border-destructive/20">
                <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Could not load review queue. Ensure you have reviewer or admin access.
                </p>
              </Card>
            )}

            {!isLoading && !isError && (data?.cases?.length ?? 0) === 0 && (
              <Card className="p-10 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No cases match the current filter.</p>
              </Card>
            )}

            {!isLoading && !isError && (data?.cases?.length ?? 0) > 0 && (
              <div className="space-y-3">
                {data!.cases.map((c) => (
                  <Card
                    key={c.id}
                    className="p-4 cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => setSelectedCaseId(c.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            #{c.id}
                          </span>
                          <StatusBadge status={c.status} />
                          {c.outcome && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                              {c.outcome}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground truncate">{c.flagReason}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {c.profession && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {c.profession}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(c.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}
