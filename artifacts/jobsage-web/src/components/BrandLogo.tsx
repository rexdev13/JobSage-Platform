import { cn } from "@/lib/utils";

export const BRAND_TAGLINE = "Find work that moves you.";

const WORDMARK_SRC = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}jobsage-wordmark.webp`;

/**
 * Sizes are wordmark heights. The wordmark artwork is 1440x207 (~6.96:1),
 * so width is derived from height via the intrinsic aspect ratio.
 * xs: 20px tall (~139px wide)  sm: 24px (~167px)  md: 28px (~195px)
 * lg: 36px (~250px)  hero: 48px mobile / 64px desktop (~334 / ~445px)
 */
const SIZES = {
  xs: { mark: "h-5", tag: "text-[12px] mt-1" },
  sm: { mark: "h-6", tag: "text-[12px] mt-1" },
  md: { mark: "h-7", tag: "text-[13px] mt-1" },
  lg: { mark: "h-9", tag: "text-sm mt-1.5" },
  hero: { mark: "h-12 md:h-16", tag: "text-base md:text-lg mt-2 md:mt-3" },
} as const;

export type BrandLogoSize = keyof typeof SIZES;

type Props = {
  size?: BrandLogoSize;
  /** "light" = on light surfaces (dark gray tagline). "dark" = on dark surfaces (light tagline on a subtle light plate behind the wordmark). */
  tone?: "light" | "dark";
  align?: "start" | "center";
  showTagline?: boolean;
  className?: string;
};

/**
 * Non-interactive brand lockup. Wrap in an existing Link/button where it should
 * navigate home and give that wrapper an aria-label such as "JOBSAGE home".
 */
export function BrandLogo({ size = "md", tone = "light", align = "start", showTagline = true, className }: Props) {
  const s = SIZES[size];
  const mark = (
    <img
      src={WORDMARK_SRC}
      alt="JOBSAGE"
      width={1440}
      height={207}
      draggable={false}
      className={cn(s.mark, "w-auto max-w-full select-none object-contain")}
    />
  );
  return (
    <span
      data-testid="brand-logo"
      className={cn("inline-flex min-w-0 flex-col leading-none", align === "center" ? "items-center text-center" : "items-start text-left", className)}
    >
      {tone === "dark" ? <span className="inline-flex rounded-lg bg-[hsl(30_20%_98%)] px-2.5 py-1.5">{mark}</span> : mark}
      {showTagline && (
        <span
          className={cn(
            s.tag,
            "whitespace-nowrap font-medium tracking-[0.01em] leading-tight",
            tone === "dark" ? "text-slate-100" : "text-[hsl(20_8%_30%)]",
          )}
        >
          {BRAND_TAGLINE}
        </span>
      )}
    </span>
  );
}
