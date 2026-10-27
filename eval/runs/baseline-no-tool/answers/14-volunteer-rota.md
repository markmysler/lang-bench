# Recommendation for your volunteer rota

## Short answer

**Don't ask the contractor to write software. Ask them to choose, set up and hand over a hosted volunteer-scheduling service.** Spend the month on configuration, importing your volunteers, training, and writing things down, not on code.

Here's why that fits you:

- **The next contractor can pick it up.** A product with its own admin pages, documentation and vendor support needs no developer to take over. Someone on a small budget, or one of your own staff, can learn it in an afternoon. Custom code, even good code, has to be learned first and costs money every time it changes.
- **It keeps working with little care.** Custom software decays. Security patches, hosting changes and expired accounts all build up, and with nobody watching, it eventually breaks or gets hacked. With a hosted service, the vendor does that work.
- **Data protection.** The vendor's security team is protecting the names and phone numbers, not one freelancer's setup. You still have legal duties (see below), but the hardest technical part is done by people who do it full-time.
- **It's a solved problem.** Shift sign-up, spotting gaps, and SMS and email reminders for 150 volunteers across several sites is exactly what these products are built for.

## What to ask the contractor for

Make the deliverable a working, handed-over system, not an app:

1. **Shortlist 2–3 products and trial them** with two or three real coordinators and a handful of volunteers, including someone who isn't comfortable with technology.
2. **Set up the chosen one:** your food banks as sites, shift templates, coordinator roles, and reminder schedules.
3. **Import your volunteers** from wherever they're kept now, and invite them in.
4. **Every account must be owned by the organisation.** Use an organisational email address such as rota-admin@yourcharity, pay with the organisation's card, and have at least two staff admins. This matters more than anything else on the list. The most common failure for small charities is a system tied to a contractor's personal login.
5. **Write a short handover document:** what it is, where the logins are kept, how to add a site or coordinator, how to export the data, what it costs and when it renews.
6. **Record a 30-minute training session** for coordinators.
7. **Add a link or sign-up button on the WordPress site.** Nothing more should touch WordPress.

**Products worth looking at** (examples only; I haven't checked current pricing or features, so check them yourselves): Better Impact, Bloomerang Volunteer, Rosterfy, TeamKinetic (UK-based), Galaxy Digital and VolunteerHub. At the simple end there's SignUpGenius. Many offer charity discounts.

## Alternatives I considered

**A custom web app** built on a mainstream framework, with cheap hosting and an SMS provider.
- **Why not:** It would be the most fitted to you, but it gives you something nobody on staff can maintain. Each future change needs a developer. Someone has to patch it, renew domains and certificates, and pay the hosting bill. And the next contractor first has to understand the last one's code.
- **When it would make sense:** only if the trials show no product can handle a must-have need. Even then, insist on a very common technology (for example Django or Laravel), managed hosting with automatic backups, and a written runbook.

**A WordPress plugin** on your existing site.
- **Why not:** You'd be putting 150 people's phone numbers on a years-old site, where security depends on someone keeping WordPress and every plugin updated. Rota plugins are often maintained by one person and get abandoned. If the site is ever compromised, the volunteer data goes with it. Keep the website and the rota separate.

**Spreadsheets and forms** (Google Sheets plus Forms, or Airtable).
- **Why not:** They're cheap and familiar, but reminders need fragile add-ons. Sharing permissions are easy to get wrong, so a whole phone list ends up visible to anyone with the link. They also tend to grow into a mess only one person understands. Fine as a stopgap, but not what you'd pay a contractor to build.

**No-code app builders** (Glide, Softr and similar on top of a spreadsheet).
- **Why not:** They're a middle ground, but you're still effectively maintaining a custom app. You'd also depend on a small vendor whose pricing (often per user) and features change. A purpose-built rota product is the safer bet.

## Risks, and how to reduce them

| Risk | How to reduce it |
|---|---|
| The vendor raises prices, gets bought or shuts down | Choose a product with a full data export (spreadsheet/CSV). Test the export during the trial. Have staff export a copy every few months. |
| Text-message costs creep up | Many products charge per SMS or in bundles. Use email or app reminders by default and SMS only for volunteers who need it. Get the cost at 150 *and* 300 volunteers. |
| Locked out because accounts sit with the contractor | Organisation-owned logins, two staff admins, and the logins kept in a shared password manager or another secure place. |
| Some volunteers won't use an app | Check it works in a phone's web browser without installing anything, and that coordinators can sign people up on their behalf. |
| A coordinator's account is compromised | Turn on two-step login for admins if the product supports it. Give coordinators access only to their own food bank if it can. Remove leavers promptly. |
| The product doesn't quite fit how you work | Adapt the process a little rather than paying for custom work. Ask coordinators which needs are must-haves and which are nice-to-haves. |

## Data protection (I've assumed you're in the UK)

- The vendor will be your **data processor**. You need their data processing agreement, and you should know where the data is stored: UK/EU, or the US with appropriate safeguards.
- **Update your privacy notice** to cover the rota and reminders.
- **Decide how long to keep data** for volunteers who leave, and check the product can delete them.
- **Check your ICO registration** covers this. Many charities pay the lowest tier or are exempt, but confirm it.
- **Collect only what you need:** name, phone, email, availability and site. Leave out dates of birth, addresses or health details unless there's a real reason.

## Check before you commit

1. Can a volunteer sign up for a shift on a basic phone browser in under two minutes?
2. Can a coordinator see gaps for *their* food bank at a glance?
3. Do reminders go out by email and SMS, with the timing you want?
4. What is the total yearly cost at 150 and at 300 volunteers, including SMS, and is there a charity discount?
5. Can you export all your data yourselves, without contacting support?
6. Is there a data processing agreement, and where is the data stored?
7. Is there two-step login and per-site access for coordinators?
8. Is support responsive, and does good help documentation exist? That's what your next contractor will rely on.
9. Who pays, from which budget, and who notices when the renewal comes up?

If a product passes these checks during a two-week trial with real coordinators, you'll have something staff can run themselves. Any contractor will be able to pick it up in an afternoon, and it will keep working whether or not anyone technical is around.
