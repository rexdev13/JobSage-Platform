/**
 * JOBSAGE design tokens, mirrored from the website's CSS variables
 * (artifacts/jobsage-web/src/index.css) as literal values since the
 * extension UI renders inside arbitrary host pages / a shadow root.
 */
export const BRAND = {
  bg: "#FDFCFB", // warm white — hsl(30 20% 99%)
  surface: "#FFFFFF",
  border: "#E8E0DE", // hsl(12 18% 89%)
  primary: "#952323", // brownish-red — hsl(0 62% 36%)
  primaryHover: "#7C1D1D", // hsl(0 62% 30%)
  primaryDisabled: "#CD9B9B",
  primarySoft: "#F2E7E4", // hsl(12 30% 93%)
  primarySoftActive: "#F7ECEA",
  text: "#1C1917", // warm near-black — hsl(20 10% 10%)
  textMuted: "#847A75", // hsl(20 8% 48%)
  inputBg: "#F5F3F0", // hsl(30 15% 95%)
  successBg: "#F0FDF4",
  successBorder: "#86EFAC",
  successText: "#15803D",
  errorBg: "#FEF2F2",
  errorText: "#DC2626",
  radius: 12, // 0.75rem website radius
  radiusSm: 10,
  fontDisplay:
    "'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSans:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export const FONTS_STYLESHEET_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap";

/**
 * Load the Outfit/Inter webfonts into the host document. @font-face rules are
 * document-scoped, so fonts loaded here are usable by text inside our shadow
 * root. If the host page's CSP blocks the stylesheet, the font stacks above
 * quietly fall back to system fonts.
 */
export function ensureBrandFonts(doc: Document = document): void {
  const id = "jobsage-brand-fonts";
  if (doc.getElementById(id)) return;
  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = FONTS_STYLESHEET_URL;
  (doc.head ?? doc.documentElement).appendChild(link);
}
