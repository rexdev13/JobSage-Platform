# Live website verification — selected 100-candidate pilot

**Generated:** 2026-09-27T08:48:59.324Z  
**Input:** `artifacts/non-healthcare-company-websites-verification-pilot-100.csv`

## Results

- Total processed: **100**
- Domains checked: **100**
- HTTP requests made: **407**
- Cache hits: **202** (robots cache: 202; page-response cache: 0)
- Upgraded to high: **40**
- Stayed medium: **59**
- Rejected: **0**
- Inconclusive: **1**
- Rows with at least one blocked/timeout request: **2**
- Rows with a timeout signal: **0**
- Successful pages checked: **282**
- Page URLs attempted: **288** (maximum 5 per domain, including homepage; blocked attempts count toward the cap)

HTTP request count includes page requests, robots.txt requests, and each same-site redirect hop. No retries or search requests were made.

## Status counts

| Verification status | New confidence | Sponsor rows |
|---|---|---:|
| upgraded | high | 40 |
| kept_medium | medium | 59 |
| rejected | none | 0 |
| inconclusive | original confidence retained | 1 |

## Examples of upgraded candidates

- **17CARE UK LTD** (17care.co.uk) — Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals. Evidence: https://17care.co.uk/, https://17care.co.uk/about-clinic/, https://17care.co.uk/contact/
- **2020 Innovation Training Limited** (2020innovation.com) — Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals. Evidence: https://www.2020innovation.com/, https://www.2020innovation.com/about, https://www.2020innovation.com/contact
- **3pX Group** (3px.group) — Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals. Evidence: https://www.3px.group/, https://www.3px.group/join-us, https://www.3px.group/contact-us
- **A212 Electric and Gas Ltd** (a212electricandgas.co.uk) — Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals. Evidence: https://www.a212electricandgas.co.uk/, https://www.a212electricandgas.co.uk/about-us
- **A2Z Cloud Ltd.** (a2zcloud.com) — Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals. Evidence: https://a2zcloud.com/, https://a2zcloud.com/about-us/, https://a2zcloud.com/contact/

## Examples of rejected candidates

None in this pilot.

## Verification scope and safety

- Only the selected pilot CSV was read as source data.
- Each candidate homepage was fetched from its listed URL. Additional pages were selected only from same-site About, Contact, or Careers/Jobs/Vacancies links found on that homepage.
- No search engine, domain guessing, external ATS, database, or production import was used.
- The controlled public-site fetcher enforced HTTPS, public-DNS checks, robots policy, same-site redirect boundaries, response-size limits, timeouts, and per-host pacing.
- Page cap: **5 per domain**, including the homepage. This pass selected at most one linked page in each of the About, Contact, and Careers categories.
- No retries were made; blocked, unsafe, and timeout outcomes remain inconclusive unless other fetched first-party pages independently established identity.

## Is this reliable enough to run on all 2,395 candidates?

**No—not on this pilot alone.** The pilot was deliberately biased toward strong medium-confidence candidates and contained no low-confidence candidates, so it does not estimate performance across the full set. Review the evidence for upgrades and rejects, resolve inconclusive cases, and test a separate representative sample before applying this process to all 2,395 rows.

## Data and deployment confirmation

- Production data changed: **No**
- Import performed: **No**
- Deployment performed: **No**

### Row status ledger

| Verification status | New confidence | Sponsor ID |
|---|---|---:|
| upgraded | high | 154699 |
| upgraded | high | 154816 |
| upgraded | high | 155108 |
| kept_medium | medium | 156078 |
| upgraded | high | 156135 |
| upgraded | high | 156155 |
| kept_medium | medium | 156659 |
| kept_medium | medium | 156542 |
| kept_medium | medium | 156967 |
| kept_medium | medium | 157517 |
| kept_medium | medium | 157542 |
| kept_medium | medium | 155484 |
| upgraded | high | 157672 |
| kept_medium | medium | 157691 |
| kept_medium | medium | 157894 |
| upgraded | high | 158003 |
| kept_medium | medium | 154987 |
| kept_medium | medium | 158238 |
| upgraded | high | 158335 |
| kept_medium | medium | 158363 |
| kept_medium | medium | 154085 |
| kept_medium | medium | 171872 |
| kept_medium | medium | 172134 |
| upgraded | high | 172792 |
| kept_medium | medium | 155413 |
| upgraded | high | 155148 |
| upgraded | high | 154632 |
| kept_medium | medium | 155088 |
| upgraded | high | 154950 |
| kept_medium | medium | 156755 |
| kept_medium | medium | 156927 |
| kept_medium | medium | 157455 |
| upgraded | high | 157512 |
| kept_medium | medium | 158122 |
| kept_medium | medium | 158308 |
| upgraded | high | 155783 |
| upgraded | high | 172625 |
| upgraded | high | 154834 |
| kept_medium | medium | 154617 |
| kept_medium | medium | 154618 |
| upgraded | high | 154663 |
| kept_medium | medium | 154604 |
| kept_medium | medium | 154707 |
| upgraded | high | 154846 |
| upgraded | high | 154845 |
| kept_medium | medium | 154861 |
| kept_medium | medium | 154895 |
| kept_medium | medium | 154923 |
| inconclusive | medium | 154925 |
| kept_medium | medium | 154957 |
| kept_medium | medium | 154956 |
| kept_medium | medium | 154966 |
| upgraded | high | 154969 |
| kept_medium | medium | 155002 |
| upgraded | high | 155029 |
| upgraded | high | 155075 |
| kept_medium | medium | 155083 |
| upgraded | high | 155138 |
| upgraded | high | 155228 |
| kept_medium | medium | 155230 |
| upgraded | high | 155289 |
| upgraded | high | 155297 |
| kept_medium | medium | 155253 |
| upgraded | high | 155262 |
| kept_medium | medium | 155311 |
| upgraded | high | 155362 |
| kept_medium | medium | 155392 |
| upgraded | high | 155395 |
| upgraded | high | 155433 |
| kept_medium | medium | 155931 |
| kept_medium | medium | 156125 |
| kept_medium | medium | 156108 |
| kept_medium | medium | 156119 |
| upgraded | high | 156141 |
| kept_medium | medium | 156318 |
| kept_medium | medium | 156528 |
| kept_medium | medium | 156578 |
| kept_medium | medium | 156621 |
| kept_medium | medium | 156881 |
| kept_medium | medium | 156564 |
| kept_medium | medium | 158383 |
| kept_medium | medium | 157465 |
| kept_medium | medium | 157445 |
| kept_medium | medium | 157498 |
| kept_medium | medium | 157476 |
| kept_medium | medium | 157698 |
| upgraded | high | 157703 |
| upgraded | high | 157952 |
| upgraded | high | 158032 |
| kept_medium | medium | 158045 |
| upgraded | high | 158077 |
| upgraded | high | 158183 |
| kept_medium | medium | 158280 |
| kept_medium | medium | 158292 |
| kept_medium | medium | 158321 |
| upgraded | high | 158347 |
| upgraded | high | 158427 |
| upgraded | high | 158510 |
| kept_medium | medium | 157311 |
| upgraded | high | 155654 |
