import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui-enhanced";
import { Shield, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

export default function LandingPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="JOBSAGE Background" 
          className="w-full h-full object-cover opacity-60 mix-blend-multiply"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
      </div>

      <header className="relative z-10 p-6 md:p-10 flex justify-between items-center max-w-7xl mx-auto w-full">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <Shield className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-extrabold text-primary tracking-tight">JOBSAGE</h1>
        </div>
        <Button variant="outline" onClick={login} className="border-primary/20 bg-white/50 backdrop-blur-sm">
          Sign In
        </Button>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="max-w-3xl text-center"
        >
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-accent/10 text-accent font-semibold text-sm mb-8 border border-accent/20 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-accent mr-2 animate-pulse" />
            Decision Intelligence for Healthcare Professionals
          </div>
          <h2 className="text-5xl md:text-7xl font-display font-extrabold text-foreground leading-tight tracking-tight mb-6">
            Determine your <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">legal eligibility</span> before you apply.
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            The intelligent platform for UK healthcare and academic professionals. Evaluate regulatory requirements, visa feasibility, and discover clear remediation pathways.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" onClick={login} className="w-full sm:w-auto text-lg px-10">
              Get Started
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
