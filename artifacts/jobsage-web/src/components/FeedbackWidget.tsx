import { useState } from "react";
import { useForm } from "react-hook-form";
import { Lightbulb, LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import { useAuth } from "@workspace/auth-web";
import { useSubmitFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

type FeedbackCategory = "issue" | "idea" | "general";

const categoryOptions: Array<{ value: FeedbackCategory; label: string; description: string }> = [
  { value: "issue", label: "Report an issue", description: "Something is not working as expected." },
  { value: "idea", label: "Share an idea", description: "Suggest a useful improvement." },
  { value: "general", label: "General feedback", description: "Tell us what you think." },
];

interface FeedbackFormValues {
  category: FeedbackCategory;
  message: string;
  email: string;
}

function FeedbackWidgetForm({ onClose, allowEmail }: { onClose: () => void; allowEmail: boolean }) {
  const { toast } = useToast();
  const submitFeedback = useSubmitFeedback();
  const form = useForm<FeedbackFormValues>({
    defaultValues: { category: "general", message: "", email: "" },
  });

  function resetAndClose() {
    form.reset();
    onClose();
  }

  function handleSubmit(values: FeedbackFormValues) {
    const currentPage = new URL(window.location.href);
    const pageUrl = `${currentPage.origin}${currentPage.pathname}`;
    const screenResolution = `${window.screen.width}x${window.screen.height}`;
    submitFeedback.mutate(
      {
        data: {
          category: values.category,
          message: values.message.trim(),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          pageUrl,
          screenResolution,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Thanks for your feedback",
            description: "Your note has been sent to the JOBSAGE team.",
          });
          resetAndClose();
        },
        onError: () => {
          toast({
            title: "Feedback could not be sent",
            description: "Please try again in a moment.",
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <div className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-primary/15 bg-background shadow-2xl shadow-primary/10">
      <div className="flex items-start justify-between border-b border-border/70 bg-primary/[0.04] px-5 py-4">
        <div>
          <p className="font-display text-base font-semibold text-foreground">Help us make JOBSAGE better</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">A quick note is enough. We read every response.</p>
        </div>
        <button
          type="button"
          data-testid="button-close-feedback"
          aria-label="Close feedback"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 p-5">
          <FormField
            control={form.control}
            name="category"
            rules={{ required: "Choose a feedback category." }}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="feedback-category-issue" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  What would you like to share?
                </FormLabel>
                <FormControl>
                  <div className="space-y-2" role="radiogroup" aria-label="Feedback category">
                    {categoryOptions.map((option, index) => (
                      <label
                        key={option.value}
                        htmlFor={`feedback-category-${option.value}`}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                          field.value === option.value ? "border-primary/40 bg-primary/[0.06]" : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <input
                          ref={index === 0 ? field.ref : undefined}
                          id={`feedback-category-${option.value}`}
                          type="radio"
                          name={field.name}
                          value={option.value}
                          checked={field.value === option.value}
                          onBlur={field.onBlur}
                          onChange={() => field.onChange(option.value)}
                          data-testid={`input-feedback-category-${option.value}`}
                          className="mt-0.5 accent-primary"
                        />
                        <span>
                          <span className="block text-sm font-medium text-foreground">{option.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="message"
            rules={{
              validate: (value) => value.trim().length > 0 || "Please enter a message.",
              maxLength: { value: 5000, message: "Keep your message under 5,000 characters." },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your message</FormLabel>
                <FormControl>
                  <textarea
                    {...field}
                    data-testid="input-feedback-message"
                    required
                    maxLength={5000}
                    rows={4}
                    placeholder="What happened, or what would you like to see?"
                    className="field-support min-h-24 resize-y"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {allowEmail && (
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Email <span className="font-normal normal-case tracking-normal text-muted-foreground/80">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <input
                      {...field}
                      type="email"
                      maxLength={254}
                      data-testid="input-feedback-email"
                      placeholder="you@example.com"
                      className="field-support"
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] leading-relaxed">Leave your email if you would like a reply.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <Button type="submit" data-testid="button-submit-feedback" disabled={!form.watch("message").trim() || submitFeedback.isPending} className="w-full">
            {submitFeedback.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitFeedback.isPending ? "Sending…" : "Send feedback"}
          </Button>
        </form>
      </Form>
    </div>
  );
}

export function FeedbackWidget({ forceVisible = false }: { forceVisible?: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [open, setOpen] = useState(false);

  if (!forceVisible && (isLoading || isAuthenticated)) return null;

  return (
    <div className={`fixed right-5 z-[70] flex flex-col items-end gap-3 sm:right-6 ${forceVisible ? "bottom-20 sm:bottom-20" : "bottom-5 sm:bottom-6"}`}>
      {open && <FeedbackWidgetForm onClose={() => setOpen(false)} allowEmail={!forceVisible && !isAuthenticated} />}
      {!open && (
        <button
          type="button"
          data-testid="button-open-feedback"
          aria-label="Share feedback"
          onClick={() => setOpen(true)}
          className="group inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Feedback</span>
          <Lightbulb className="h-3.5 w-3.5 opacity-70 transition-transform group-hover:rotate-12" />
        </button>
      )}
    </div>
  );
}