**Short answer:** An agent can build this. At 600 volunteers and a few hundred matches a month, the scale is small. But I would not start by building. First check whether a maintained volunteer-management product covers most of what you need. Your takeover rule and your "nothing that needs constant care" rule both favour software someone else maintains. If you do build, use a boring, mainstream stack on managed hosting, and make the tests and documentation do the work that code review would normally do.

## What I'd build with, if building

- **Django (Python) web app.** Its built-in admin lets staff look up and correct records without custom screens. It also includes user accounts, password hashing, CSRF protection, and database migrations, and it has long-term support releases. Rails or a mainstream TypeScript framework would also work. The point is a common choice with a standard layout.
- **PostgreSQL, fully managed.** Matching is relational (volunteers, skills, availability, requests, partners), so a relational database fits better than a document store. The provider handles patching and backups.
- **Managed app hosting** (a platform-as-a-service or serverless containers) in a UK or EU region. No servers to patch.
- **Transactional email and SMS** from providers that offer a UK/EU data processing agreement.
- **Sign-in** through the framework's standard libraries (email one-time codes or magic links). Don't write your own password or crypto code.
- **Matching as plain, explainable rules:** skills, availability overlap, travel distance, accessibility constraints. A coordinator approves each match. No AI model makes the decisions, so you can always answer "why was this person matched?"
- **Repository, tests, and documentation:** source code in a charity-owned Git account, automated tests on every change, a staging environment with fake data, and a plain-language README, architecture note, runbook, and decisions log. The next developer and the next agent session both depend on these.

## Alternatives considered

- **Buy a product (my first choice to evaluate).** Charity-focused platforms such as Assemble, Better Impact, Team Kinetic, or Rosterfy exist, and CiviCRM is an open-source CRM common among UK charities. Check whether matching is actually supported, whether you can export your data, and how pricing scales with 600 volunteers and 40 partners. I haven't verified current features or prices, so check them directly.
- **Low-code builders** (Airtable, Glide, Softr, Power Apps). Quick to start, but per-seat pricing, vendor lock-in, and logic that a future developer finds hard to read. Fine for a prototype; weak against the takeover rule.
- **Spreadsheets and forms** as a stopgap. Cheap, but phone numbers and health notes spread across files with weak access control and no audit trail.
- **Self-hosted servers, Kubernetes, or microservices.** Ongoing patching and monitoring with far more moving parts than this needs. Ruled out.
- **Serverless with a NoSQL database** (e.g. Firebase). Quick to start, but awkward for matching queries and high lock-in.
- **LLM-driven matching.** Unpredictable, hard to explain, and it would send personal data to a model provider. At most, use AI to draft messages that a person checks.

## Risks

1. **Health notes are special category data.** I'm assuming UK GDPR applies; tell me if not. You'll need a DPIA before launch, a lawful basis and a condition (usually explicit consent), a privacy notice, and retention limits (for example, anonymising volunteers inactive for a set period). You also need a subject-access and deletion procedure, and a breach procedure with the ICO notified within 72 hours. Share the minimum with partners: "needs step-free access", not the diagnosis.
2. **Broken access control.** The most common serious flaw in systems like this is one volunteer or partner seeing another's data. Tests must try forbidden access, not just the normal path.
3. **The coding agent sees whatever you give it.** Logs, database dumps, and screenshots go to its provider. Build and test with fake data, keep real data out of agent sessions, and check the provider's terms.
4. **Approval without code review.** Your volunteer can't review code, so the safety net is automated tests, a staging check of behaviour, and a written checklist. Don't approve changes that can't be tested.
5. **Bus factor and account ownership.** Cloud, domain, email, Git, and the agent subscription should sit in charity-owned accounts with at least two admins and shared credentials in a password manager. Anything on one volunteer's personal account is a takeover risk.
6. **Credits and cost.** Donated credits often expire, cover only some services, or have eligibility conditions. Managed database, email, SMS, and backups can exceed $100 a month. Set budget alerts and a hard spending cap.
7. **Agent drift.** Code can be fine today and inconsistent next month. The agent doesn't carry memory between sessions, so anything important must be written into the repository.
8. **Safeguarding.** If volunteers visit vulnerable people, decide whether background-check records belong in this system at all. Store only what's needed.
9. **Untested restores.** Backups count only after a restore has been done. Schedule a restore test and record the result.

## What I'd check before committing

1. **Buy versus build.** Ask two or three similar charities what they use and what they regret. Get written quotes for a product sized for 600 volunteers and 40 partners.
2. **Credit terms.** Confirm which services are covered, the region, the expiry date, and the realistic monthly cost of the whole stack: hosting, database, email, SMS, backups, and domain.
3. **Data protection.** Complete the DPIA, sign a processing agreement with each provider, confirm the data stays in the UK or EU, and name a trustee responsible for data protection.
4. **Takeover test.** Before launch, have an outside developer (paid for a few hours, or from a partner organisation) read the repository and runbook and say whether they could take over within a week. That tests the trustees' rule directly.
5. **Exit.** Confirm you can export all data in a standard format within a day, and that the code runs outside the chosen host.
6. **Pilot.** Run a month with about 20 volunteers and 2 partners. Use fake data first, then real data with consent, before full launch.
7. **Accessibility.** Sign-up and matching pages should meet WCAG 2.2 AA, since disabled volunteers and partners will use them.
8. **Release process.** Write down who can approve a change, what they check, and how to roll back.

To refine this, tell me your jurisdiction, whether you already use any volunteer or CRM tool, and your credit terms. I'd also want to know whether a trustee will own data protection.
