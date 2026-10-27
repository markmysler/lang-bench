**Recommendation: don't build a back end yet. Use a hosted booking tool that supports group classes and Stripe deposits, and embed or link it from the Webflow site.**

I haven't checked current pricing or feature lists, and both change. Treat the tool names below as candidates to test, not confirmed fits.

## Why

- **The volume is small.** 30 workshops at 8 places is about 240 seats a month. Hosted tools handle that easily, and a custom system would give you no performance benefit.
- **The hard parts are already solved.** Those are capacity limits, not overselling the last seat, confirmation and reminder emails, and refunds and cancellations. They are tedious and easy to get subtly wrong. A mistake here means double-booked seats or lost deposits for a client.
- **It suits your situation.** You've never written a back end, and your coding agent would be writing and maintaining payment-adjacent code. That is the worst place to learn on a client's money. A hosted tool also lets the client log in and manage sessions themselves, so there's nothing for a future freelancer to inherit.
- **Running costs are low and predictable.** Expect a monthly subscription (roughly tens of dollars, which you should verify) plus Stripe's card fees. The client pays both directly.
- **Money never touches you.** The client owns the Stripe account and the booking-tool account. You're a collaborator on both, not the owner.
- **It's reusable.** What you reuse across clients is the pattern: the requirements checklist, the embed styling approach, and the handover doc. You don't need reusable code.

**Candidates to trial:** Acuity (Squarespace Scheduling), Bookeo and SimplyBook.me. Each has some form of group classes with capacity, and some form of deposit or partial payment through Stripe. Shortlist two and run a real workshop through a trial.

## Alternatives I considered

| Option | Why not (or when) |
|---|---|
| **Stripe Payment Links, one per workshop** | It's the cheapest option and needs no code. But there's no calendar, no waitlist and no reminders, and 30 links a month means constant manual setup. I'd verify how its payment cap handles multi-seat purchases. It's a fallback for tiny volumes. |
| **Webflow Ecommerce** (each workshop date as a product with inventory) | It fits your stack and design control. But it likely needs a pricier Webflow plan, and the client must create a product for every session, about 30 a month. Deposit-then-balance handling is clumsy, and there are no booking-specific features. It's worth a look if the client wants to sell vouchers and products anyway. |
| **Custom build** (Stripe Checkout, a serverless function, a database) | It gives the most flexibility and reuse, but it brings the most risk. You'd own webhooks, race conditions on the last seat, refunds, email, GDPR and ongoing fixes, with no back-end experience and a harder handover. Only go here if the hosted tools fail a real requirement. |
| **WordPress booking plugins** (Amelia, etc.) | They'd add a second platform, hosting and security updates to a Webflow site. That's the opposite of cheap and simple. |

## Risks

- **Embed styling.** Iframe widgets limit how closely you can match your design. For someone with your eye, this is the likeliest source of dissatisfaction.
- **Deposit mechanics vary.** Some tools collect a deposit but have no way to collect the balance later. Others handle it awkwardly.
- **Two sources of truth.** If the client also takes bookings by phone or in person, they must enter those in the tool too, or places will be oversold.
- **Vendor dependence.** Prices, plan limits or features can change. Check that you can export customer data.
- **Refunds and chargebacks.** The client needs a clear cancellation policy and must know how to refund from the dashboard.
- **Compliance.** Check tax and VAT handling, and GDPR or privacy terms for customer data. Stripe Checkout keeps card data off your site, so PCI burden is minimal with any option here.

## What to check before committing

Ask the client:
1. Is the deposit a fixed amount or a percentage? How is the balance collected, on the day in person or online beforehand?
2. What are the cancellation and refund rules? Is there a transfer-to-another-date option?
3. Do they need a waitlist, private group bookings, gift vouchers or multi-seat bookings?
4. Are workshops recurring or one-offs, and who will create sessions each month?
5. Which country and currency, and is tax or VAT collected?

Then test:
1. Pick two tools, set up a real workshop in each, and make a test booking with a deposit.
2. Check how the embed looks and behaves on mobile in Webflow.
3. Add up the total monthly cost: tool subscription, Stripe fees, and any Webflow plan change.
4. Confirm the client can create a session, refund a booking and export attendees without you.

If a tool passes, document the setup in a short handover note. If none pass on a hard requirement, come back and I'd design the smallest possible custom piece, with Stripe Checkout doing the payment work. That's a decision to make after the trial, not before.
