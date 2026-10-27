# Teams

Imaginary teams for the evaluation. Each scenario in `scenarios/` happens in one of them. The
agent under test and the judges see a team's section as written here, and nothing else about the
evaluation.

## solo-founder

**Who:** one person who runs a small yoga studio and has never written code. They use a
smartphone, email and spreadsheets.
**Stack:** none. They would pay a coding agent to build and look after everything.
**Skills:** can follow written instructions; cannot debug, read logs or edit code.
**Runs on:** whatever the agent sets up; would prefer not to manage a server.
**Cares about:** cost (under 30 USD a month), it not breaking, being able to change prices and
class times themselves.

## student-hobbyist

**Who:** a second-year university student building side projects to learn.
**Stack:** Python from an introductory course; has followed a Flask tutorial; a little JavaScript.
**Skills:** comfortable with small scripts and Git; has never run anything in production.
**Runs on:** free tiers only: a free container host with 512 MB of memory, or a Raspberry Pi
at home.
**Cares about:** learning, not paying, getting something working this weekend.

## startup-ts

**Who:** a seed-stage start-up with four developers.
**Stack:** TypeScript everywhere: a Next.js front end, a Node.js API on Express, Prisma, Postgres
(managed), Redis for queues.
**Skills:** strong in TypeScript and React; one developer has written some Go; nobody has run a
JVM in production.
**Runs on:** Vercel for the front end, Fly.io for the API, containers.
**Cares about:** shipping features fast, hiring more TypeScript developers, a cloud bill that
grows slower than revenue.

## agency-php

**Who:** a web agency of eight people building sites and apps for clients.
**Stack:** PHP with Laravel and WordPress; MySQL; some Vue.
**Skills:** two senior Laravel developers, the rest junior; nobody knows another back-end
language well.
**Runs on:** a few virtual private servers (2 vCPUs, 4 GB each) managed with Laravel Forge, and
shared hosting for small clients.
**Cares about:** projects any developer at the agency can maintain, fixed-price budgets, not
waking up at night.

## saas-rails

**Who:** a B2B software company with 30 engineers.
**Stack:** one Ruby on Rails monolith, Sidekiq for background jobs, Postgres, Redis.
**Skills:** deep Ruby and Rails experience; a platform team of three who also write Go for
internal tooling.
**Runs on:** AWS ECS on Fargate, with Terraform.
**Cares about:** product velocity, keeping the monolith healthy, on-call that stays quiet.

## bank-java

**Who:** the engineering organisation of a retail bank, about 600 engineers.
**Stack:** Java 21 and Spring Boot are the standard; Oracle and Postgres; Kafka.
**Skills:** very strong Java; a central architecture board keeps an approved-technology list;
adding a language needs a security review that takes months.
**Runs on:** on-premises Kubernetes (OpenShift) in two data centres.
**Cares about:** compliance, auditability, long-term support, staying within the approved list.

## retail-dotnet

**Who:** the e-commerce division of a retailer, 120 engineers.
**Stack:** C# and .NET; SQL Server and Cosmos DB; Azure Service Bus.
**Skills:** strong .NET; a few engineers know TypeScript for the front end.
**Runs on:** Azure: App Service, AKS, and Azure Functions on the consumption plan.
**Cares about:** staying on Azure with Microsoft support, cost of the Functions estate, peaks on
sale days.

## research-lab

**Who:** a computational biology lab at a university: six researchers and one research software
engineer.
**Stack:** Python with NumPy, SciPy and pandas; some C++ for hot loops; Jupyter.
**Skills:** excellent at scientific computing; little experience with web services; the research
software engineer has built one Flask app.
**Runs on:** the university's HPC cluster for batch jobs, and one virtual machine (4 vCPUs, 16 GB)
for anything served on the web.
**Cares about:** reproducible results, collaborators being able to use their work, little time
for upkeep between grants.

## iot-edge

**Who:** a company making gateways for industrial sensors, 15 engineers.
**Stack:** C and C++ for firmware; Rust for newer components; Python for test tooling.
**Skills:** systems programming and embedded Linux; little web experience.
**Runs on:** ARM Cortex-A53 gateways with 256 MB of RAM running Yocto Linux, fielded for ten
years; updates over slow cellular links.
**Cares about:** memory, reliability, small updates, security patches for a decade.

## gov-nonprofit

