# My recommendation: don't build it from scratch. Use Ghost.

You asked me to build a membership site. What you need already exists as a mature, free, open-source product called **Ghost**. It was designed for your exact case: an independent newsletter with free and paid members, monthly and yearly plans, member-only posts, and email sending built in. Thousands of paid newsletters run on it.

I'd still do all the work: setup, design, moving your subscribers and paying members, connecting your domain and email, backups, monitoring and updates. I just wouldn't write the membership system itself.

## The setup

- **Ghost** runs the website, sign-ups, member accounts, paywalled posts and newsletter sending.
- **Hosting:** a small company that specialises in running Ghost. Examples are PikaPods and Magic Pages. They handle server uptime, security updates and backups. Ghost's own hosting (Ghost(Pro)) is the most hands-off option, but at your member count it will probably cost more than your budget.
- **Stripe, in your own name,** takes payments. Ghost takes no cut of your revenue. Stripe charges about 2.9% + 30¢ per payment; the exact rate depends on your country.
- **Mailgun** delivers the newsletter emails. Ghost's built-in newsletter sending needs it.
- **Your own domain,** with email authentication set up so your newsletters land in inboxes, not spam.

**Rough monthly cost today:** about $25–60. Hosting is roughly $5–25. Mailgun is roughly $15–35 and depends on how often you send. Weekly sends to 4,000 people is about 17,000 emails a month. These prices are from memory, so I'd get current quotes before we commit.

**At 20,000 subscribers:** expect about $80–120 a month, mostly email. Any setup pays per email sent, so this rise isn't specific to Ghost. If even 5% of 20,000 pay you, revenue will have grown far faster than the bill.

## Why Ghost and not a custom build

- **You can't review code, and payments are where mistakes cost money.** Charging people twice, letting non-payers read paid posts, or failing to cancel subscriptions are bugs you'd only find through angry readers. Ghost's payment and login code has been tested by thousands of businesses for years.
- **It makes the business easier to sell.** A buyer's developer will recognise a standard Ghost site in minutes. A custom system written by an AI for a non-programmer is something they'd have to audit from scratch, and that lowers what they'll pay.
- **You're never locked in.** Ghost is open source, so your content and member list export cleanly. If a host disappoints us, I move you to another one, or to Ghost(Pro) when revenue justifies it.
- **There's less for me to break.** I'll keep design changes to the theme (the look of the site) and won't modify Ghost itself, so updates stay safe.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Custom-built site** | More risk, slower to launch, harder to sell, and it re-solves problems that are already solved. Its one advantage is cheaper email via Amazon's service at large scale, which is worth revisiting only if email costs become a real burden. |
| **Ghost(Pro)** | The same software with no maintenance at all. At 4,000 members it's likely around or over $50 a month, and it will clearly be over at 20,000. It's a good upgrade later and an easy move. |
| **WordPress plus membership plugins** | Several plugins from different vendors that have to keep working together, plus constant security updates. More things break, and they break more often. |
| **Staying on a hosted platform** (Substack, beehiiv, Kit) | Easiest of all, but some take 10% of your revenue, and you've decided to leave. If the reason was mainly cost, it's worth comparing honestly. |
| **Running my own server for Ghost** | Saves maybe $5–15 a month. But if the server goes down at 3am, nobody notices until you do. Paying a specialist host is worth it. |

## Risks, in order of importance

1. **Moving paying members.** This is the big one. If your current platform charges members through a Stripe account *you* own (Substack does, for example), their subscriptions can be linked into Ghost and they won't notice a thing. If the platform holds the card details itself, members may have to re-enter cards, and some will drop off. We need to know which it is before anything else.
2. **Emails landing in spam after the switch.** Sending from a new service can look suspicious to Gmail and Outlook. I'd set up domain authentication properly, remove long-inactive subscribers first, and ramp up sending gradually.
3. **Account ownership.** Every account (domain, hosting, Stripe, Mailgun) must be in your name, with two-factor login and the recovery codes stored in your password manager. I should never be the only one with access.
4. **Backups.** The host's backups, plus a separate weekly copy kept elsewhere. I'll also do a test restore so we know the backups actually work.
5. **Sales tax and VAT.** Your current platform may handle tax on digital subscriptions for you, and Ghost won't. Stripe Tax can do it for about 0.5% per payment. Check this with your accountant. It also matters when you sell the business.
6. **Email provider dependence.** Ghost's newsletter sending relies on Mailgun. If Mailgun raises prices sharply, our options are limited.

## What I'd check before we commit

1. **Which platform you're on now, and whether payments go through a Stripe account in your name.** This decides how smooth the move is.
2. **How often you send, and which country you're based in.** These decide the email cost and the tax setup.
3. **Current prices.** I'd get quotes from two Ghost hosts, Mailgun, and Ghost(Pro) for 4,000 and 20,000 members.
4. **A trial run before switching anything.** I build a test site with a copy of your data, and you click through it in your browser:
   - sign up for free
   - pay monthly and yearly with Stripe's test cards
   - switch plans, then cancel
   - confirm a free member can't read paid posts
   - receive a test newsletter on Gmail, Outlook, Yahoo and iCloud addresses
5. **Your old posts.** Confirm they import with their links intact, and that old links redirect to the new pages so search rankings survive.
6. **A cutover plan.** Billing stops on the old platform the moment it starts on the new one, so nobody is charged twice.

I'll also keep a plain-English handover document from day one: where everything lives, which accounts exist, what we customised and how to restore from a backup. It's what lets you rely on this without understanding it, and it's what a buyer's developer will ask for first.

If you can tell me your current platform and how often you send, I'll come back with real prices and a migration plan.
