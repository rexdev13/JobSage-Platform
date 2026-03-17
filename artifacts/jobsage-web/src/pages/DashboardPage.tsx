import { useAuth } from "@workspace/replit-auth-web";
import { useGetMyProfile } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { Activity, FileText, ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useGetMyProfile();

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground">
            Welcome back, {user?.firstName || 'Candidate'}
          </h1>
          <p className="text-muted-foreground mt-2">
            Here is your professional intelligence overview.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Action Card */}
          <Card className="lg:col-span-2 p-8 bg-gradient-to-br from-primary to-primary/90 text-primary-foreground border-0">
            <div className="flex items-start justify-between">
              <div>
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold mb-4 backdrop-blur-md">
                  <Activity className="w-3 h-3 mr-2" />
                  Action Required
                </div>
                <h2 className="text-2xl font-bold mb-3">Eligibility Evaluation</h2>
                <p className="text-primary-foreground/80 mb-8 max-w-md leading-relaxed">
                  Run your profile against the latest regulatory criteria to determine your eligibility status and get a personalized remediation plan.
                </p>
                <Link href="/eligibility" className="inline-flex">
                  <Button variant="accent" size="lg" className="shadow-lg shadow-accent/20">
                    Run Check Now <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
              <ShieldCheck className="w-32 h-32 text-white/10 hidden md:block" />
            </div>
          </Card>

          {/* Profile Summary Card */}
          <Card className="p-6 flex flex-col">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mr-3">
                <FileText className="w-4 h-4" />
              </span>
              Profile Snapshot
            </h3>
            
            <div className="space-y-4 flex-1">
              <div>
                <p className="text-sm text-muted-foreground">Profession</p>
                <p className="font-medium capitalize">{profile?.profession?.replace(/_/g, ' ') || 'Not set'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Registration</p>
                <p className="font-medium capitalize">{profile?.registrationStatus?.replace(/_/g, ' ') || 'Not set'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Experience</p>
                <p className="font-medium">{profile?.experienceYears ? `${profile.experienceYears} Years` : 'Not set'}</p>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <Link href="/profile" className="inline-flex w-full">
                <Button variant="outline" className="w-full">Update Profile</Button>
              </Link>
            </div>
          </Card>
        </div>

      </PageTransition>
    </AppLayout>
  );
}
