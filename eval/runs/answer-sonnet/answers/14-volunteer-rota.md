# Volunteer rota: what to ask the contractor to use

## Recommendation

**Check whether you need a custom build at all.** For 150 volunteers, shifts, a gap view and reminders, a ready-made volunteer scheduling service is probably the better fit. This is a common need, and there are many products for it. Examples are Assemble, Volunteer Local, Better Impact, Rosterfy and SignUpGenius. I haven't checked their current features or pricing, so treat them as names to evaluate. Many give non-profit discounts.

A service like that is maintained by someone else. It gets security patches and sends reminders, and the next contractor inherits nothing. The contractor's month could go on setting it up, importing your volunteers, training coordinators and writing the handover notes. That is cheaper and lower risk than code that a stranger must maintain for years.

**If no product fits, ask for a small, boring custom app:**
- **Framework:** Django (Python). Its built-in admin screens give coordinators a working interface for little effort. It is mature, has long-term-support releases and secure defaults, and many contractors know it. A contractor who is strongest in Laravel (PHP) is an acceptable alternative. What matters is a mainstream framework with a built-in admin, not the brand.
- **Database:** PostgreSQL, or MySQL if the host only offers that. Avoid anything exotic.
- **Hosting:** a managed platform or a small managed host, with automatic backups and automatic security updates. It costs more per month than a bare server, but nobody has to patch a server.
- **Reminders:** email by default, using a transactional email provider. SMS is optional and paid per message. A scheduled job sends reminders.
- **Login for volunteers:** emailed sign-in links instead of passwords, since volunteers forget passwords. Coordinators should use two-factor authentication.
- **Keep it separate from the WordPress site.** The site can link to the rota, but it shouldn't hold the personal data.

## Alternatives I considered

| Option | Why not (or when) |
|---|---|
| **WordPress plugin on your existing site** | It is familiar and cheap. But the site is years old, and I'd assume it is unpatched. Volunteer plugins also tend to be weak on reminders and coordinator views, and a WordPress plugin stack needs constant updates. It is only reasonable if you first move to a freshly maintained, properly hosted WordPress. |
| **Spreadsheet plus forms** | It's cheap and everyone understands it. But reminders are fiddly, access control is poor, and sharing phone numbers in a spreadsheet is a data-protection weak point. |
| **Trendy stack (Node/React, serverless, microservices)** | Faster to start, but it has more moving parts, more version churn, and a smaller pool of cheap contractors who can maintain it. |
| **Self-hosted open-source volunteer tool** | It looks free, but you still need hosting, patching and someone who understands it. Check for active maintenance before considering it. |
| **Bare virtual server the contractor sets up** | It is cheap, but it needs ongoing patching that your team can't do. |

## Risks

- **Custom code is a long-term liability.** A month of build leaves years of upkeep. Budget a small annual maintenance retainer with a named person, even if it is only a few hours a year.
- **Handover failure.** This is the biggest risk. If the accounts, code and passwords sit with the contractor, the system is orphaned on day one.
- **SMS costs and set-up rules.** Costs scale with volume. Some countries require sender registration before SMS works reliably.
- **Lapsed payments and expiries.** An expired card, domain or certificate is the most common way small systems stop working. Use a shared organisation email and a second admin.
- **One-month scope creep.** Agree the must-haves in writing. Sign-up, gap view and reminders come first. Reports, swaps and anything else come later.
- **Data protection.** The system holds names, phone numbers and availability. Availability can incidentally reveal things like religion or health.

## Data protection basics to require

- **Minimal data.** Collect only what the rota needs.
- **Access by role.** Coordinators should see only their own food bank's volunteers, if that fits how you work.
- **Security and hosting.** Use HTTPS, encrypted backups and two-factor authentication for coordinators. Check where the data is hosted.
- **Processors.** Each provider that touches the data (hosting, email, SMS) needs a data processing agreement.
- **Policies.** Have a privacy notice, a retention rule (for example, delete inactive volunteers after a set period) and a simple breach procedure.
- **Rights.** Volunteers should be able to see, correct and delete their own data.
- **Jurisdiction.** I don't know yours. If it's the UK or EU, GDPR applies, and in the UK you may need to pay the data-protection regulator's fee.

## What to check before committing

1. **Requirements.** Write down what the rota must do, in plain language, with a coordinator involved.
2. **Product trial.** Trial two or three ready-made services with real coordinators, and compare five-year costs against build plus maintenance.
3. **Existing site.** Find out who has admin access to the WordPress site, which version it runs, and where it is hosted.
4. **Volunteer devices.** Do all 150 volunteers have email and a smartphone? That decides email versus SMS.
5. **Existing data.** Find out where the volunteer list lives now and how clean it is.
6. **Contractor questions.**
   - Have they done handovers before?
   - Will they use the stack above?
   - Will they write a plain-English runbook covering how to deploy, restore a backup and renew everything?

## Contract terms I would insist on

- Every account (hosting, domain, email, SMS, code repository) is registered to the organisation, not the contractor.
- The contractor assigns ownership of the code to you.
- A documented handover session is part of the deliverable.
- Ideally, a different developer reviews the handover before final payment.

If you tell me your country and whether volunteers all have email, I can help you turn this into a brief for the contractor or a shortlist of products to trial.
