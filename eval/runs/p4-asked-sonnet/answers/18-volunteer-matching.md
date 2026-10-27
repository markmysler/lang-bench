# Can the agent build a volunteer matching system?

**Yes, it can, but I'd check whether you need to build anything.** At 600 volunteers, 40 partners and a few hundred matches a month, this is a small system. Building it isn't the hard part. The hard part is that your rules (a later developer can take over, nothing needs constant care, health data stays safe) all favour having as little custom software as possible.

## What I'd do

**Step 1: spend a week or two evaluating off-the-shelf volunteer-management tools.** Several exist, and many offer charity pricing. I haven't verified current products or prices, so treat that as a list to check, not a finding. Score each against:

- Skills and availability fields, and partner request intake.
- Different access levels for coordinators and partners.
- Where the data is hosted, and whether the vendor will sign a data processing agreement.
- Whether you can export everything in a standard format (this is your exit plan).
- The price at your size.

If one fits, buy it. The vendor then handles patching, backups and security, which is exactly the constant care you want to avoid. Matching at a few hundred a month can stay a coordinator's decision, with the tool filtering candidates.

**Step 2: only if nothing fits, build a deliberately plain system:**

- **Django (Python) with PostgreSQL.** Django gives you a staff admin interface, login and permissions largely built in, so there's less custom security code that nobody can review. It's mature, widely taught, and any web developer you hire later can pick it up.
- **Simple server-rendered pages**, with no separate JavaScript front end.
- **One small container plus a managed database with automatic backups.** The provider handles database patching.
- **Matching as plain rules.** Filter on skills, availability and area, produce a ranked shortlist, and have a coordinator confirm. It is explainable and cheap. It also means no personal data goes to an AI service.
- **Few accounts.** Coordinators log in with two-factor authentication. Volunteers and partners use forms, so there's less to attack.
- **Generic cloud services only** (container, Postgres, file storage), so you can move providers when the credits end.

Running costs should sit well under $100 a month.

## Alternatives I'd rule out

- **Spreadsheets, Airtable or Notion.** They're fine for a one-month pilot. Beyond that, their per-field permissions are weak, health notes end up scattered in exports, and the logic lives in automations only one person understands.
- **CiviCRM.** It's charity-focused and free, but it needs constant updating and security patching. That is the constant care you said you can't give.
- **Salesforce nonprofit.** It's powerful, but it needs a specialist administrator, and the complexity is out of proportion to your size.
- **Rails, Node/React, Firebase or serverless.** Rails is a fair alternative to Django. Node/React adds more moving parts that go out of date. Firebase and serverless tie you to one vendor and are hard to hand over.
- **AI-based matching.** It adds cost and privacy risk, and you couldn't explain its decisions to a volunteer or partner.

## Risks

1. **Nobody can review the code.** The agent can't reliably vouch for its own security, and your volunteer can't check it. Before real data goes in, pay for an independent security review. This is the most important item in this list.
2. **"Nothing needing constant care" is hard for custom software.** Frameworks need security updates several times a year and eventually reach end of life. Decide now who does this: the agent under volunteer approval on a set schedule, or a paid developer for a few days a year. Budget for it either way.
3. **The agent has no memory between sessions.** Everything must be written down: how it works, how to deploy it, how to restore a backup, and why each choice was made. Documentation is what makes handover real.
4. **Health-related notes are special-category data** under UK/EU GDPR, which I'm assuming applies. That brings a higher legal bar, and a leak would hurt people.
5. **Donated credits end or change.** The cost after they expire needs to be known up front.

## What to check before committing

- **Jurisdiction and legal basis.** Which law applies? You'll likely need a data protection impact assessment, explicit consent for health information, a retention policy, and a way to handle access and deletion requests.
- **Whether you need the health data at all.** "Needs step-free access" is much safer to hold than a diagnosis. Collect the minimum.
- **Ownership.** The cloud account, code repository and domain should belong to the charity, not a volunteer's personal account. At least two trustees should have admin access, with credentials in a shared password manager.
- **The credits.** Which provider, how long they last, whether they cover managed databases, and the price afterward.
- **The current process.** Run the matching for a month on a controlled spreadsheet, or a trial of an off-the-shelf tool, to learn what coordinators actually need.
- **Development data.** The agent should build and test with fake data only. Real personal data should exist only in production.
- **Breach plan.** Decide who is told and who reports to the regulator if something goes wrong.

**Next step:** if you agree, the agent can produce the off-the-shelf comparison and a one-page data protection impact assessment draft. Those two documents will tell you whether building is justified.
