## Recommendation

Ask for a boring, mainstream stack that the next contractor can run without you. Before commissioning a custom build, check whether a volunteer-scheduling SaaS already covers the need, because for 150 volunteers it may be cheaper and safer.

**My first pick: buy before you build.** Shortlist two or three volunteer-scheduling products built for charities (sign-up shifts, coordinator dashboards, email/SMS reminders, data export). Many offer nonprofit pricing. The provider handles security patches, uptime and reminder delivery, and the next contractor only has to configure and administer it. Check the costs over three years, not just the first year.

**If nothing fits, build a small custom app with:**
- **Python with Django**, or **PHP with Laravel** if your WordPress host is PHP and cheap PHP hosting is the only option you can get.
- **PostgreSQL** (or MySQL with Laravel) as the database.
- **Django's built-in admin** or a Laravel admin panel, so coordinators get a web admin for free.
- **A managed host** such as a small PaaS or a PHP/Python host, not a self-managed server.
- **A transactional email service** (Postmark, Amazon SES, Mailgun or similar) for reminders. Add SMS only if volunteers actually want it, since it costs money and needs explicit consent.
- **Standard login** (email plus password, or magic links) with role-based access: volunteer, coordinator, admin.

Why Django or Laravel: both are mature, have long-term support releases, ship with authentication, permissions, database migrations and security defaults, and have a large pool of contractors who know them. Django's admin also meets the "staff use web admin pages" requirement almost for free.

## Alternatives I considered

- **Extending WordPress with plugins.** Fine for the public site and a sign-up form. I would not store personal data and rota logic in plugins. Plugins get abandoned, each adds update risk, and the rota then depends on the health of the whole WordPress install. Keep WordPress for public pages and link to the rota app.
- **Google Sheets/Forms with Apps Script.** Good as a stopgap, but it spreads personal data across files, gives weak access control, and reminder scripts break silently. Poor long-term fit for data protection.
- **Airtable or similar no-code tools.** Quick to start, but per-seat pricing, vendor lock-in, and less control over where data lives.
- **A JavaScript single-page app with a separate API, or microservices.** Too many moving parts for a one-month build and a small-budget maintainer.
- **Exotic or newest frameworks.** Hard to hire for, and the next contractor may struggle.

## Risks

- **Bus factor.** The contractor leaves; the next one inherits everything. Mitigate with the handover checklist below.
- **Vendor risk (SaaS).** Prices rise, features change, or the company closes. Check data export before signing.
- **Personal data.** Names, phone numbers and availability need a privacy notice, minimal fields, access limited by role, encryption in transit and at rest, backups, and a way to export or delete a person's data. Confirm which data-protection law applies to you (UK GDPR, EU GDPR or other) and sign data-processing agreements with the hosting and email providers.
- **Reminder reliability and consent.** Test that reminders actually arrive, and record consent for SMS.
- **Silent decay.** Dependencies go out of date and security patches are missed. Turn on automated dependency alerts and budget a yearly maintenance hour.

## Check before committing

1. **Ownership.** The code repository, hosting account, domain, and email/SMS accounts are all in the charity's name, with credentials in a shared password manager. The contractor does not hold the only keys.
2. **Handover.** Require a README covering setup, deployment, backups, how to add a coordinator, and how to rotate keys, plus a recorded walkthrough. Pay for a handover session.
3. **Stack and track record.** Ask for two past projects in the proposed stack that are still running, and for references who can say whether they kept working unattended.
4. **Test coverage.** Ask for automated tests on sign-up, capacity limits, and reminder sending, and a staging environment.
5. **Data.** Ask how personal data is stored, who can see it, how it is exported, and how it is deleted.
6. **Costs.** Get hosting, email/SMS, and maintenance costs for three years in writing.
7. **Your WordPress site.** Check its PHP version, plugin list and last update date. An old site is itself a data-protection risk and may affect which hosting you can use.
8. **Volunteer usability.** Test sign-up on a phone with a few real volunteers, including older ones, before launch.

I haven't checked current product features or prices for the specific tools, so verify the SaaS shortlist and hosting costs yourselves before you decide.
