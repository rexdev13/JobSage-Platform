import { useState } from "react";
import { HelpCircle, MessageCircle, Sparkles, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { FeedbackWidget } from "@/components/FeedbackWidget";

interface QuickHelpMenuProps {
  guestOnly?: boolean;
  onOpenReadiness?: () => void;
}

export function QuickHelpMenu({ guestOnly = false, onOpenReadiness }: QuickHelpMenuProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  if (isLoading || (guestOnly && isAuthenticated)) return null;

  const canOpenReadiness = Boolean(onOpenReadiness && user?.role === "candidate");

  function shareFeedback() {
    setMenuOpen(false);
    setFeedbackOpen(true);
  }

  function openReadiness() {
    setMenuOpen(false);
    onOpenReadiness?.();
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
        {menuOpen && (
          <div
            className="z-50 w-56 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-background p-2 shadow-xl duration-150"
            role="menu"
            aria-label="Quick help options"
            data-testid="menu-quick-help"
          >
            <Link
              href="/help"
              role="menuitem"
              data-testid="link-quick-help-center"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HelpCircle className="h-4 w-4 text-primary" />
              Help &amp; Support
            </Link>
            <button
              type="button"
              role="menuitem"
              data-testid="button-quick-share-feedback"
              onClick={shareFeedback}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageCircle className="h-4 w-4 text-primary" />
              Share Feedback
            </button>
            {canOpenReadiness && (
              <button
                type="button"
                role="menuitem"
                data-testid="button-quick-readiness"
                onClick={openReadiness}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sparkles className="h-4 w-4 text-primary" />
                Readiness quota
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          data-testid="button-floating-help"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={menuOpen ? "Close quick help" : "Open quick help"}
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
        </button>
      </div>
      <FeedbackWidget
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        allowEmail={!isAuthenticated}
      />
    </>
  );
}