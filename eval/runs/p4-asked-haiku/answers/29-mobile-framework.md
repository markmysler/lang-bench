## Recommendation: React Native with Expo, in TypeScript

I'd build the app in React Native using Expo, with TypeScript throughout. Your four developers already write React and TypeScript, so most of the skill you need carries over. Flutter would mean a new language, a new ecosystem and a small hiring pool, which conflicts with your goal of hiring more TypeScript developers.

**Why React Native fits you**

- **Skills transfer.** Components, hooks, state management, and typed API clients all carry over. The new things to learn are mobile navigation, native permissions, and the offline model.
- **Code sharing with the web app.** A monorepo can share types, validation schemas (for example Zod), the API client, and business logic between the Next.js app and the mobile app. This is a real saving for a four-person team and a reason to prefer RN over Flutter here.
- **Backend unchanged.** The Express API, Prisma, Postgres and Redis queues serve the mobile app as they serve the web app. You add a sync or delta endpoint where needed. Nothing new runs on Fly.io.
- **Expo removes most native toolchain work.** EAS Build creates iOS and Android binaries in the cloud, so you don't need a Mac for every build, and EAS Submit sends builds to TestFlight and Google Play. Expo Router gives file-based navigation, similar to Next.js.
- **Hiring.** React Native developers are drawn from the same pool as your TypeScript hires.

**Offline support is the hard part, whichever framework you pick**

Task lists and comments need local storage, a queue of pending writes, and conflict handling when two people edit the same task offline. Start with these choices:

- **Simple:** TanStack Query with persisted cache, plus a queue of mutations replayed on reconnect. Works for modest sync needs, but you write the conflict logic yourself.
- **Middle:** a local database (SQLite via expo-sqlite, or WatermelonDB) with your own delta-sync endpoints. This needs per-record `updatedAt` or version numbers and tombstones for deletes.
- **Sync engine:** a product such as PowerSync or ElectricSQL, which both work with Postgres. This saves the most custom work but adds a vendor dependency. Evaluate it before you build your own.

I'd make the sync design decision first and let it drive the framework tests.

## Alternatives considered

- **Flutter.** Rendering is excellent and it's a strong choice for heavy custom UI or animation. This app is lists, forms, and notifications, so those strengths matter less. Dart is a new language for everyone, Flutter code can't be shared with Next.js, and the team has no Dart experience. The cost is real for four people. I'd choose it only if you expect a demanding custom UI or a second team with Dart skills.
- **Native (Swift and Kotlin).** Best platform fidelity, but two codebases built by four people with no mobile experience. Too expensive for a seed-stage company.
- **Capacitor or Ionic.** Wraps your web code in a native shell. It's the fastest route, and it reuses your Next.js components most directly. The risks are a web-view feel, weaker offline and background behaviour, and a ceiling on performance. It's a reasonable fallback if the spike below goes badly. Keep it in mind rather than dismiss it.
- **PWA only.** Not enough on its own. Push notifications on iOS need the app installed to the home screen, and you'd lose App Store presence and native feel.
- **Kotlin Multiplatform.** Requires JVM expertise, which nobody on the team has in production.

## Risks

1. **Sync and conflict handling** will take longer than planned, whatever the framework.
2. **Library churn and upgrades.** Expo SDK and React Native upgrades happen often and occasionally break native modules. Budget time for them every few months.
3. **Native module gaps.** Some features (background tasks, certain notification behaviour) depend on native modules with uneven maintenance. Check each dependency's activity before relying on it.
4. **Push notifications.** You need APNs and FCM configured, and background delivery and quiet hours behave differently on each platform.
5. **App store review.** Reviews add delay. Expo Updates can push JavaScript fixes without a review, but Apple's rules limit what can change this way, so don't plan around it for anything substantial.
6. **Low-end Android performance.** Test on a cheap device, not only flagship phones.
7. **Recurring cost.** Apple Developer Program ($99/year), Google Play ($25 once), and EAS build minutes above the free tier. Check current pricing; these figures may have changed.

## Before you commit: a two-week spike

Build a thin slice that exercises the risky parts:

- Create and edit a task offline, reconnect, and sync with a conflict. Use the sync approach you'd ship, not a stub.
- Send and receive push notifications on both platforms, including with the app in the background and killed.
- Add a comment on a second device and confirm it arrives in order.
- Run on a low-end Android phone and an older iPhone.
- Get a build through EAS to TestFlight and an internal track on Google Play. Check that it works on a clean machine, not just one developer's.
- Add crash reporting (Sentry or similar) and confirm source maps and symbols upload.
- Check the maintenance status and recent release activity of every native dependency you plan to use. My knowledge of library status may be out of date, so verify this yourself.

If the spike passes and the sync approach is clear, commit to React Native. If sync turns out to be unworkable within your timeline, the fallback is Capacitor, not a rewrite into Flutter. Make that decision with the spike results, not before.
