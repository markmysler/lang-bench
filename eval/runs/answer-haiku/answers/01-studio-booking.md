## Short answer

Yes, I can build this. My first recommendation is **not** to build it from scratch yet. Spend a day checking whether a studio booking service fits your budget and class rules. If one does, use it. If none does, I'd build a small custom app on managed services, described below.

## Option 1: Studio booking service (my first choice to check)

Platforms built for yoga and fitness studios (Mindbody, Glofox, Momence, WellnessLiving, Zen Planner, Pike13 and similar) already do most of what you describe: a timetable, capacity limits, online booking and cancelling, reminder emails, and admin screens where you change times and prices yourself. They're tested by thousands of studios, so I maintain nothing.

- **Risk:** many charge more than $30 a month, especially once you add payments. Some have cheaper tiers. Current prices vary, so check them in your currency.
- **Fit check:** if you sell memberships, class packs or intro offers, a platform handles these well. A custom build would find them hard.

## Option 2: Custom app on managed services (if nothing fits)

- **Database: Supabase** (managed Postgres). Booking is handled by the database itself: a booking is only saved if the class still has a free place, checked in one step. This is what stops double bookings. A spreadsheet can't do this reliably.
- **Website: a simple static site** (pages for the timetable and booking, plus a password-protected page for you) hosted on a free tier such as Netlify or Vercel.
- **Payments: Stripe** (if clients pay online). Stripe holds the card details, so we never store them.
- **Reminders: a transactional email service** (such as Resend or Postmark) sending from your studio domain, with a scheduled job each day.
- **Your admin page:** you edit classes, times, capacity and prices there. I'd make it as close to a spreadsheet as possible.
- **Cost:** roughly $25 a month for Supabase, plus the domain (about $15 a year), plus Stripe's per-payment fees, which come out of takings. Email should fit the free tier at your volume. I'd check current free-tier limits before committing, because some free database tiers pause after inactivity, which is unacceptable for bookings.

## Alternatives I considered and rejected

- **Spreadsheet plus forms:** this is your current problem. No.
- **Appointment tools (Calendly, Acuity):** built for one-to-one appointments, awkward for group classes with a capacity limit.
- **No-code builders (Airtable with Softr or Glide):** cheap and easy for you to edit, but booking races and reminders are fiddly and hit limits as you grow. A reasonable fallback.
- **Your own server:** you said you don't want one. Managed services avoid it.

## Risks

- **Double bookings during switchover:** existing bookings must be imported before launch, or the old spreadsheet and the new system will conflict.
- **Ongoing maintenance:** a custom app needs updates and occasional fixes. Whoever maintains it must be able to explain it to you.
- **Account ownership:** you should own the Supabase, Stripe, domain and email accounts. I can set them up, but they should be in your name, with you as the login holder.
- **Lock-in:** if I stop maintaining it, you'll need someone else. I'd keep the code in a repository you own, with written instructions.
- **Email delivery:** reminders can land in spam unless the domain is set up correctly (SPF and DKIM records). I'd test this first.
- **Data and privacy:** you hold client names, emails and possibly health information. You'd need a privacy notice, and the rules depend on where your clients live.
- **Time zones and daylight saving:** class times must display correctly year-round.

## What I'd check before committing

1. **Platform prices:** the actual monthly cost of two or three booking platforms in your currency, including payments.
2. **Your class rules:** do you use memberships, class packs, drop-ins or waitlists? Do you need a late-cancellation rule (for example, no refund within 12 hours)?
3. **Payment:** do clients pay online at booking, or pay at the studio? Online payment adds the most complexity.
4. **Client data:** can you export your current client list and bookings to a spreadsheet?
5. **Email domain:** can you access the studio's domain settings to set up sending?
6. **Location:** which country your clients are in, since that decides privacy rules and tax on payments.
7. **Trial:** whichever route you pick, run it with about 10 regular clients for two weeks before opening it to everyone.

If you tell me your currency, your location and whether clients pay online, I can narrow this to one recommendation and give you the costs for it.
