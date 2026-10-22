# JOBSAGE logo guidelines (web)

## Approved master and existing mobile surfaces
The owner supplied this artwork as the new JOBSAGE identity. Preserve its original orange-to-burgundy lettering and the exact tagline **Find work that moves you.**

The untouched 8000×2267 PNG is retained in private App Storage:
`gs://replit-objstore-3694d154-80c4-44e1-a65d-b87607e9f95e/.private/brand/jobsage/logo-master-2026-10-21.png`.
Deploy optimized transparent derivatives instead of the large master.

The native sign-in uses the same cropped lettering with a separate readable 14px tagline. The native workspace loading state also uses the supplied wordmark with a separately rendered tagline, on a white surface without a spinner. Keep the existing JOBSAGE J app mark; do not invent or substitute a new logo. Android uses that existing mark in the adaptive icon and the supplied JOBSAGE wordmark on the native splash. iOS has a plain white launch surface. These native asset changes require a subsequent native app build; they do not update an already installed binary.

The web social image uses the full supplied lockup on a plain light 1200×630 canvas. Website browser favicons retain the supplied J with clear space. The previously packaged Chrome extension is unchanged by this mobile branding update.

Source artwork: `attached_assets/image_1792588865787.png`. Web assets: `public/jobsage-wordmark.webp` (1440x207 wordmark, used in UI) and `public/logo.png` (full lockup, 1600x351, social/legacy use).

## Purpose
One reusable component, `src/components/BrandLogo.tsx`, renders the wordmark image plus a live text tagline: **Find work that moves you.** The tagline is HTML text (not baked into the image) so it stays readable, translatable and accessible.

## Research
- NN/g, left-aligned home logos: https://www.nngroup.com/articles/centered-logos/ - logo sits top-left in nav/sidebars and links home.
- W3C WCAG 2.2 contrast minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html - tagline meets 4.5:1 (hsl(20 8% 30%) on light surfaces; slate-100 on dark).
- W3C functional images: https://www.w3.org/WAI/tutorials/images/functional/ - logo links/buttons carry `aria-label="JOBSAGE home"`.

## Sizes (wordmark height, intrinsic ratio ~6.96:1, never stretched or filtered)
| Variant | Height | Approx width | Tagline | Used in |
|---|---|---|---|---|
| xs | 20px | 139px | 12px | Mobile app header (fits 320px with menu button) |
| sm | 24px | 167px | 12px | Help, Get Started, Release Notes, Onboarding, landing footer |
| md | 28px | 195px | 13px | Landing nav (72px bar), sidebar (256px, 72px header), auth pages |
| lg | 36px | 250px | 14px | Consent page (centred) |
| hero | 48 / 64px | 334 / 445px | 16 / 18px | Landing hero (centred) |

## Clearspace and surfaces
- Minimum clearspace on all sides = wordmark height x 0.5. No other elements inside that area.
- Never apply brightness/drop-shadow/recolour filters to the artwork.
- On dark surfaces use `tone="dark"`: the wordmark sits on a quiet off-white plate (8px radius) and the tagline turns light.
- Interactive wrappers show a 2px focus ring with 2px offset. Do not nest links/buttons inside the logo.
