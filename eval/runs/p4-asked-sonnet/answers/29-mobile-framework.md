**Recommendation: React Native with Expo, in TypeScript.**

**Why**

- **Skills transfer.** Your team knows React and TypeScript, so they will be productive in weeks. Flutter means learning Dart, a new widget model and new tooling, on top of learning mobile itself. With four developers and no mobile experience, avoiding that second learning curve matters most.
- **Shared code.** You can share types, validation schemas, API clients and business logic with the Node API and Next.js app, for example through a monorepo package. If you use something like tRPC or a generated OpenAPI client, API changes become type errors in the app. Flutter can't do this.
- **Hiring.** The TypeScript/React pool is much larger than the Dart pool, and your web hires can contribute to the app.
- **Infrastructure.** Nothing changes on the back end. No new runtime, and no JVM.
- **Expo** handles builds (EAS), over-the-air JS updates, push notification setup and the native toolchain. Most teams in your position no longer need to touch Xcode or Android Studio day to day. Its cloud services have a cost, but it is small compared with the developer time they save.

**Alternatives considered**

- **Flutter.** It is excellent: very consistent UI across devices, strong performance and good tooling. If you were building a graphics-heavy or highly custom-designed app, or had Dart developers, I'd lean toward it. For task lists, comments and notifications, its advantages matter little, and its costs (a new language, no code sharing, a smaller hiring pool) apply to you in full.
- **PWA / Capacitor wrapper around your Next.js app.** This is the cheapest option. However, iOS push notifications and background behaviour for PWAs are limited, and offline support with a good feel is harder. Store presence and quality perception also suffer. It is worth considering as a stopgap, but I wouldn't choose it for a product where the mobile app is core.
- **Native Swift and Kotlin.** Best quality, but it needs two codebases and skills you don't have. Not realistic at your size.
- **Kotlin Multiplatform.** It needs JVM/Kotlin skills, and you have none.

**Offline support is the biggest risk, not the framework choice**

Offline for task lists, comments and notifications means local storage, a sync queue, conflict resolution and handling of retries and duplicates. That is true whichever framework you pick, and it will likely be your hardest engineering problem. Things to decide early:

- Do you build sync yourself, or use a sync engine (WatermelonDB, PowerSync, ElectricSQL, Replicache-style approaches, or similar)? Check the current state and maintenance of each, as this area changes quickly.
- Local store: SQLite (via expo-sqlite) is the usual base. Prisma and Postgres don't run on the device, so you will need a separate sync layer and API design (change feeds, idempotent writes, per-record versioning).
- Conflict rules: last-write-wins for most fields may be enough, but comments (append-only) and simultaneous edits to a task need explicit decisions.
- Redis queues can drive push notification fan-out on the server side, which fits what you have already.

**Other risks**

- **React Native performance** on long lists and animations needs care (use FlashList or similar, avoid unnecessary re-renders). It is manageable, but is a skill to learn.
- **Native modules and upgrades.** Most libraries you need are fine, but occasionally a dependency lags behind an RN or Expo upgrade. Stay on Expo's supported libraries and upgrade regularly rather than rarely.
- **Mobile is different from web.** App store review, release cycles you can't roll back instantly, permissions, push token management, deep links and old app versions staying in the wild. Your API will need versioning and tolerance of old clients, which is new for a web-only team.
- **Push notifications** (APNs/FCM) have setup quirks, especially on iOS, and delivery is not guaranteed. Plan for in-app sync as the source of truth.
- **Team load.** Four people shipping web, API and mobile will be stretched. Consider making one person the mobile lead early.

**What I'd check before committing (about 1–2 weeks)**

1. **Build a spike**: login, a synced task list with 1,000+ items, one offline edit and one comment, plus a real push notification on a physical iPhone and a mid-range Android phone. Check that scrolling is smooth and sync works after airplane mode.
2. **Pick the sync approach** during the spike, since it constrains your API design. This is the most important decision.
3. **Check Apple and Google developer accounts**, the App Store review requirements, and any account-setup lead times (Apple's can take days).
4. **Confirm costs**: EAS plan, push services, and any sync-service pricing, against your cloud-bill concern. A self-hosted sync layer on Fly.io may be cheaper but means more to operate.
5. **Look at your design needs.** If the product relies on heavily custom, animation-rich UI, reconsider Flutter. If it is standard list and detail screens, stay with RN.
6. **Verify the current RN/Expo state** (New Architecture, library support for the packages you plan to use), since my knowledge may lag behind the latest releases.

**Bottom line:** choose React Native with Expo for the skills, code sharing and hiring. Put your effort into the offline and sync design, because that is what will determine whether the app works well, far more than the framework choice.
