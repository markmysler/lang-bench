# Recommendation: Ghost, self-hosted, with the agent configuring it rather than writing it

I'd build on **Ghost**, an open-source publishing platform (MIT licensed) that already does most of what you listed: sign-up, free and paid tiers, monthly and yearly Stripe billing, member-only posts, and newsletter sending. The agent's job becomes setup, theme customization, and small integrations. It doesn't write login, payment, or email code from scratch.

This fits your priorities:

- **Works without you understanding it:** the hard parts (member accounts, paywalls, subscription webhooks, unsubscribes) are handled by software used by many publishers, not by code only your agent has seen.
- **Cheap:** a small VPS (roughly €5–20/month) plus Stripe's per-transaction fees plus a bulk email provider. Your 4,000 subscribers and 20,000 target should fit under $50 a month, but the email line is the one to check (see below).
- **Sellable:** a buyer's developer can recognize Ghost immediately. The business owns the domain, the list, the Stripe account, and the server. Custom code is minimal, so there's little to hand over that nobody can read.
- **Growth:** Ghost handles this scale without redesign.

Caveat: I'm working from memory, and I haven't verified current prices or versions. Ghost's hosted (Ghost Pro) pricing and bulk email options change, so check before committing.

## Alternatives I considered

- **Substack, Patreon, Beehiiv, or similar hosted platforms:** quickest to start, but they take a percentage of paid revenue or charge fees that scale with subscribers. You'd also not own the site in the sense you want. Rejected on cost and ownership.
- **Custom build (Next.js or similar, plus a database, Stripe, and an email API):** the most control, and it's what most people picture when they say "build me my own." But then the agent is writing and maintaining login, payments, webhooks, email, and access control, with nobody reviewing it. Every custom line is a risk you'd have to take on trust. Rejected as the default. It becomes the right choice only if you need features Ghost can't provide.
- **WordPress with a membership plugin (e.g. Paid Memberships Pro or MemberPress):** a mature, viable option. Plugins add upkeep and license costs, and security patching is heavier. It's my second choice behind Ghost.
- **Running your own email server:** rejected. Deliverability for a newsletter depends on sender reputation, and a small self-run server will land in spam.

Regardless of platform: **payments go through Stripe's hosted checkout and customer portal**, never card handling in our code, and **email goes through a dedicated provider**.

## Risks

1. **Email deliverability.** This is the biggest practical risk. You need SPF, DKIM, and DMARC set correctly, working bounce and unsubscribe handling, and a careful list migration. Importing a large list of cold addresses can damage sender reputation. Start with your most engaged subscribers.
2. **Moving paid members.** Paid subscribers generally can't be moved with their payment details intact. Expect a re-subscribe campaign and some churn. Check the current platform's export options and terms first.
3. **Paywall leaks.** Member-only content must be enforced on the server, not just hidden in the page. Leaks can happen through direct links, RSS feeds, email previews, or search snippets. This needs explicit testing.
4. **Billing edge cases.** Failed cards and retries, switching between monthly and yearly, refunds, cancellations, and sales tax or VAT (Stripe Tax can help) all need to work. These are where subscription sites usually break.
5. **Unreviewed maintenance.** Nobody on your side reads the code. Mitigations: prefer off-the-shelf features, keep a staging copy to test changes, have the agent keep plain-English documentation, and schedule regular updates for Ghost, the server OS, and dependencies.
6. **Backups.** Content, member data, and the database must be backed up automatically, and someone must test a restore. An untested backup isn't one.
7. **Legal.** Unsubscribe links and consent records are required under CAN-SPAM and GDPR. If you have EU or UK subscribers, you need a privacy policy, a data processing agreement with each vendor, and a view on cookie consent. Confirm where your subscribers are located, since that affects tax as well.
8. **Ownership and handover.** Every account (domain, Stripe, hosting, email provider) should be in the business's name, not the agent's or your personal login, with credentials in a shared password manager.
9. **Cost creep.** Email volume is the hidden driver. 20,000 subscribers sending weekly plus member emails is well over 100,000 emails a month. Price that before you commit.

## What I'd check before committing

1. **Email cost at 4,000 and 20,000 subscribers.** Multiply subscribers by sends per month, then price that with two or three providers, such as Amazon SES, Postmark, or Mailgun. Confirm which provider the chosen platform supports for bulk sending.
2. **Export your list.** Pull the full subscriber list from the current platform and check whether it includes consent records and engagement data. Measure how many addresses haven't opened anything in six months.
3. **Test the migration on a copy.** Import into a staging site and confirm the members, tiers, and content come across. Don't import into the live site first.
4. **Run a two-week pilot in Stripe test mode, then a real small payment.** Test sign-up, monthly and yearly purchase, switching plans, cancellation, a failed card, a refund, and access to member-only posts while logged out.
5. **Test deliverability.** Send to seed inboxes at Gmail and Outlook, and check the sender scores before the first real send.
6. **Get a one-hour outside check before launch.** Hire a freelance developer for a handover review, not a full code audit. Ask them whether they could take over the setup, whether the backups restore, and whether the accounts are in your name. This is the cheapest protection you can buy, since you can't review the code yourself.
7. **Confirm the legal basics** with a short consult: privacy policy, unsubscribe handling, and tax obligations by subscriber location.

If the pilot and the email cost check both come in under budget, go with Ghost. If Ghost can't do something essential, such as a specific billing or access rule, that's the point to consider the custom build, and I'd want a second opinion from a developer before choosing it.
