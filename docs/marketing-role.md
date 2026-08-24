# Marketing role access

Marketing accounts use the regular `/login` page. Create the account through the
normal registration flow, then have a super-admin promote it by sending
`PATCH /api/admin/super/users/:id/role` with `{ "role": "marketing" }`.

Marketing accounts are limited to the Waitlist Leads table. They can search and
filter leads, then update individual or bulk lead statuses. They cannot delete
leads or use candidate, employer, general admin, super-admin, sponsor, vacancy,
audit, identity, or job-management features.