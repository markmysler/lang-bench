## Recommendation

You need something that enforces the 8-place limit and records who paid, but you shouldn't write that yourself for this client. For this client I'd use a **hosted workshop-booking tool that supports capacity limits and deposits, with Stripe underneath**, linked or embedded from the Webflow site. The client owns the account, the tool handles the hard parts, and you're not maintaining payment code.

I haven't checked current plans, prices, or feature lists for these tools, so verify those before you commit. Shortlist to trial:

- **Square Appointments** (classes and deposits) if the client already uses Square.
- **Acuity Scheduling** (group/class capacity and deposits) if they want a booking tool with a simple setup.
- **Checkfront or Bookeo** if they run a lot of activity-style bookings and want more reporting.

Pick one, then run a real workshop through it in test mode before going live.

## Alternatives I considered

- **Webflow Ecommerce, one product per workshop with stock set to 8.** This is the closest to the site you already built, and it's cheap. But a deposit is awkward: you'd sell a deposit "product" and collect the balance some other way. Stock may not be held reliably while someone is paying, and cancellations and refunds mean manual restocking. Reasonable if the client wants full payment up front and nothing more.
- **Stripe Payment Links or Checkout alone.** Good for taking money, but neither enforces capacity. Someone could book the ninth seat. You'd be tracking seats by hand.
- **Custom build: Stripe Checkout, a small serverless function, a Stripe webhook, and a database or spreadsheet.** This is the cheapest per booking and the most flexible, and it's worth doing once if you'll reuse it for several clients. For one client it's the wrong trade. You'd carry all the maintenance, and the payment logic is where bugs cost money. Having a coding agent write it is the biggest risk, because you'd be shipping code you can't fully review.
- **Eventbrite or similar ticketing.** Built for capacity but generally charges in full, not deposits, and takes a cut of each sale.

## Risks

- **Overselling.** Two people booking the last seat at once can both succeed unless capacity is checked and reserved at payment time. Test this with two simultaneous bookings.
- **Unpaid holds.** Seats taken by people who abandon checkout should be released after a timeout.
- **Payment confirmation.** Confirm bookings from Stripe's payment confirmation, not from the "thank you" page redirect. Someone can close the browser after paying.
- **Refunds and cancellations.** This is where most workshop bookings get messy. Decide the policy before launch and check that the tool can issue partial refunds and free up a seat.
- **Balance payments.** If the deposit is followed by a balance, check when and how it's collected and what happens if it isn't paid.
- **Lock-in.** Make sure you can export bookings and customer data as CSV if the client leaves.
- **Privacy.** Booking forms collect names, emails, and sometimes health information for pottery classes. Check the privacy notice and cookie consent, since third-party embeds often set cookies.
- **Tax.** Depending on the client's country, deposits, VAT, and invoices may need handling. Ask the client's accountant rather than assuming the tool does it.

## What I'd check before committing

1. Does the tool enforce the 8-place cap under concurrent bookings, and does it release unpaid holds?
2. Can it take a fixed deposit, and can it collect the balance later if needed?
3. Who owns the Stripe account and the payouts? It should be the client, not you.
4. What's the total monthly cost at the client's real volume (about 240 seats a month) once platform fees and processing fees are included?
5. What's the refund and cancellation flow for a customer and for the client?
6. Does it embed or link cleanly into Webflow, and does it work well on mobile?
7. Can you export bookings, and what happens to the data if you stop working with the client?
8. Run a full test: book, pay, cancel, refund, abandon checkout, and fill the last seat. Then check the Stripe dashboard and the booking list agree.

If several clients come to you asking for the same thing, revisit the custom route then. Build it once with an experienced developer or a tested template, not on the first client's deadline.
