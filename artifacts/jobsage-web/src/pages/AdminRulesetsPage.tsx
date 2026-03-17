import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListRulesets,
  useGetRuleset,
  usePublishRuleset,
  useRunRegressionTest,
  useListDecisions,
  useCreateRuleset,
  getGetRulesetQueryKey,
} from "@workspace/api-client-react";
import type {
  Ruleset,
  RegressionTestCaseResult,
  CreateRulesetRequest,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
  Play,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Shield,
  Users,
  AlertTriangle,
  Plus,
  Trash2,
} from "lucide-react";

const SAMPLE_REGRESSION_CASES = [
  {
    label: "GMC — UK-qualified doctor already registered",
    profile: {
      profession: "doctor" as const,
      specialty: "General Medicine",
      qualificationCountry: "United Kingdom",
      qualificationType: "MBChB",
      qualificationYear: 2018,
      experienceYears: 6,
      registrationStatus: "registered" as const,
      residencyStatus: "citizen",
      requiresSponsorship: false,
    },
    expectedOutcome: "eligible" as const,
  },
  {
    label: "GMC — Indian doctor, not registered, PLAB needed",
    profile: {
      profession: "doctor" as const,
      specialty: "Cardiology",
      qualificationCountry: "India",
      qualificationType: "MBBS",
      qualificationYear: 2019,
      experienceYears: 4,
      registrationStatus: "not_registered" as const,
      residencyStatus: "visa_required",
      requiresSponsorship: true,
    },
    expectedOutcome: "eligible" as const,
  },
  {
    label: "NMC — Nigerian nurse, registered, English-speaking country",
    profile: {
      profession: "nurse" as const,
      specialty: "General Nursing",
      qualificationCountry: "Nigeria",
      qualificationType: "BNSc",
      qualificationYear: 2017,
      experienceYears: 7,
      registrationStatus: "registered" as const,
      residencyStatus: "visa_required",
      requiresSponsorship: true,
    },
    expectedOutcome: "eligible" as const,
  },
  {
    label: "HCPC — Indian physiotherapist, not registered",
    profile: {
      profession: "allied_health_professional" as const,
      specialty: "Physiotherapy",
      qualificationCountry: "India",
      qualificationType: "BPT",
      qualificationYear: 2020,
      experienceYears: 4,
      registrationStatus: "not_registered" as const,
      residencyStatus: "visa_required",
      requiresSponsorship: true,
    },
    expectedOutcome: "not_eligible" as const,
  },
  {
    label: "GMC — Nurse trying GMC (wrong profession)",
    profile: {
      profession: "nurse" as const,
      specialty: "General Nursing",
      qualificationCountry: "United Kingdom",
      qualificationType: "BNSc",
      qualificationYear: 2019,
      experienceYears: 5,
      registrationStatus: "registered" as const,
      residencyStatus: "citizen",
      requiresSponsorship: false,
    },
    expectedOutcome: "ineligible" as const,
  },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" />
        Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
      <Clock className="w-3 h-3" />
      Draft
    </span>
  );
}

