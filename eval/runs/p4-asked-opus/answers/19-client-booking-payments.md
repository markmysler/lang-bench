# Bookings and card deposits for the ceramics studio

## Short answer

You don't need to build a back end, and I'd advise against it. Use a hosted booking service built for classes and workshops. Connect it to **the client's own Stripe account** and embed it in the Webflow site. Your reusable product is a setup checklist and a styled embed pattern, not code you have to keep running.

## Why

The volume is small: about 30 workshops a month with 8 places each, so at most 240 bookings. Any decent booking tool handles that easily. The difficult parts of bookings aren't the payment button. They're the daily running of the business:

- Stopping a workshop from being overbooked when two people book the last place at once
- Cancellations, refunds, moving someone to another date, and waitlists
- Confirmation and reminder emails
- Phone or walk-in bookings, which have to come off the same 8 places
- A screen where the studio owner can see who's coming, without asking you

A hosted tool already does all of this and has been tested by thousands of studios. If you build it yourself, you write and maintain every one of those features. You also become the person called when a payment fails at 9pm. That would make the project hard to hand over to the client or to another freelancer, which is what you most want to avoid.

## What I'd use

Choose a class or workshop booking platform that meets these requirements:

1. **Group sessions with a capacity limit**, such as 8 places per date
2. **Deposits**: the customer pays part now and the rest later or on the day
3. **Payments go through the client's own Stripe account**, or Square or PayPal, so the money never passes through you
4. **An embed or booking widget** that works in Webflow, and that you can style reasonably
5. **The client holds the account and pays the subscription**, with you added as a collaborator

Tools worth shortlisting, roughly from best to weakest fit for a small studio:

- **Bookwhen**: built for classes and workshops, and popular with craft studios. Good fit.
- **Acuity Scheduling** (owned by Squarespace) or **SimplyBook.me**: general booking tools with class and group features.
- **Momence, Punchpass or Mindbody**: built for studios but leaning towards fitness. Mindbody in particular is probably too expensive for this.

I haven't checked these tools' current prices or exact deposit features today, and both change often. Treat the list as a shortlist to test, not a verdict. Book a real test workshop with a deposit in each tool's free trial before you pick one.

## Alternatives I considered

| Option | Why not (or when) |
|---|---|
| **Build your own** (Stripe Checkout, a hosted function and a database such as Supabase or Airtable) | You'd own the overbooking protection, payment notifications, refunds, an admin screen and data protection. That's a lot to maintain for someone who has never written a back end, and hard to hand on. Only worth it if several clients need something no tool can do, and even then the business operations are the hard part, not the code. |
| **Webflow Ecommerce** (each workshop is a product, the 8 places are stock, the deposit is the price) | It technically works, but you'd create about 30 products a month. It has no attendee list, reminders, rescheduling or waitlist, and Webflow takes a transaction fee on some plans. It's fine for selling gift vouchers, not for running workshops. |
| **Stripe Payment Links** (one link per workshop, limited to 8 payments) | Free and needs no back end, so it's a reasonable stop-gap for a few workshops. At 30 a month, cancellations and keeping places up to date by hand become a mess. |
| **Eventbrite or similar ticketing sites** | Fees are high and often charged to the customer, the experience is heavily branded as theirs, and it takes customers away from the client's site. |
| **Calendly-style schedulers** | Built for one-to-one appointments. Group places and deposits are weak or missing. |

## Risks

- **Collecting the rest of the payment.** This is the biggest design decision. Charging the balance to the card automatically later is complicated, especially in the UK or EU, where banks can ask the customer to confirm again. Taking the balance in the studio on the day is much simpler. Decide which you want before choosing a tool.
- **Bookings outside the system.** If the studio takes phone or Instagram bookings and doesn't enter them in the tool, workshops will get overbooked. This is a training issue, not a software one.
- **Cancellations and disputes.** The client needs a written cancellation policy: whether deposits are refundable and how much notice is needed. It must appear at checkout. Without one, customers who dispute a charge with their bank usually win.
- **Lock-in and price rises.** The client is tied to the vendor. Check that bookings and customer lists can be exported.
- **Fees.** Some tools add a per-booking fee on top of Stripe's card fees. Calculate the cost at 240 bookings a month, not just the monthly subscription.
- **Embed limits.** Most of these widgets are a box from another site placed inside the page, so you can't fully restyle them to match your design. Check how far the styling goes before promising the client a seamless look.
- **Personal data.** You'll now be collecting customers' names, emails and payment details. Update the privacy policy and name the booking tool as a company that handles the data.

## Things to check before committing

1. **Where the client is based.** The country affects the tool shortlist, the bank confirmation rules and VAT.
2. **Deposit flow**: fixed amount or percentage, and how the balance is paid.
3. **Cancellation, refund and transfer rules** the studio wants.
4. **Other ways the studio takes bookings**, and whether staff will enter them in the tool.
5. **Whether they need** a waitlist, gift vouchers, private group bookings or multi-week courses. Each can rule tools in or out.
6. **Total monthly cost** at full bookings: subscription, plus per-booking fees, plus Stripe fees.
7. **A real test in the free trial.** Embed it on a staging page, book on a phone, cancel, refund, and look at the owner's view.
8. **Accounts in the client's name.** The Stripe account and the booking tool should both belong to the client from day one, with you invited as a user. This also makes handing over to another freelancer easy.

## Making it reusable across clients

Write the steps above into a short playbook covering requirements questions, tool choice, Stripe setup, embedding and styling in Webflow, and testing. Keep a Webflow section for the embedded widget that you've already styled. Each new client then costs you a few hours of setup, with nothing new to maintain.

If you tell me the client's country and how they want the balance paid, I can narrow the shortlist to one or two tools.
