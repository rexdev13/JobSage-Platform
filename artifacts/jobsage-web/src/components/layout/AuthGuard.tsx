import { useEffect } from "react";
import { useAuth } from "@workspace/auth-web";
import { useLocation } from "wouter";
import {
  useGetMyConsent,
  useGetMyProfile,
  getGetMyConsentQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";

const PUBLIC_PATHS = ["/login", "/register", "/employer/register", "/forgot-password", "/reset-password", "/"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();

  const {
    data: consentData,
    isLoading: consentLoading,
    error: consentError,
  } = useGetMyConsent({
    query: {
      queryKey: getGetMyConsentQueryKey(),
      enabled: isAuthenticated,
      retry: false,
    },
  });

  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
  } = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: isAuthenticated && consentData?.hasConsented === true,
      retry: false,
    },
  });

  const isPublic = PUBLIC_PATHS.some((p) =>
    p === "/" ? location === "/" : location.startsWith(p)
  );

  const isLoading =
    authLoading ||
    (isAuthenticated && consentLoading) ||
    (isAuthenticated && !!consentData?.hasConsented && profileLoading);

  useEffect(() => {
    if (isLoading || isPublic) return;

    if (!isAuthenticated) {
      if (location !== "/login") setLocation("/login");
      return;
    }

    if (consentData && !consentData.hasConsented && location !== "/consent") {
      setLocation("/consent");
      return;
    }

    if (
      consentData?.hasConsented &&
      profileError &&
      location !== "/onboarding" &&
      user?.role !== "employer"
    ) {
      setLocation("/onboarding");
      return;
    }
  }, [
    isLoading,
    isPublic,
    isAuthenticated,
    consentData,
    profileError,
    location,
    setLocation,
    user,
  ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
        <p className="text-muted-foreground font-medium animate-pulse">
          Loading JOBSAGE...
        </p>
      </div>
    );
  }

  if (!isAuthenticated && !isPublic && location !== "/login") return null;
  if (
    isAuthenticated &&
    consentData &&
    !consentData.hasConsented &&
    location !== "/consent"
  )
    return null;
  if (
    isAuthenticated &&
    consentData?.hasConsented &&
    profileError &&
    location !== "/onboarding" &&
    user?.role !== "employer"
  )
    return null;

  return <>{children}</>;
}