function RulesetCard({
  ruleset,
  onPublish,
  onRunTests,
}: {
  ruleset: Ruleset;
  onPublish: (id: number) => void;
  onRunTests: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: rulesetDetail } = useGetRuleset(ruleset.id, {
    query: { enabled: expanded, queryKey: getGetRulesetQueryKey(ruleset.id) },
  });

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg font-bold text-foreground">{ruleset.regulator}</span>
            <span className="text-sm text-muted-foreground font-mono">v{ruleset.version}</span>
            <StatusBadge status={ruleset.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Effective: {new Date(ruleset.effectiveDate).toLocaleDateString("en-GB")}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{ruleset.changelog}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {ruleset.status === "draft" && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onPublish(ruleset.id)}
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Publish
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onRunTests(ruleset.id)}>
            <Play className="w-4 h-4 mr-1.5" />
            Run Tests
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {expanded && rulesetDetail && (
        <div className="mt-6 pt-6 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">
            Rules ({rulesetDetail.rules.length})
          </h4>
          <div className="space-y-3">
            {rulesetDetail.rules.map((rule) => (
              <div key={rule.id} className="p-3 rounded-xl bg-muted/50 text-sm">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <code className="text-xs font-mono text-primary">{rule.ruleKey}</code>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      rule.outcome === "eligible"
                        ? "bg-emerald-100 text-emerald-700"
                        : rule.outcome === "ineligible"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {rule.outcome.replace("_", " ")}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">{rule.explanationText}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {rule.conditions.map((c, i) => (
                    <code key={i} className="text-xs px-2 py-0.5 bg-background border border-border rounded">
                      {c.field} {c.operator} {JSON.stringify(c.value)}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function RegressionTestResults({ results }: { results: RegressionTestCaseResult[] }) {
  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div
          key={r.label}
          className={`flex items-start gap-3 p-3 rounded-xl text-sm ${
            r.passed ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"
          }`}
        >
          {r.passed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">{r.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Expected: <strong>{r.expectedOutcome}</strong> → Actual: <strong>{r.actualOutcome}</strong>
            </p>
            {!r.passed && (
              <p className="text-xs text-red-700 mt-1">{r.explanationText}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

type DraftRule = {
  ruleKey: string;
  outcome: "eligible" | "not_eligible" | "ineligible";
  reasonCode: string;
  explanationText: string;
  sortOrder: number;
  conditions: Array<{ field: string; operator: string; value: string }>;
};

const EMPTY_RULE = (): DraftRule => ({
  ruleKey: "",
  outcome: "eligible",
  reasonCode: "",
  explanationText: "",
  sortOrder: 0,
  conditions: [{ field: "", operator: "eq", value: "" }],
});

function CreateDraftRulesetForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [regulator, setRegulator] = useState<"GMC" | "NMC" | "HCPC">("GMC");
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [changelog, setChangelog] = useState("");
  const [rules, setRules] = useState<DraftRule[]>([EMPTY_RULE()]);
  const [error, setError] = useState<string | null>(null);

  const { mutate: createRuleset, isPending } = useCreateRuleset({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setVersion("");
        setEffectiveDate("");
        setChangelog("");
        setRules([EMPTY_RULE()]);
        setError(null);
        onCreated();
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to create ruleset");
      },
    },
  });

  const addRule = () => setRules((rs) => [...rs, { ...EMPTY_RULE(), sortOrder: rs.length }]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i));
  const updateRule = (i: number, patch: Partial<DraftRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addCondition = (ri: number) =>
    setRules((rs) =>
      rs.map((r, idx) =>
        idx === ri ? { ...r, conditions: [...r.conditions, { field: "", operator: "eq", value: "" }] } : r
      )
    );
  const removeCondition = (ri: number, ci: number) =>
    setRules((rs) =>
      rs.map((r, idx) =>
        idx === ri ? { ...r, conditions: r.conditions.filter((_, ci2) => ci2 !== ci) } : r
      )
    );
  const updateCondition = (ri: number, ci: number, patch: Partial<DraftRule["conditions"][0]>) =>
    setRules((rs) =>
      rs.map((r, idx) =>
        idx === ri
          ? { ...r, conditions: r.conditions.map((c, ci2) => (ci2 === ci ? { ...c, ...patch } : c)) }
          : r
      )
    );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!version.trim() || !effectiveDate || !changelog.trim()) {
      setError("All fields are required.");
      return;
    }
    for (const rule of rules) {
      if (!rule.ruleKey.trim() || !rule.reasonCode.trim() || !rule.explanationText.trim()) {
        setError("All rule fields (key, reason code, explanation) are required.");
        return;
      }
      for (const cond of rule.conditions) {
        if (!cond.field.trim() || !cond.value.trim()) {
          setError("All condition fields and values must be filled.");
          return;
        }
      }
    }

    const payload: CreateRulesetRequest = {
      regulator,
      version: version.trim(),
      effectiveDate: new Date(effectiveDate).toISOString(),
      changelog: changelog.trim(),
      rules: rules.map((r, i) => ({
        ruleKey: r.ruleKey.trim(),
        outcome: r.outcome,
        reasonCode: r.reasonCode.trim(),
        explanationText: r.explanationText.trim(),
        sortOrder: i,
        conditions: r.conditions.map((c) => ({
          field: c.field.trim(),
          operator: c.operator as "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "exists",
          value: (() => {
            const raw = c.value.trim();
            const n = Number(raw);
            if (!isNaN(n) && raw !== "") return n as unknown as string;
            if (raw === "true") return true as unknown as string;
            if (raw === "false") return false as unknown as string;
            return raw;
          })(),
        })),
      })),
    };

    createRuleset({ data: payload });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-1.5" />
        New Draft Ruleset
      </Button>
    );
  }

  return (
    <Card className="p-6 border-primary/30">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-foreground">Create Draft Ruleset</h3>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-sm">
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Regulator</label>
            <select
              value={regulator}
              onChange={(e) => setRegulator(e.target.value as "GMC" | "NMC" | "HCPC")}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
            >
              <option value="GMC">GMC</option>
              <option value="NMC">NMC</option>
              <option value="HCPC">HCPC</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Version</label>
            <input
              type="text"
              placeholder="e.g. 1.1.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Effective Date</label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Changelog</label>
            <input
              type="text"
              placeholder="Describe what changed"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              required
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-medium text-muted-foreground">Rules</label>
            <button
              type="button"
              onClick={addRule}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add Rule
            </button>
          </div>

          <div className="space-y-4">
            {rules.map((rule, ri) => (
              <div key={ri} className="p-4 border border-border rounded-xl bg-muted/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Rule {ri + 1}</span>
                  {rules.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRule(ri)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Rule Key</label>
                    <input
                      type="text"
                      placeholder="RULE_001"
                      value={rule.ruleKey}
                      onChange={(e) => updateRule(ri, { ruleKey: e.target.value })}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-background text-foreground font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Outcome</label>
                    <select
                      value={rule.outcome}
                      onChange={(e) => updateRule(ri, { outcome: e.target.value as DraftRule["outcome"] })}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-background text-foreground"
                    >
                      <option value="eligible">eligible</option>
                      <option value="not_eligible">not_eligible</option>
                      <option value="ineligible">ineligible</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Reason Code</label>
                    <input
                      type="text"
                      placeholder="REASON_CODE"
                      value={rule.reasonCode}
                      onChange={(e) => updateRule(ri, { reasonCode: e.target.value })}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-background text-foreground font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Explanation</label>
                  <textarea
                    rows={2}
                    placeholder="Human-readable explanation of this rule's outcome"
                    value={rule.explanationText}
                    onChange={(e) => updateRule(ri, { explanationText: e.target.value })}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-background text-foreground resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-muted-foreground">Conditions (all must match)</label>
                    <button
                      type="button"
                      onClick={() => addCondition(ri)}
                      className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {rule.conditions.map((cond, ci) => (
                      <div key={ci} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="field"
                          value={cond.field}
                          onChange={(e) => updateCondition(ri, ci, { field: e.target.value })}
                          className="flex-1 border border-border rounded px-2 py-1 text-xs bg-background text-foreground font-mono"
                        />
                        <select
                          value={cond.operator}
                          onChange={(e) => updateCondition(ri, ci, { operator: e.target.value })}
                          className="border border-border rounded px-1.5 py-1 text-xs bg-background text-foreground"
                        >
                          <option value="eq">eq</option>
                          <option value="neq">neq</option>
                          <option value="in">in</option>
                          <option value="not_in">not_in</option>
                          <option value="gte">gte</option>
                          <option value="lte">lte</option>
                          <option value="exists">exists</option>
                        </select>
                        <input
                          type="text"
                          placeholder="value"
                          value={cond.value}
                          onChange={(e) => updateCondition(ri, ci, { value: e.target.value })}
                          className="flex-1 border border-border rounded px-2 py-1 text-xs bg-background text-foreground"
                        />
                        {rule.conditions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeCondition(ri, ci)}
                            className="text-red-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Creating…</>
            ) : (
              <><Plus className="w-4 h-4 mr-1.5" />Create Draft</>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AdminRulesetsPage() {
  const { data: rulesetsData, isLoading, refetch } = useListRulesets();
  const { data: decisionsData } = useListDecisions();
  const { mutate: publishRuleset, isPending: publishing } = usePublishRuleset({
    mutation: { onSuccess: () => refetch() },
  });
  const { mutate: runTests, isPending: testingRunning, data: testResults } = useRunRegressionTest();

  const [testingRulesetId, setTestingRulesetId] = useState<number | null>(null);

  const rulesets = rulesetsData?.rulesets ?? [];
  const decisions = decisionsData?.decisions ?? [];

  const handlePublish = (id: number) => {
    if (confirm("Are you sure you want to publish this ruleset? It will become the active ruleset for evaluations.")) {
      publishRuleset({ id });
    }
  };

  const handleRunTests = (id: number) => {
    setTestingRulesetId(id);
    runTests({
      id,
      data: { cases: SAMPLE_REGRESSION_CASES },
    });
  };

  const reviewFlagged = decisions.filter((d) => d.reviewFlagged).length;
  const totalDecisions = decisions.length;
  const eligibleCount = decisions.filter((d) => d.outcome === "eligible").length;

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">Ruleset Management</h1>
              <p className="text-muted-foreground mt-2">
                Manage regulatory rulesets for GMC, NMC, and HCPC eligibility evaluations.
              </p>
            </div>
            <CreateDraftRulesetForm onCreated={refetch} />
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{rulesets.filter((r) => r.status === "published").length}</p>
                <p className="text-xs text-muted-foreground">Published Rulesets</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{totalDecisions}</p>
                <p className="text-xs text-muted-foreground">Total Decisions ({eligibleCount} eligible)</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{reviewFlagged}</p>
                <p className="text-xs text-muted-foreground">Flagged for Review</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display font-semibold text-foreground">Active Rulesets</h2>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Refresh
              </Button>
            </div>

            {isLoading ? (
              <Card className="p-10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </Card>
            ) : rulesets.length === 0 ? (
              <Card className="p-10 text-center">
                <Shield className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No rulesets found.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {rulesets.map((ruleset) => (
                  <RulesetCard
                    key={ruleset.id}
                    ruleset={ruleset}
                    onPublish={handlePublish}
                    onRunTests={handleRunTests}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">Regression Tests</h3>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                Click "Run Tests" on any ruleset to validate it against {SAMPLE_REGRESSION_CASES.length} sample
                profiles before publishing.
              </p>

              {testingRunning && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running regression tests…
                </div>
              )}

              {testResults && !testingRunning && (
                <div>
                  <div
                    className={`flex items-center gap-2 p-3 rounded-xl mb-4 ${
                      testResults.failed === 0
                        ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                        : "bg-red-50 border border-red-200 text-red-800"
                    }`}
                  >
                    {testResults.failed === 0 ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    <span className="text-sm font-semibold">
                      {testResults.passed}/{testResults.totalCases} tests passed
                    </span>
                  </div>
                  <RegressionTestResults results={testResults.results} />
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">Recent Decisions</h3>
              {decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {decisions.slice(0, 10).map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        {d.reviewFlagged && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                        <span className="text-muted-foreground font-mono text-xs">
                          {d.userId.slice(0, 8)}…
                        </span>
                      </div>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          d.outcome === "eligible"
                            ? "bg-emerald-100 text-emerald-700"
                            : d.outcome === "ineligible"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {d.outcome.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