**Who:** a volunteer-run non-profit with no developers on staff. A freelance contractor builds
things and then leaves.
**Stack:** none of its own; a WordPress site from years ago.
**Skills:** staff can use web admin pages; whoever maintains the system next will be a different
contractor, hired on a small budget.
**Runs on:** whatever is cheap and widely supported.
**Cares about:** that the next contractor can pick it up, that it keeps working with little care,
data protection.

## game-studio

**Who:** an independent game studio of 25 people.
**Stack:** Unity with C# for the game; one engine programmer who writes C++; a back end of two
developers in Node.js and TypeScript.
**Skills:** the two back-end developers know Node and Postgres well; the C# developers can read
back-end code but haven't run servers.
**Runs on:** a cloud provider's managed Kubernetes.
**Cares about:** the launch not falling over, player-facing latency, a back end two people can
run.

## indie-maker

**Who:** a former marketer building a newsletter-and-membership product alone, with a coding agent
that writes and looks after all of the code.
**Stack:** none; has never programmed.
**Skills:** can describe what they want and test it in a browser; cannot review code.
**Runs on:** whatever the agent chooses; hosting budget under 50 USD a month.
**Cares about:** it working without them understanding it, low cost, and being able to sell the
business one day, so a buyer's developer should be able to take the code over.

## charity-agent

**Who:** a small charity with no developers. A volunteer runs a coding agent that builds and
maintains its systems.
**Stack:** none.
**Skills:** the volunteer can follow instructions and approve changes, not review code.
**Runs on:** donated cloud credits, about 100 USD a month.
**Cares about:** the trustees' rule that a developer hired later must be able to take over any
system, data protection, and nothing that needs constant care.

## designer-freelance

**Who:** a freelance web designer who builds sites for small clients.
**Stack:** HTML, CSS, a little JavaScript; most sites are on Webflow.
**Skills:** good front-end eye; has never written a back end; uses a coding agent for anything
beyond markup and maintains client sites with its help.
**Runs on:** whatever is cheap and simple to hand to clients.
**Cares about:** projects they can hand over to clients or other freelancers, low running costs.

## chat-founders

**Who:** two founders starting a live customer-support chat product. Nothing is built yet.
**Stack:** one founder is an experienced Laravel developer and wants to use Laravel; the other is
a designer.
**Skills:** strong PHP and Laravel; some JavaScript.
**Runs on:** planning a few cloud virtual machines.
**Cares about:** concurrency first: many customers' widgets connected at once, messages delivered
instantly; then hosting cost; then shipping quickly.

## chat-scaleup

**Who:** the same live-chat company two years on: 12 engineers, paying customers.
**Stack:** a large Laravel application (about 300,000 lines), MySQL, Redis, Laravel Reverb for
WebSockets, run on 10 virtual machines.
**Skills:** strong PHP and Laravel across the team; two engineers know Go.
**Runs on:** cloud virtual machines with a load balancer.
**Cares about:** concurrency (8,000 simultaneous chats today, 60,000 expected after a large
customer signs in three months), reliability, hosting cost.

## django-shop

**Who:** an online retailer with 20 engineers.
**Stack:** Django on gunicorn with sync workers, Postgres, Celery.
**Skills:** strong Python and Django.
**Runs on:** Kubernetes on a cloud provider, 40 pods for the storefront API.
**Cares about:** p99 latency of the storefront API (budget 300 ms), and a hosting bill that grew
three times faster than revenue last year.

## rails-imaging

**Who:** a two-person start-up building an image-processing API: resizing, watermarking and
automatic tagging for e-commerce photos. Early: a working prototype, a few pilot customers.
**Stack:** Ruby on Rails, because the technical founder knew it; image work through libvips.
**Skills:** the founder knows Ruby; a coding agent writes and maintains most of the code, the
founder reviews it.
**Runs on:** a few containers on a cloud provider.
**Cares about:** cost per processed image, throughput when a customer uploads a catalogue of
50,000 photos at once.

## logistics

**Who:** a regional logistics company, 300 employees, with an IT team of three Java developers.
**Stack:** Spring Boot services, Postgres.
**Skills:** solid Java; no other back-end language.
**Runs on:** small virtual machines (1 vCPU, 512 MB) at a local hosting company, by policy.
**Cares about:** running costs, reliability, and that IT can keep everything running.

## clinic-booking

**Who:** a healthcare booking platform with six developers.
**Stack:** Flask on gunicorn with sync workers, Postgres.
**Skills:** good Python and Flask.
**Runs on:** containers on a cloud provider.
**Cares about:** reliability during the morning booking rush, staying in Python.
