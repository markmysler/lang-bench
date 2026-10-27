# Can the agent build your volunteer matching system?

**Short answer: yes.** It's a small system of a well-known kind: sign-up forms, profiles, requests, a shortlist and notifications. At your scale (600 volunteers, a few hundred matches a month) it's a light load.

The harder question is whether you *should* build it, because nobody on your side can review the code and it will hold health information. So I'd do two things in order:

1. **Spend a week or two checking off-the-shelf volunteer management tools first.** If one fits at a price you can afford, it meets the trustees' three rules better than anything we could build.
2. **If none fits, build a deliberately "boring" custom system:** Django with a PostgreSQL database, on the managed services of whichever cloud your credits are for, hosted in the UK or EU. I've assumed you're in the UK. The data protection points are much the same under EU GDPR.

## Why check off-the-shelf first

- **Takeover:** with a hosted product there's nothing for a future developer to take over. They export the data or carry on using it.
- **Data protection:** a mature vendor has security staff, certifications and a standard data processing agreement. You'd still be responsible for the data, but you wouldn't also be responsible for the code.
- **No constant care:** the vendor applies the security updates.

The main downside is cost. Cloud credits usually can't pay for a third-party subscription, so this would be real money. Volunteer platforms often have charity pricing, but at around 600 volunteers expect tens to low hundreds of pounds a month. Compare that honestly with the custom route: hosting the credits would cover, plus a paid independent review, plus your volunteer's time for as long as the system exists.

When you look at products, check four things: UK/EU hosting, a full data export, how they handle health notes, and whether partners can see only what they need.

## If we build: what and why

**Django (a Python web framework) with PostgreSQL (a database)**

- **Hiring pool.** Python is the most widely taught programming language, and Django has been stable for nearly 20 years. Almost any developer you hire later can pick it up.
- **Less code to trust.** Django includes logins, permissions and protection against the common web attacks. Every feature we don't hand-write is one fewer place for a mistake that nobody can review.
- **Staff screens come free.** Django's built-in admin area gives your coordinators a working back office for viewing and editing records without extra code.
- **Predictable upkeep.** It has long-term-support releases, with security fixes for about three years each. That means one planned upgrade every couple of years, not constant churn.
- **PostgreSQL** is the most widely used open-source database. Every cloud offers it as a managed service, so you're not locked in.

**Hosting: managed services only, never a server we look after ourselves**

- A managed "app service" or "container service" runs the website. A managed PostgreSQL database comes with automatic encrypted backups.
- Everything sits in a UK or EU region.
- A rough guess is 40–80 USD a month in total, including email sending. The agent should price this on your actual provider before you commit.
- A separate test copy (a "staging" site) can share the same database server to keep costs down. Its role is covered under "how changes get approved" below.

**Matching: a shortlist plus a human decision, not an algorithm or AI**

- The system filters volunteers by skills, availability and location and suggests a shortlist. A coordinator confirms the match, and then the volunteer accepts.
- At a few hundred matches a month this works fine. It's easy to explain to volunteers, and a person stays in charge of decisions about people.
- It also means personal or health data never goes to an AI service.

**Keep the first version small**

- Volunteer sign-up and profile.
- Partner request form.
- Coordinator shortlist and confirmation.
- Email notifications.
- Data export and deletion, so you can answer subject access requests and "please delete me" requests.

Every extra feature is something to maintain forever, so add things only when there's a clear need.

**Consider not giving partners logins at all.** They could submit a request form and receive a volunteer's contact details only once the volunteer has accepted the match. That removes a whole group of accounts that could leak data.

## Alternatives I considered and why not

