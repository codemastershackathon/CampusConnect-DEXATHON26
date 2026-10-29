# CampusConnect – real build (HTML + Firebase + Netlify Functions)

A peer-help board for one campus: post a request or offer, match on shared tags, connect **only when both accept**,
chat, say thanks (karma + badges), and a staff side for insights and moderation.

```
public/                 20 pages (each file = its own <style> + <script type="module">, no shared css/js)
netlify/functions/      F02 create-request · F03 respond-request · F04 confirm-helped · F05 submit-report
                        F06 report-action · F07 aggregate-tags (nightly) · lib/ (F01: admin SDK, auth, config)
scripts/                set-role (F08) · seed (F09) · init-config · configure
firestore.rules         security rules (the real enforcement layer)
firestore.indexes.json  composite indexes (12)
tests/                  functions.test.js · scripts.test.js · rules.test.js · e2e/ (see "What is tested")
```

## How it fits together
```
Browser (HTML pages)  ──Firebase Auth──►  Google sign-in / email link (college domain only)
        │  reads/writes (rules-checked)
        ├────────────────────────────────►  Firestore   users · posts · chats/messages · notifications · tagStats · config
        │  Authorization: Bearer <ID token>
        └──►  Netlify Functions (Admin SDK)  requests · connections · chats · karma · badges · reports · suspensions
```
Three independent checks guard everything: the page's route guard, the function's token check (verified email + college
domain + role claim), and Firestore rules. **Karma, badges, roles, requests, connections, reports and notifications can
only be written by functions** – a modified browser cannot award itself anything.

## Setup (about 30 minutes)

### 1. Firebase project
1. Create a project at console.firebase.google.com → add a **Web app** → copy the config values.
2. **Authentication → Sign-in method:** enable **Google** and **Email link (passwordless)**.
3. **Authentication → Settings → Authorized domains:** add your Vercel domain (and `localhost` for local work).
4. **Firestore Database:** create in production mode.
5. **Project settings → Service accounts → Generate new private key** (keep the JSON secret, never commit it).

### 2. Configure
```bash
cp .env.example .env        # fill in every value (Firebase web config, service-account fields, domain, URLs)
npm install
npm run configure           # writes the Firebase config + college domain into all 20 pages AND firestore.rules
```
The college domain lives in three places that must agree: `ALLOWED_EMAIL_DOMAINS` (Netlify env), the pages, and
`firestore.rules`. `npm run configure` keeps all three in sync (this is plan decision D01).

### 3. Deploy the database rules and indexes
```bash
npx firebase login && npx firebase use <your-project-id>
npm run deploy:rules        # rules + indexes (indexes take a few minutes to build)
npm run init-config         # creates config/app (karma points, badge thresholds, limits)
```

### 4. Deploy
* **Functions → Netlify:** connect the repo; set env vars `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY` (with the `\n` sequences, in quotes), `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_ORIGINS`
  (your Vercel URL). `netlify.toml` already schedules `aggregate-tags` nightly at 02:00 UTC.
  Put the resulting `https://<site>.netlify.app/.netlify/functions` into `FUNCTIONS_BASE_URL` and re-run `npm run configure`.
* **Pages → Vercel:** import the repo; `vercel.json` serves `public/` with clean URLs and security headers.

### 5. First users
```bash
# 1) sign in once on the site with your college account, then:
npm run set-role -- you@college.edu admin          # or faculty
# 2) sign out and in again so the new role reaches your token
npm run seed -- --for you@college.edu              # optional demo data + a ready-made demo story for your account
npm run seed -- --clean                            # remove all demo data later
```

