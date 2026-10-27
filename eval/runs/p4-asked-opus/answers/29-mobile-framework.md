# React Native vs Flutter for your mobile app

**Use React Native with Expo.** For a four-person TypeScript team that already knows React, this is not a close call. The harder decision is how you do offline sync, and that problem is the same whichever framework you pick.

## Why React Native + Expo

1. **No new language.** Flutter means learning Dart and a different UI model before anyone ships anything. With React Native, the skills you need are new but your language, tooling and mental model stay the same. Expect 2–4 weeks before people feel productive, not 2–3 months.
2. **Shared code with your backend and web app.** In a monorepo (pnpm workspaces or Turborepo; Expo supports both) you can share:
   - Prisma-derived types
   - Zod schemas and validation
   - the API client
   - date and permission logic
   - business rules such as "who can comment on what"

   You won't share UI components with Next.js, and I wouldn't try. Sharing everything below the UI layer is still a lot of saved work for four people.
3. **Hiring.** Every TypeScript/React developer you hire can work on the web app, the API and the mobile app. Flutter would split your hiring pool and leave you with a mobile silo.
4. **Expo removes most of the native pain you'd otherwise face:**
   - EAS Build handles builds and code signing without anyone needing to master Xcode or Gradle.
   - `expo-notifications` covers push on both platforms.
   - `expo-sqlite` gives you local storage for offline.
   - Development builds let you add native modules when you need them.
   - EAS Update lets you ship JavaScript fixes over the air without waiting for app review. That suits "ship fast" well.
5. **Your app is a good fit.** Task lists, comments and notifications are forms, lists and sync. That is React Native's home ground. You don't need custom rendering, heavy animation or games, which are the areas where Flutter is clearly stronger.

## Alternatives I considered

- **Flutter.** It's a good framework: consistent rendering, strong performance, good tooling. But all of its advantages are in areas you don't need, and all of its costs (Dart, no code sharing, narrower hiring) hit what you care about most. I'd pick it for a team with no web background or a UI-heavy app. Neither describes you.
- **Native Swift + Kotlin.** That's two more codebases and two more languages for four people. Not justified at seed stage.
- **PWA, or Capacitor wrapping your Next.js app.** This is the cheapest option and worth taking seriously. iOS now supports web push for PWAs installed to the home screen. But installing is awkward for users, iOS can evict offline storage, and the result feels like a website. For an app whose selling points are offline use and notifications, I'd treat it as a fallback, not the plan.
- **Kotlin Multiplatform / Compose Multiplatform.** It's maturing, but it's a JVM-ecosystem tool, and none of you has run the JVM in production. Wrong team for it.

## Risks, roughly in order of how much they'll actually hurt

1. **Offline sync is the real project.** Showing cached data is easy. Letting people edit tasks and post comments offline and then reconciling those edits is hard. You need to decide early:
   - **Sync approach.** You can build your own (TanStack Query with persisted mutations, or SQLite plus an outbox), use a sync library (WatermelonDB), or use a sync service in front of Postgres (PowerSync, ElectricSQL, Zero/Replicache-style tools). The services save months but add cost and a vendor dependency.
   - **Conflict rules.** Last-write-wins per field is usually fine for tasks. Comments are append-only, which makes them easy.
   - **Backend changes.** You'll need client-generated UUIDs, soft deletes, `updated_at` change cursors and idempotent write endpoints. Check now whether your Prisma schema and Express API can support these.
2. **"We know React" overstates how ready you are.** React Native has no DOM and no CSS cascade, and navigation (Expo Router or React Navigation), long lists, keyboard handling and safe areas all work differently. Budget learning time, and pick one developer to own mobile and become the expert.
3. **Shipping to app stores is new work.** It involves:
   - Apple and Google developer accounts. An organisation account needs a D-U-N-S number, which can take a week or more.
   - Certificates and provisioning profiles.
   - App review rejections.
   - Store listings and privacy labels.
   - Being unable to roll back a native release instantly.

   None of it is hard, but all of it takes time.
4. **Push notifications span several systems:** APNs and FCM credentials, permission prompts, device-token storage, sending from your Redis queue workers, and deep links into the right task. Plan this as a feature in its own right, not a library you install.
5. **Upgrades.** Plan for roughly one Expo SDK upgrade a year (more if you want to stay current). Each additional third-party native library adds upgrade risk, so keep the list short and prefer Expo's own modules.
6. **Cost.** EAS paid tiers and any sync service are new line items. Sync traffic will also add load to your Fly.io API and Postgres. All of this is manageable, but estimate it before you commit.

## What to check before you commit

1. **Run a 1–2 week spike with one or two developers.** Build an Expo app that logs in against your real API, shows a task list, edits a task in airplane mode, syncs when back online, and gets a push notification that opens that task. Test on a real iPhone and a real Android phone, including a cheap Android device. If this goes smoothly, you're done deciding. If it struggles, you'll learn where before you're committed.
2. **Decide on offline sync during the spike.** Try one library or service against your actual schema. This choice affects your backend more than React Native vs Flutter does.
3. **List every device feature you'll need** (camera or attachments, background sync, biometrics, widgets, share sheet) and confirm an Expo module or a well-maintained library covers each one. Background sync on iOS is limited whatever framework you use, so set expectations accordingly.
4. **Audit your API for sync readiness:** IDs, soft deletes, change cursors, idempotency, and how authentication works on a phone (refresh tokens in secure storage rather than cookies).
5. **Start the admin work now:** Apple and Google org accounts, D-U-N-S, the bundle ID, and push credentials. These run on calendar time, not developer time.
6. **Price it:** the EAS tier, the sync service if you use one, and expected extra API and database load per active mobile user. Compare that with your target for keeping the cloud bill growing slower than revenue.

**Bottom line:** pick React Native with Expo, set up a TypeScript monorepo that shares types and logic with your existing stack, put one developer in charge of mobile, and spend your design effort on offline sync rather than on the framework choice.
