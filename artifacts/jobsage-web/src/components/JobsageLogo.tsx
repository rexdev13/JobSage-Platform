/**
 * Canonical JOBSAGE logo image.
 *
 * Use `variant="inverted"` on dark backgrounds (e.g. footer) to render
 * the wordmark in white via a CSS brightness+invert filter.
 */
interface JobsageLogoProps {
  /** Tailwind height class, e.g. "h-8", "h-10". Defaults to "h-9". */
  className?: string;
  /** "default" = full-colour logo; "inverted" = white logo for dark backgrounds. */
  variant?: "default" | "inverted";
}

export default function JobsageLogo({ className = "h-9", variant = "default" }: JobsageLogoProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.png`}
      alt="JOBSAGE"
      className={`w-auto object-contain ${variant === "inverted" ? "brightness-0 invert" : ""} ${className}`}
    />
  );
}
