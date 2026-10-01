import { useState } from "react";
import { Link } from "wouter";
import { MessageSquareText } from "lucide-react";
import { useAuth } from "@workspace/auth-web";
import { AppLayout } from "@/components/layout/AppLayout";
import { FeedbackForm } from "@/components/FeedbackWidget";
import { Card } from "@/components/ui/card";

export default function FeedbackPage() {
  const { user } = useAuth();
  const [submitted, setSubmitted] = useState(false);

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <MessageSquareText className="h-3.5 w-3.5" />
            Feedback
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">Help improve JOBSAGE</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Report an issue, share an idea, or tell us what is working well. Your feedback is reviewed separately from support requests.
          </p>
        </header>

        {submitted && (
          <div role="status" data-testid="feedback-page-success" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Thanks — your feedback has been sent to the JOBSAGE team.
          </div>
        )}

        <Card className="overflow-hidden border-border/80">
          <FeedbackForm allowEmail={!user} onSubmitted={() => setSubmitted(true)} />
        </Card>

        <p className="text-sm text-muted-foreground">
          Need help with your account or application instead?{" "}
          <Link href="/help" className="font-semibold text-primary hover:underline">
            Go to Help &amp; Support
          </Link>
          .
        </p>
      </div>
    </AppLayout>
  );
}