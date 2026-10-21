# References inside CV & Supporting Documents

## Owner requirement
References belong inside CV & Supporting Documents, not in a separate sidebar destination.

## Approach
- One parent destination with two short local-navigation labels: Documents and References.
- Documents remain the default; references remain directly discoverable near the page heading.
- Use real links and URL-backed views rather than ARIA tab controls for page navigation.
- Keep a direct references URL and redirect the old address so bookmarks still work.
- Load only the selected view. Reuse existing document and reference tools and their data;
  no database migration, duplicated reference records, or API change is needed.
- Use wrapping links, visible focus indicators and `aria-current="page"` for the current view.
- Existing uploaded recommendation-letter files stay in the document catalogue;
  structured reference records retain their own verification status and actions.

## Research
- Nielsen Norman Group, *Tabs, Used Right*: use clear, concise groupings, distinguish
  navigation links from in-page tabs, and clearly indicate selection.
  https://www.nngroup.com/articles/tabs-used-right
- GOV.UK Design System, *Tabs*: related information can be separated into labelled
  sections, but do not use its in-page tabs component for page navigation or load
  so much hidden content that the page becomes slow.
  https://design-system.service.gov.uk/components/tabs/
- W3C ARIA Authoring Practices, *Tabs Pattern*: ARIA tabs carry specific panel and
  arrow-key behavior. These views navigate to URLs, so they use native links instead.
  https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