| Option | Why not |
|---|---|
| **Spreadsheets with forms** (Google, Microsoft) | Fine for lists, poor for health data. Sharing mistakes are a common cause of data breaches, and you can't limit what each partner sees. |
| **Low-code tools** (e.g. Airtable, Power Apps) | Charges per user add up once partners need access. Controlling who sees which fields is weak, and UK/EU hosting is often only on top plans. The logic ends up spread across many automations that a developer finds hard to take over. |
| **WordPress plus plugins** | Many third-party plugins that need frequent security updates, which is the opposite of "no constant care". |
| **A modern JavaScript stack** (e.g. Next.js/React) | Capable, but more moving parts and faster churn in the libraries it depends on, so more upkeep for the same result. |
| **"Serverless" or Firebase/Supabase-style backends** | Cheap when idle, but the security rules are easy to get wrong and hard to check without a developer. They also tie you closely to one vendor. |
| **Rails or Laravel** | Honestly almost as good as Django. Django wins narrowly on the built-in admin and the hiring pool. |
| **Your own virtual server** | You'd have to patch the operating system yourselves, which is exactly the constant care you want to avoid. |

## Risks and how I'd reduce them

1. **Code nobody on your side can review, holding health data.** This is the biggest risk.
   - Pay a developer or security reviewer for an independent review before go-live: likely a few days' work. A skilled-volunteer platform such as Reach Volunteering might find someone free.
   - Repeat a lighter check once a year.
   - Automated tests should cover the important rules, for example "partner A can never see partner B's volunteers".
2. **How changes get approved.** Your volunteer can't approve code, but they can approve behaviour. For each change, the agent should provide a short checklist ("log in as a partner, confirm you can't see X"). The volunteer works through it on the staging site before anything goes live.
3. **One person holds everything.** If your volunteer leaves, the system mustn't leave with them.
   - Every account (cloud, code repository, domain, email service) should be owned by the charity, not a personal account.
   - At least two people should have admin access, one of them a trustee.
   - Use multi-factor login and a shared password manager.
4. **Cloud credits run out.** Find out when they expire and what happens then, and set billing alerts. Because the setup is standard, moving to another provider or paying about 50–80 USD a month should be manageable.
5. **The health notes.**
   - Health data is special category data under UK GDPR. It needs a specific legal basis, probably explicit consent.
   - Do a Data Protection Impact Assessment (DPIA). It's cheap, and it's the document trustees and the ICO would expect.
   - Collect as little as possible. Prefer simple tick-box options (e.g. "needs step-free access") over free-text notes.
   - Show partners only what's needed for a specific match.
   - Delete records automatically after a set period of inactivity.
6. **The agent and real data.** The agent should build and test using fake data only. Real volunteer records should never be pasted into the chat. Its access to the live system should be limited and logged.
7. **The system still needs some care.** Custom software is never zero-care. Expect about 1–2 hours a month applying automated update suggestions, plus a planned upgrade every two or three years. If even that is too much, that points back to off-the-shelf.
8. **Accessibility of the sign-up forms.** Some of your volunteers have accessibility needs, so the site itself must meet recognised accessibility standards (WCAG).

## What the agent would hand over, for the trustees' takeover rule

- The code in a repository the charity owns.
- A plain-English README explaining what the system is and how it fits together.
- A "runbook" with step-by-step instructions for restoring a backup, applying updates and handling a suspected data breach.
- A record of the decisions made and why.
- The automated tests, plus a backup restore that has actually been tried, not just assumed to work.

## Check these before committing

1. **Credits:** which cloud, how much, when they expire, and whether they renew.
2. **Off-the-shelf:** shortlist three or so tools, get demos, and compare the real cost against the custom route.
3. **The real workflow:** sit with whoever does matching today. How do they match now? What do partners actually need to see? Where is the current data, so we can plan moving it across?
4. **Data protection basics:** who leads on it among the trustees, whether your ICO data protection fee is paid, consent wording, and the DPIA.
5. **Review budget:** money or a pro-bono reviewer agreed for an independent review before launch.
6. **Accounts and access:** charity-owned accounts and a second admin set up before any build starts.
7. **Upkeep:** a named person who'll spend an hour or two a month on updates, and a plan for who takes over if they leave.

If you tell me which cloud provider the credits are for, I can start by pricing the hosting properly. I can also draft the DPIA outline and a comparison sheet for the off-the-shelf options, so the trustees can decide with real numbers.
