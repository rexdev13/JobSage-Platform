import { useState } from "react";
import { Link } from "wouter";
import { MessageSquareText } from "lucide-react";
import { useAuth } from "@workspace/auth-web";
import { AppLayout } from "@/components/layout/AppLayout";
import { FeedbackForm } from "@/components/FeedbackWidget";
import { Card } from "@/components/ui/card";
import { ProductFeedbackInbox } from "@/pages/admin/AdminFeedbackTab";
import AdminDescriptionFeedbackTab from "@/pages/admin/AdminDescriptionFeedbackTab";
import AdminSupportTicketsTab from "@/pages/admin/AdminSupportTicketsTab";

type AdminInboxTab = "product-feedback" | "contact-support" | "ai-ratings";

export default function FeedbackPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  return (
    <AppLayout>
      {isAdmin ? <AdminFeedbackInbox /> : <FeedbackSubmissionPage isSignedIn={!!user} />}
    </AppLayout>
  );
}

function AdminFeedbackInbox() {
  const [activeTab, setActiveTab] = useState<AdminInboxTab>("product-feedback");
  const tabs: Array<{ id: AdminInboxTab; label: string }> = [
    { id: "product-feedback", label: "Product feedback" },
    { id: "contact-support", label: "Contact support" },
    { id: "ai-ratings", label: "AI ratings" },
  ];

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8" aria-labelledby="admin-feedback-page-title">
      <header>
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <MessageSquareText className="h-3.5 w-3.5" />
          Admin inbox
        </div>
        <h1 id="admin-feedback-page-title" className="mt-3 font-display text-2xl font-bold text-foreground">Feedback &amp; support inbox</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review product feedback, Contact Support requests, and employer ratings for AI-generated job descriptions.
        </p>
      </header>

      <div className="mobile-scroll-x flex gap-1 rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="Admin feedback inbox">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`admin-feedback-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`admin-feedback-panel-${tab.id}`}
            data-testid={`button-admin-feedback-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id="admin-feedback-panel-product-feedback"
        role="tabpanel"
        aria-labelledby="admin-feedback-tab-product-feedback"
        hidden={activeTab !== "product-feedback"}
      >
        <ProductFeedbackInbox />
      </div>
      <div
        id="admin-feedback-panel-contact-support"
        role="tabpanel"
        aria-labelledby="admin-feedback-tab-contact-support"
        hidden={activeTab !== "contact-support"}
      >
        <AdminSupportTicketsTab />
      </div>
      <div
        id="admin-feedback-panel-ai-ratings"
        role="tabpanel"
        aria-labelledby="admin-feedback-tab-ai-ratings"
        hidden={activeTab !== "ai-ratings"}
      >
        <AdminDescriptionFeedbackTab />
      </div>
    </section>
  );
}

function FeedbackSubmissionPage({ isSignedIn }: { isSignedIn: boolean }) {
  const [submitted, setSubmitted] = useState(false);

  return (
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
        <FeedbackForm allowEmail={!isSignedIn} onSubmitted={() => setSubmitted(true)} />
      </Card>

      <p className="text-sm text-muted-foreground">
        Need help with your account or application instead?{" "}
        <Link href="/help" className="font-semibold text-primary hover:underline">
          Go to Help &amp; Support
        </Link>
        .
      </p>
    </div>
  );
}