## Staying on the free plan (Firebase Spark, ₹0, no card)
* Spark can never bill you; at a limit a feature just pauses until the daily reset. Firestore free daily quota: 50,000 reads · 20,000 writes · 20,000 deletes, 1 GiB stored (per Google's published free tier – confirm in the console).
* **Email-link sign-in is limited to 5 emails/day project-wide on Spark** (25,000/day on Blaze). Use **Google sign-in** as the main route and don't spam "Resend".
* The board loads 30 posts per fetch (with *Load more*) to protect the read quota. Each page also keeps small listeners (inbox count, notification dot) that only cost reads when something changes.
* Watch usage in Firebase → Firestore → Usage. If you ever move to Blaze, add a Google Cloud **budget alert** (it warns; it does not stop spending).

## If "Continue with Google" does not work – checklist
Open the browser console (F12) and read the red error, then match it:
| Message / symptom | Fix |
|---|---|
| "sign-in method is switched off" (`auth/operation-not-allowed`) | Firebase → Authentication → Sign-in method → enable **Google** (it asks for a support email) |
| "address is not authorized" (`auth/unauthorized-domain`) | Authentication → Settings → **Authorized domains** → add your site (`localhost` is there by default) |
| Nothing happens / "open the site through a local server" | Don't double-click the HTML files. Run `npx netlify dev` and use http://localhost:8888 |
| "browser blocked the Google window" | Allow pop-ups for the site |
| "We couldn't load your profile" + `permission-denied` | Rules not deployed or domain mismatch: `npm run configure` then `npm run deploy:rules` |
| "Use your college email…" after choosing an account | That Google account's domain isn't in `ALLOWED_EMAIL_DOMAINS` |
| API key error | Re-run `npm run configure` with the real web config values |
Testing without a college account: add the test account's domain to `ALLOWED_EMAIL_DOMAINS` (comma-separated, e.g. `college.edu,gmail.com`),
run `npm run configure`, then `npm run deploy:rules`. Switch back before going live. (The Google "hd" hint is skipped for public domains like gmail.com.)

## Behaviour that follows your plan
* Sign-in: Google (with `hd` hint, rejected client-side **and** server-side if not a college address) or email link;
  unverified accounts are held on the verify screen; suspended accounts can only see the suspended screen.
* Posts: 5–120 char title, ≤500 char description, 1–8 tags, no phone/email in text; authors can edit text/tags and
  close; moderators hide; 3 reports auto-hide (configurable).
* Connections: max 10 requests / 24 h, no duplicates, own posts blocked; accept creates the connection and the chat.
* Karma: +10 to the helper when the **receiver** confirms help (once per connection, once per pair per 24 h);
  +3 for accepting, **only the first time two students connect** (anti-farming). Badges recompute server-side
  (Newcomer / Helper 10 / Rising Mentor 25 / Top Mentor 40 – editable in `config/app`).
* Contact details live in `users/{uid}/private/contact`, readable only by the owner and by someone with an accepted connection.
* Moderation: admin-only; every action needs a note; staff accounts cannot be suspended; actions are recorded on the report.

## Deliberate deviations from the plan (please review)
1. **HTML pages instead of React/Vite**, per your instruction. Config is injected by `npm run configure` instead of `VITE_*` variables.
2. **Report IDs** are `reporterId_targetType_targetId` (not auto-IDs) so “one report per person per target” is atomic.
3. **Extra fields/types:** `reports.moderatorNote/action/reviewedBy/reviewedAt`, notification type `help_confirmed`,
   `connections.lastHelpedAt`, contact `shareEmail/sharePhone`, `tagStats/_summary` (status counts, per-category counts and the
   weekly series – faculty can’t read closed/hidden posts under the rules, so the nightly job computes these).
4. **Extra indexes:** `notifications (uid, createdAt desc)` for the list view. The plan’s 11 + this one = 12.
5. **No custom message on a connection request** (the plan’s `requests` schema has none); conversation happens in chat.
6. **Post category is not editable** after publishing (the plan’s edit rule lists title, description, tags and status only).
7. **Badge names** follow the plan (Newcomer/Helper/Rising Mentor/Top Mentor), not the Figma labels.
8. Suspended users are also blocked from creating posts and messages in the rules (plan only says “active user” for posts).

## What is tested – and what is not
| Layer | How | Result |
|---|---|---|
| Netlify functions (F01–F07) + scripts | `npm run test:functions` – the **real function code** against an in-memory Firestore/Auth fake | 10/10 pass |
| All 20 pages, full user journeys | `tests/e2e` – the **real pages + real functions** in headless Chromium, 4 browsers on one backend: sign-in, onboarding, posting, search, connect, accept, live chat, mark-helped → karma/badge, notifications, leaderboard, edit/close, privacy, reports, moderation, suspension, role guards, insights, unverified/Google paths | 72 checks pass, 0 page errors |
| Firestore rules | `tests/rules.test.js` (emulator) | **Written but NOT run** – needs `npm install` + `npm run test:rules` on your machine |
| Real Firebase Auth / Firestore / Google popup / email delivery | – | **Not run** – the sandbox had no network. Everything above used a faithful fake of the SDK. |

So: logic, UI and flows are verified; the first run against your real Firebase project is the remaining step. Run
`npm run test:rules` first – if a rule is too strict or too loose it will show up there. Also expect to check the
Firestore **index** build state in the console after the first deploy.

To run the end-to-end suite yourself (needs Python + `pip install playwright && playwright install chromium`):
```bash
node tests/e2e/server.js 8790 &   python3 tests/e2e/e2e.py 8790
```

## Known limitations
* Contact sharing preferences (`shareEmail`/`sharePhone`) are honoured by the UI; because the plan stores both in one
  document, a hand-crafted client could still read both fields once connected. For hard enforcement split them into two docs.
* Board search = latest 100 open posts per type/category + exact tag matches; for a bigger campus move to Algolia/Typesense.
* Email-link sign-in needs the same browser/device or a confirmation prompt (built in).
* Karma history is readable only by its owner; the public profile shows counts, not event history.
* Because each page embeds the shared base code, a change to shared logic must be made in all 20 files (search/replace).
