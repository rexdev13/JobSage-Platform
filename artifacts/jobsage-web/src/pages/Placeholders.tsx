import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition, Card } from "@/components/ui-enhanced";
import { Construction, Sparkles, Users, Shield, ClipboardCheck } from "lucide-react";

function PlaceholderView({ title, description, icon: Icon }: { title: string; description: string; icon: React.ElementType }) {
  return (
    <AppLayout>
      <PageTransition className="flex items-center justify-center min-h-[80vh]">
        <Card className="max-w-md p-10 text-center shadow-lg border-primary/10">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Icon className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-3">{title}</h2>
          <p className="text-muted-foreground leading-relaxed">{description}</p>
          <div className="mt-8 inline-flex items-center px-4 py-2 rounded-full bg-accent/10 text-accent font-semibold text-sm">
            <Sparkles className="w-4 h-4 mr-2" /> Coming in next milestone
          </div>
        </Card>
      </PageTransition>
    </AppLayout>
  );
}

export function EligibilityPage() {
  return <PlaceholderView 
    title="Eligibility Intelligence" 
    description="The core rules engine is being calibrated. Soon, you'll be able to run your profile against live UK regulatory requirements to get deterministic eligibility outcomes."
    icon={ClipboardCheck}
  />;
}

export function PathPage() {
  return <PlaceholderView 
    title="My Remediation Path" 
    description="Your structured, AI-assisted action plan for achieving eligibility will appear here, complete with timeline and cost estimates."
    icon={Construction}
  />;
}

export function ReviewQueuePage() {
  return <PlaceholderView 
    title="Human Review Queue" 
    description="The console for clinical reviewers to process flagged edge cases, annotate profiles, and provide expert pathway guidance."
    icon={Users}
  />;
}

export function AdminRolesPage() {
  return <PlaceholderView 
    title="Role Catalogue Management" 
    description="Admin tools for importing and managing the opportunity catalogue via CSV, and defining sponsorship constraints."
    icon={Shield}
  />;
}

export function AdminAuditPage() {
  return <PlaceholderView 
    title="Compliance & Audit Logs" 
    description="Immutable audit trails of every decision record, ruleset version, and consent capture for full regulatory compliance."
    icon={Shield}
  />;
}
