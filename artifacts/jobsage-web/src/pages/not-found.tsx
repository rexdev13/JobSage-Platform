import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition, Card, Button } from "@/components/ui-enhanced";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <AppLayout>
      <PageTransition className="flex items-center justify-center min-h-[80vh]">
        <Card className="max-w-md p-10 text-center shadow-lg">
          <h1 className="text-6xl font-display font-extrabold text-muted mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-foreground mb-3">Page Not Found</h2>
          <p className="text-muted-foreground mb-8">The page you are looking for doesn't exist or has been moved.</p>
          <Link href="/" className="inline-flex">
            <Button>Return to Dashboard</Button>
          </Link>
        </Card>
      </PageTransition>
    </AppLayout>
  );
}
