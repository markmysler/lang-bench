# Recommendation: don't build it from scratch. Self-host Ghost.

Your requirements (sign-up, monthly and yearly paid tiers, member-only posts, email sending) are exactly what Ghost does out of the box. It's open source, has been around for over ten years, and many developers know it. That last point matters for a sale. A buyer's developer can take over Ghost, but nobody can take over a one-off codebase an agent wrote without help from the agent.

## The stack

| Piece | Choice | Why |
|---|---|---|
| Site, members, paywall, editor, newsletter | Ghost (self-hosted) | Does the whole job. The agent customizes the theme instead of writing a platform. |
| Payments | Stripe, connected to Ghost | Handles monthly and yearly plans, cards, and invoices. Self-hosted Ghost takes no cut beyond Stripe's fees. |
| Bulk email | Mailgun (Ghost's built-in option) | See the cost risk below. |
| Server | One VPS (Hetzner or DigitalOcean, 2–4 GB RAM) | Plenty for 20,000 subscribers. |
| Backups | Automatic nightly database and image backups to cheap storage | Non-negotiable. |

**Estimated cost:** about $15–25 a month for the server, backups and domain at the start. Email is the variable part. Stripe's per-payment fees are on top of that.

## Alternatives I considered

- **A fully custom build (for example Next.js, Postgres, Stripe and Amazon SES).** It has the cheapest email (roughly $8 a month at 20,000 subscribers) and total flexibility. But the agent would be rebuilding sign-in, payment webhooks, failed-card handling, unsubscribe compliance, bounce handling and an editor. All of those are places where bugs lose money or break email law, and you can't review them. It's also the hardest thing to sell. I'd only do this if the email cost below turns out to be a dealbreaker.
- **Staying hosted (Beehiiv, Substack, Kit, Ghost's own hosting).** Easiest, but the cost climbs with subscriber count. At 20,000 members it likely exceeds your $50 budget, and I'd guess that's part of why you're leaving. Check current prices.
- **WordPress with membership plugins.** Familiar, but it depends on stacking third-party plugins. They need constant updates and are a frequent source of security problems.
- **Paid-membership add-ons (Memberful and similar).** They add another monthly fee and still need a separate site and email tool.

## Risks

1. **Email cost at scale (the biggest budget risk).** As far as I know, Ghost only sends bulk newsletters through Mailgun. At 20,000 subscribers sent weekly (about 80,000+ emails a month), Mailgun may cost more than the rest of the stack combined, possibly $75 or more. I'm not certain of current prices or whether Ghost has added other providers, so this must be checked.
2. **Deliverability.** Moving 4,000 people to a new sending domain can land you in spam if it's done badly. It needs proper domain authentication (SPF, DKIM, DMARC) and a gradual ramp-up. Gmail and Yahoo now enforce rules for bulk senders.
3. **Migrating paying members.** If your current platform owns the Stripe account, moving subscriptions without asking members to re-enter cards requires coordination, and sometimes a Stripe support request. Done wrong, you lose paying members.
4. **Tax.** Selling subscriptions internationally can trigger VAT or sales tax. Stripe Tax helps, or a merchant-of-record service such as Paddle can handle it for a higher fee. This needs a real decision.
5. **The agent as a single point of failure.** I'll be doing all maintenance, so the setup must not depend on my memory. That means written runbooks, a staging copy for testing changes, tested backups, and updates applied carefully. Ghost's major upgrades occasionally need work.
6. **Consent and unsubscribes.** Imported subscribers need valid consent records, especially if any are in the EU or UK.

## What to check before committing

1. **Export:** what the current platform lets you export. You need emails, sign-up dates, free versus paid status, Stripe customer IDs, the post archive and any comments.
2. **Stripe:** whether the Stripe account is yours or the platform's.
3. **Email pricing:** the current Mailgun price at 20,000 subscribers, and whether Ghost supports a cheaper provider now.
4. **Features you can't lose:** referrals, podcasts, comments, discounts, free trials and anything else your members rely on.
5. **Where subscribers live,** for tax and privacy rules.
6. **A trial run before any commitment:**
   - Set up Ghost on a cheap server.
   - Import about 100 test members.
   - Run a test payment in Stripe test mode.
   - Send a test newsletter to Gmail, Outlook and Yahoo inboxes and see where it lands.
   - Restore a backup onto a fresh server to prove it works.

   This costs a few dollars and a day or two, and it settles most of the open questions.

## What I need from you

- **Own every account** in your name (domain, server, Stripe, email provider, backups), with me working through limited access. This is what makes the business sellable and keeps you in control.
- **Tell me your hard monthly ceiling,** including whether email at scale may exceed it, so I know whether to switch to the custom route.
- **Decide on tax:** cheapest with some compliance work, or pricier and hands-off.

If the trial run and the email pricing check out, I'd proceed with Ghost. If email at 20,000 subscribers is too expensive, we talk again about a lighter custom build with Amazon SES, accepting the sale and maintenance trade-offs above.
