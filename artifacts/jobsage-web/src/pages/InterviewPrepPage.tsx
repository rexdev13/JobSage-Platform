import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import { useGetInterviewPrepQuestions } from "@workspace/api-client-react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  MessageSquare,
  Lightbulb,
  RefreshCw,
  Search,
} from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

const CATEGORY_COLORS: Record<string, string> = {
  "Values-based": "border-l-purple-400 bg-purple-50/30",
  "Clinical": "border-l-blue-400 bg-blue-50/30",
  "Situational": "border-l-amber-400 bg-amber-50/30",
  "Leadership": "border-l-green-400 bg-green-50/30",
  "Career": "border-l-rose-400 bg-rose-50/30",
};

function getCategoryColor(category: string): string {
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (category.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "border-l-primary/40 bg-primary/5";
}

function QuestionBankCard({ category, questions, index }: { category: string; questions: string[]; index: number }) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
    >
      <Card className={`border-l-4 ${getCategoryColor(category)} overflow-hidden`}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-foreground">{category}</span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {questions.length} questions
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-0 space-y-2.5">
            {questions.map((q, qi) => (
              <div key={qi} className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {qi + 1}
                </span>
                <p className="text-sm text-foreground leading-relaxed">{q}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function StructuredGuide({ guide }: {
  guide: { title: string; description: string; tips: string[] };
}) {
  return (
    <Card className="p-5 border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground text-sm">{guide.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{guide.description}</p>
        </div>
      </div>
      <div className="space-y-2 mt-3">
        {guide.tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-foreground leading-relaxed">{tip}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NhsAdviceCard({ advice }: { advice: string[] }) {
  return (
    <Card className="p-5 border-amber-200 bg-amber-50/30">
      <h3 className="font-semibold text-sm text-amber-900 mb-3 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-600" />
        NHS-Specific Advice
      </h3>
      <div className="space-y-2.5">
        {advice.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs">
            <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 font-bold flex items-center justify-center shrink-0 mt-0.5 text-[10px]">
              {i + 1}
            </span>
            <p className="text-amber-900 leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function InterviewPrepPage() {
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [activeSpecialty, setActiveSpecialty] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, refetch, isFetching } = useGetInterviewPrepQuestions(
    activeSpecialty ? { specialty: activeSpecialty } : {},
  );

  function handleSpecialtySearch() {
    const trimmed = specialtyInput.trim();
    if (trimmed) {
      setActiveSpecialty(trimmed);
    } else {
      setActiveSpecialty(undefined);
    }
    void refetch();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSpecialtySearch();
    }
  }

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-violet-500" />
              Interview Prep
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              AI-generated interview questions and NHS guidance tailored to your profession and specialty.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5 shrink-0"
          >
            {isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Regenerate
          </Button>
        </div>

        {/* Specialty selector */}
        <Card className="p-4 border-primary/15 bg-primary/3">
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-primary" />
            Generate questions for a different specialty
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={specialtyInput}
              onChange={(e) => setSpecialtyInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`e.g. Cardiology, General Practice, Paediatrics…`}
              className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button
              size="sm"
              onClick={handleSpecialtySearch}
              disabled={isFetching}
              className="gap-1.5 shrink-0"
            >
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Search
            </Button>
            {activeSpecialty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActiveSpecialty(undefined);
                  setSpecialtyInput("");
                  void refetch();
                }}
                className="shrink-0 text-xs"
              >
                Reset
              </Button>
            )}
          </div>
          {activeSpecialty && (
            <p className="text-xs text-primary mt-2">
              Showing questions for: <span className="font-semibold">{activeSpecialty}</span>
            </p>
          )}
        </Card>

        {isLoading && (
          <Card className="p-12 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-sm font-medium text-foreground mb-1">Generating your personalised questions…</p>
            <p className="text-xs text-muted-foreground">Using AI to tailor content to your profession and specialty</p>
          </Card>
        )}

        {isError && (
          <Card className="p-8 text-center border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">Could not load questions</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Please ensure your profile is complete and try again.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </Card>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Header badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                {data.profession}
              </span>
              {data.specialty && data.specialty !== "General" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-accent/10 text-accent">
                  {data.specialty}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {data.questionBanks.reduce((sum: number, b: { questions: string[] }) => sum + b.questions.length, 0)} questions across {data.questionBanks.length} categories
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-sm font-semibold text-foreground">Question Banks</h2>
                {data.questionBanks.map((bank: { category: string; questions: string[] }, i: number) => (
                  <QuestionBankCard
                    key={i}
                    category={bank.category}
                    questions={bank.questions}
                    index={i}
                  />
                ))}
              </div>

              <div className="space-y-4">
                <StructuredGuide guide={data.structuredInterviewGuide} />
                <NhsAdviceCard advice={data.nhsSpecificAdvice} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center py-2 border-t border-border/50">
              {data.disclaimer}
            </p>
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}
