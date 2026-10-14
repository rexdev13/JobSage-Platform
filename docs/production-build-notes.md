# Production build notes

## Web bundle diagnostics

The production Vite build completed successfully on 14 October 2026. It reported
three non-fatal source-map lookup warnings while processing the Radix-based
`select`, `label`, and `sheet` UI adapters. The build emitted no `.map` files;
the warnings affect source-location diagnostics, not build completion.

Vite also reported its default 500 kB chunk-size warning for the main app chunk
(571.31 kB minified, 176.32 kB gzip). The largest chart-related chunk was
Recharts' `generateCategoricalChart` (377.24 kB minified, 104.00 kB gzip).
Application routes are already lazy-loaded, and the chart code is in its own
chunk. These sizes do not justify raising the warning threshold or adding
blanket chunk rules; monitor them in future production builds and split further
if the compressed initial payload grows materially.
