---
name: Vacancy sample links
description: Distinguish a usable careers route from an individual sample vacancy URL.
---

Do not populate a sample-vacancy URL with a generic careers or jobs index such as `/jobs/` or `/careers`. These pages can establish a company recruitment route, but only a distinct role-detail URL should be presented as a sample vacancy. A generic job-application form may support a `send_cv` route when its instructions are explicit, but it is not a sample vacancy.

**Why:** Generic URLs such as `/jobs/` and `/job-application-form/` describe a hiring flow, not an open role. Treating either as a vacancy overstates coverage.

**How to apply:** Keep a verified careers page as the route and evidence URL, or classify a form as `send_cv` only when explicit CV/application instructions are present. Leave `sample_vacancy_url` blank until a linked role-detail page or an ATS vacancy record is verified.