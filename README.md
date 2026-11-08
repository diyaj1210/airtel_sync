# Hackathon - Airtel SYNC YTL 2026, Track A: Project Udyam Digital

A digital-first journey for small businesses: advisor → one-price quote → Smart KYC → order
tracker. Design: [solution_outline_chat/](solution_outline_chat/README.md) ·
Progress: [PROGRESS.md](PROGRESS.md) ·
Requirements: [docs/requirements-checklist.md](docs/requirements-checklist.md).

## What is in the repo

| Folder | What it is | Port |
|---|---|---|
| `frontend/` | Mobile-first web app (React + Vite + TypeScript), English / हिंदी switch | 5173 |
| `backend/` | The single API the frontend calls (Node + Express + TypeScript) | 4000 |
| `ai-service/` | Python FastAPI service, called only by the backend | 8000 |
| `data/raw/` | Synthetic hackathon data (read-only, never modified) | – |
| `scripts/verify_outline.py` | Checks the outline's bundles and numbers against `data/raw/` | – |

Current state (after step 5): the owner can **chat with an advisor or fill a short form, get a
quote, complete KYC, pay (MOCK) and track the order on their phone**.
- **Advisor chat** (Home → "Chat with our advisor"): type freely in English, Hindi or Hinglish
  ("मेरी जयपुर में किराना दुकान है, 3 लोग") or tap the quick replies. It asks the business type,
  size, locations, city, GSTIN and current tools, recommends a bundle with one monthly price and
  says why each product is there, answers questions ("Can I get SD-WAN?"), and opens the quote.
  "Talk to a person" and "Not for me" save a lead with the reason for the back-office.
- **Quote** (from the chat, or Home → "Get my price" → short form): one monthly price, setup fee,
  contract and ready time, add-on switches that re-price live, greyed-out items with the reason →
  accept → quote reference valid for 7 days.
- **Smart KYC** (accepted quote → "Continue to KYC", or Home → "Complete your KYC"): consent
  screen first (what, why, how long, how to withdraw) → name + GSTIN + Udyam → details filled from
  the **MOCK** GSTIN/Udyam registries → upload only what is still needed → documents read by OCR
  (RapidOCR, offline) → every check in `solution_outline_chat/kyc-validation.md` → **Pass / Fix
  needed / Manual review** with the reasons in plain English or Hindi → **MOCK e-sign** with a
  one-time password shown on screen. "Withdraw consent" deletes everything at any time.
- **Payment and tracker** (KYC done → "Pay and place my order"): **MOCK payment** of the setup fee +
  first month (UPI / card / net banking, no details asked; a MOCK switch makes it fail to show the
  retry) → order `ORD-XXXXXXXX` → tracker: KYC verified → payment received → installation
  scheduled → installed → activated, with the expected date of every product (order date + its
  `typical_install_days`) and of the whole bundle (the slowest product), plus an update at each
  stage. Home → "Track my order" opens it again by reference, so there is no need to call.

Every product and price comes from the backend **catalogue rules engine**. The AI helper
(Gemini, optional) only reads the owner's messages and rewords the engine's facts; every sentence
it writes is checked before it is shown, and without a key the advisor runs in **basic mode** on
its own rules. KYC decisions are made by fixed rules too (no AI).

Behind the scenes (step 6) a **lead propensity model** scores how likely a lead is to activate
(0-100, with the top 3 reasons): logistic regression trained on `smb_leads.csv` without any
column that gives the outcome away; test AUC **0.670** (report: [docs/propensity-report.md](docs/propensity-report.md)).

The **staff back-office** (step 7, http://localhost:5173/backoffice) shows sales and partners the
leads the advisor could not close (reason, masked phone, propensity score and next action),
the past quarter's dropped leads from `smb_leads.csv` ranked by score, the **KYC exceptions
queue** where the operations desk approves or rejects manual-review cases, and **partner
attribution**: a partner's link `/?ref=PTR-01` follows the customer from the chat or quote to
KYC and the order, so the partner is credited even when the customer finishes alone.

Two **add-on features** (branch `feature/add-ons`):
- **One-Sitting Completion + No Dead Ends**: before any upload, the owner sees whether the journey
  can be finished now (Ready / Almost ready / Needs a check by our team / Partner help recommended
  / Not possible as chosen), a readiness percentage ("80% - 4 of 5 verified"), the expected time
  and the install date, and **every problem comes with a fix**: re-upload with photo tips, a one-tap
  "Did you mean ...?" for a misprinted GSTIN, a MOCK signing link for the registered owner, the
  bundle without GSTIN-only products, 5G AirFiber where fibre is not available (MOCK coverage), a
  re-quote. The same blockers show on the tracker and in the back-office, with one-sitting metrics.
- **Time-to-value quote**: every quote shows the bundle, the monthly price, the one-time setup, the
  contract (and which product sets it, e.g. "Remove Secure Wi-Fi for a 6-month contract") and
  "Expected ready in approximately 5 days (by 20 July 2026)", then **"What you can start using,
  and when"** by day with a Day-1 banner ("Start using 4 services from tomorrow ..."). Long
  installations show a service window and a site survey. The same dates (one shared
  `computeTimeline`) appear in the readiness check and on the tracker, which shows planned vs
  actual per product.
- **Privacy inside the journey (DPDP Act 2023)**: lookup first (only the documents the registries
  could not confirm are asked for), a five-section consent listing just those, separate optional
  marketing consent, server-side consent enforcement (403), one masking format everywhere,
  document photos encrypted at rest and deleted on a schedule, a **My data** page (withdraw,
  cancel, delete documents, "Deleted on ...") and the 1-page [privacy note](docs/privacy-note.md).

Architecture diagram: [docs/architecture/](docs/architecture/README.md) (draw.io file + transparent PNG).

## How to run (Windows PowerShell)

Prerequisites: **Node.js 22.12+** and **Python 3.11+** (developed on Node 22.18, Python 3.13).

### 1. One-time setup

Run from the repo root:

```powershell
# Optional: the defaults already work without a .env file (see "Gemini setup" below for the AI key)
Copy-Item .env.example .env

cd backend; npm install; cd ..
cd frontend; npm install; cd ..
cd ai-service; python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements-dev.txt; cd ..
```

The ai-service install includes the document OCR (RapidOCR with its models, about 60 MB in
total). Nothing else needs installing: no Tesseract, no internet needed once installed. **Already
set up before step 4?** Run the `pip install` line again to add the OCR packages.

### 2. Start the app (three terminals, each from the repo root)

```powershell
# Terminal 1: ai-service  -> http://127.0.0.1:8000/health
cd ai-service; .\.venv\Scripts\python -m app
```

```powershell
# Terminal 2: backend     -> http://localhost:4000/api/health
cd backend; npm run dev
```

```powershell
# Terminal 3: frontend    -> open http://localhost:5173
cd frontend; npm run dev
```

Open http://localhost:5173. The "System status" card should show **Working** for both the app
server and the AI service. Tap **Chat with our advisor** and type, for example, "I run a dental
clinic in Kochi with 5 people", then answer the questions (1 location, no GSTIN, mobile hotspot,
email): the advisor recommends **Office Pro at ₹4,215/month** and "See my quote" opens the same
quote. The badge at the top of the chat says **AI helper on** (Gemini) or **Basic mode (no AI)**;
sentences written by Gemini carry a small "AI" label. **Get my price** opens the short form instead. To see the phone layout on a laptop, press F12 and turn on the device
toolbar (Ctrl+Shift+M). Stop any service with Ctrl+C.

**Try the KYC** (lookup first): Home → **Complete your KYC** → enter a GSTIN (or tick "no GSTIN")
and Udyam yes/no → **Look up my business** (or, in the dashed **DEMO** box, choose a sample
applicant K01–K12 from `data/raw/kyc_documents` → **Use this sample**). The **Business record
found** screen shows what the registry knows, how many documents are not needed and a readiness
preview; nothing is stored yet. **Continue** → the consent screen (five sections, listing only the
documents still needed; marketing is a separate, unticked box) → your name → documents. A DEMO
sample uploads every image it has, one by one, through the same upload + OCR path a phone photo
takes (about 2 s per page; the first page also loads the OCR models). The **One-Sitting
Completion** card on top says where you stand and gives a button for each fix:
**K03** Ready → **Sign the agreement**; **K11** Almost ready, 80% → "upload a bill dated on or
after 16 April 2026"; **K06** → "Did you mean 08YK\*\*\*\*\*\*\*\*1ZO?" → one tap → Ready; **K10** →
**Send the signing link (MOCK)** → type the registered owner's code shown → Ready; **K07** needs a
check by our team (within 4 working hours, MOCK) and asks you a question; **K01** with a quote that
has WhatsApp Business API → Not possible as chosen → **Switch to ...** → Ready. **My data** (next
to the reference) shows what is held, each photo's deletion date, and lets you delete the photos,
cancel or withdraw. Leave and come back with Home → **Continue my application** (the last
reference is remembered on the device).

**Try payment and the tracker**: start from a quote (Home → **Get my price** → … → **Accept this
quote** → **Continue to KYC**), do the KYC with sample **K03** and sign, then **Pay and place my
order** → choose UPI → **Pay … (MOCK)**. The tracker shows when each product will be ready (for
Office Pro: SIMs 16 July, fibre 20 July 2026) and the updates; the dashed **MOCK: move to the next
stage** button plays the installation forward on its expected dates. Note the order reference and
use Home → **Track my order** to open it again.

**Try WhatsApp and voice**: Home → **Try it on WhatsApp** → **Use a demo number** → **Open the
chat** → send the pre-filled "Hi" (it carries the partner code when you came from a `?ref=`
link). The **MOCK** WhatsApp bot runs the whole journey in the chat: language → the same
advisor questions (tap the buttons, type, or tap 🎤 and speak) → the bundle card → **Buy this**
→ consent → your name (or **DEMO: sample applicant**, e.g. K03) → photos of the documents it
asks for (📎, or the dashed **DEMO: send K03's photo** button) → the checks → the **MOCK**
one-time password (type it) → **Pay with UPI (MOCK)** → the tracker (**MOCK: next stage**).
Type **status** at any time, **help** for the commands, **stop** to delete your KYC details and
the chat. 🔊 reads replies aloud. **Voice** (🎤, also on the advisor chat): tap it and speak; the
words appear in the text box as you speak, nothing is sent until you press **Send**, so you can
correct them first. Tap the mic again (■), **Stop**, or press Esc to stop at any time. Voice needs a
browser with speech recognition (Chrome or Edge, online: they use their own speech service) and
microphone permission; elsewhere the mic is hidden and typing works as usual.

**Try the add-ons in the back-office**: as **Operations desk**, **KYC exceptions** shows each case's
readiness and blockers (with the owner's answers) and **Stored document photos** (decrypted only
for this role, every view logged); the **One sitting** tab shows journeys completed in one
sitting, blockers resolved without staff and alternatives accepted, and runs the **retention
job** "as of" a later date (DEMO: 2026-08-14 deletes photos verified on 15 July).

**Try the back-office**: open http://localhost:5173/backoffice (or the **Staff back-office**
link at the bottom of Home) and pick a **MOCK** demo account (no password):
- **Operations desk** (`ADM-01`) sees everything. In **KYC exceptions**, a K07 or K10 case
  that went to manual review can be approved (the owner can then sign and pay) or rejected
  with a note the owner sees. Approval never unlocks products that need an Active GSTIN (K01).
- **Field sales** (`SLS-01`, `SLS-02`) see **Advisor leads** (filter by score band, reason,
  segment, city, partner, follow-up, owner; set the status and the owner) and **Past quarter**
  (4,632 dropped leads, best score first, 25 a page, filters). No KYC data.
- **Channel partners** (`PTR-01`, `PTR-02`) see only the leads they referred, their credit
  (quotes, KYC, orders, monthly value) and their referral link. Open
  http://localhost:5173/?ref=PTR-01 to start a referred journey: Home shows "Referred by
  Shree Mobile Point".

Scores need the ai-service; without it the lists still work and say the scores are unavailable.
Leads, cases and orders live in memory, so restarting the backend empties them.

Expected results with the One-Sitting Completion card (all 12 checked by tests; the KYC check
result is in brackets):

| Applicant | Readiness | Why, and the fix offered |
|---|---|---|
| K01 | Not possible as chosen (pass) | GSTIN **Cancelled**: products that need an active GSTIN are blocked; one tap switches to the bundle without them, then Ready. The blank Udyam certificate is optional, never blocking |
| K02 | Ready (pass) | GST certificate is rotated: straightened before OCR |
| K03, K08, K09, K12 | Ready (pass) | (only soft notes, e.g. the Udyam registration date) |
| K04 | Almost ready (fix needed) | GST certificate blurred: re-upload, with photo tips |
| K05 | Ready (pass) | Udyam certificate missing: optional; adding the number for lookup is offered |
| K06 | Almost ready (fix needed) | GSTIN on the certificate fails the checksum: "Did you mean 08YK\*\*\*\*\*\*\*\*1ZO (Pooja Shah ...)?" one-tap confirm, then Ready |
| K07 | Needs a check by our team (manual review) | Legal name on the certificate differs from the registry: our team checks within 4 working hours (MOCK) and asks the owner a question |
| K10 | Needs a check by our team (manual review) | Signatory is not the registered owner: MOCK signing link to the owner; once signed, Ready |
| K11 | Almost ready, 80% (fix needed) | Electricity bill 257 days old: "upload a bill dated on or after 16 April 2026" |

### Gemini setup (optional AI helper for the advisor)

The advisor works without any key (basic mode). With a Gemini key it understands free-form
messages better and words its explanations naturally. The key stays on your computer: only the
ai-service reads it, it is never sent to the browser, never logged and never committed.

1. Go to **https://aistudio.google.com**, sign in with a Google account, click **Get API key** →
   **Create API key**, and copy it. The free plan is enough for a demo.
2. Create your private settings file once (repo root), then open it:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
3. Paste the key after `GEMINI_API_KEY=` (no quotes, no spaces) and save. Leave
   `GEMINI_MODEL=gemini-3.5-flash-lite` unless you want another model (it must be one your key
   can use; `gemini-3.8-flash` works but is slow on the free plan).
4. Restart the ai-service (Terminal 1: Ctrl+C, then `.\.venv\Scripts\python -m app`). Its first
   log line says `"advisorLlm": "gemini (gemini-3.5-flash-lite)"`.
5. Check (backend running):
   ```powershell
   Invoke-RestMethod http://localhost:4000/api/advisor/status
   ```
   `mode: gemini` = on. `mode: basic` with `reason: GEMINI_API_KEY is not set` = no key found.

**New key later**: replace the value in `.env`, save, restart the ai-service. **Teammates and
judges** use their own key in their own `.env` (or none: everything works in basic mode).

What happens when Gemini is not available:

| Situation | What the advisor does |
|---|---|
| No key / key rejected | Basic mode: rule-based understanding and sentences, same recommendations |
| Free-plan quota used up (HTTP 429) | Answers by its rules and pauses Gemini for the time Google asks (at least 60 s) |
| Gemini slow (over `GEMINI_TIMEOUT_SECONDS`) or a server error | Answers that message by its rules; tries Gemini again after 10–15 s |
| Gemini writes something wrong (a product the rules did not allow, a price not from the catalogue, a discount, a link, the wrong language) | That sentence is thrown away and the advisor's own sentence is shown |

To save free-plan quota, short plain answers ("5", "Kochi", "no") and quick-reply taps are
handled by the rules without calling Gemini.

**Privacy on the free plan**: Google may use what is sent on its free plan to improve its models,
so the advisor sends only business facts (type, size, city, GSTIN yes/no, tools) and the owner's
message with every GSTIN, Udyam, ID, phone number and email masked. Names, documents and phone
numbers left for a call back are never sent.

### 3. Run the tests

```powershell
cd backend; npm test; npm run typecheck; cd ..
cd frontend; npm test; npm run build; cd ..
cd ai-service; .\.venv\Scripts\python -m pytest; cd ..
python scripts/verify_outline.py
```

The frontend tests start the real backend code in-process (so the screens are tested against the
real rules and prices), which means `npm install` must have been run in `backend/` first.
No test calls Gemini or uses your credits: the AI behaviour is tested with fake models, including
one that tries to recommend ineligible products, invent prices and add links (all rejected). The
21 advisor scenarios (R2.10) are in `backend/tests/advisor/scenarios.test.ts`.

KYC: one test per applicant K01–K12 in `backend/tests/kyc/samples.test.ts`. They use what the
OCR really reads from the sample images, saved in `ai-service/tests/fixtures/kyc_readings.json`;
the ai-service tests (`tests/test_kyc.py`, about 80 s) run the real OCR on all 47 images and fail
if that file no longer matches. After changing the OCR code, rewrite it with
`cd ai-service; .\.venv\Scripts\python -m app.kyc.fixture; cd ..`.

Propensity model: `ai-service/tests/test_propensity.py` retrains it and checks the committed
`ai-service/models/propensity.json` is exactly what the data produces, that scrambling every
leakage column changes nothing, and that scoring from the JSON equals scikit-learn. To retrain
(rewrites the model and `docs/propensity-report.md`):
`cd ai-service; .\.venv\Scripts\python -m app.propensity.train; cd ..`.

WhatsApp and voice: `backend/tests/channels/whatsapp.test.ts` (whole journeys in chat in English
and Hindi: K03 pass → e-sign → payment → tracker, K10 manual review approved in the back-office,
K11 fix needed, typed details with a bad GSTIN, call back only with a yes, stop deletes the
KYC case; no phone, OTP or message text in the log) and `frontend/src/whatsappFlow.test.tsx`
(the simulator end to end, voice notes with a stand-in speech engine, the advisor's mic).
`frontend/src/i18n/channelText.test.ts` checks the bot uses the app's wording word for word
(`backend/src/channels/sharedText.ts` is generated: `cd backend; npx tsx scripts/sync-channel-text.ts; cd ..`).

Time to value: `backend/tests/timeline/timeline.test.ts` (Office Pro 5 days / 12 months / Day 1 =
P07 P16 P17 P20; Micro starter 3 days / 12 months because of P22; Chain Connect 14 / 24; Factory
Connect 21 / 24; a dependent product never before its base link over many profiles; the same dates
in quote, readiness check and tracker) and `frontend/src/timeToValue.test.tsx`.

Add-ons: `backend/tests/readiness/readiness.test.ts` (K01-K12 each give the expected state, blocker
and fix through the API; lookup preview; partner assistance; MOCK coverage; expired quote;
every blocker has an action in both languages; save and return; metrics),
`backend/tests/privacy/privacy.test.ts` (consent purposes and 403 after withdrawal, lookup lists
only needed documents, masking and log redaction, encrypted files on disk, deletion, retention job,
withdrawal stops activation), `frontend/src/kycFlow.test.tsx` and `frontend/src/addonsFlow.test.tsx`
(the screens: lookup, five-section consent, readiness fixes, My data, resume, tracker, back-office).

Back-office: `backend/tests/backoffice/` (sign-in and roles, partner attribution end to end,
scoring inputs, filters, the past-quarter list against the CSV, KYC approve / reject / lapse,
Active-GSTIN rule after approval) and `frontend/src/backofficeFlow.test.tsx` (the screens
against the real backend; only the Python model is replaced by a fake).

### Try the API (backend running)

| Endpoint | What it does |
|---|---|
| `GET /api/catalogue` | All 25 products from `data/raw/product_catalogue.csv` |
| `GET /api/bundles/templates` | The 5 segment bundles (micro standard + lite, prof, multi, mfg) |
| `POST /api/eligibility` | `{ profile, productIds }` → eligible or not, with reasons, per product |
| `POST /api/bundles/build` | `{ segment, variant?, profile }` → eligible bundle, price, removed lines, add-ons |
| `GET /api/cities` | The 22 cities in the data, with their tier |
| `POST /api/quote` | `{ segment, variant?, profile, exclude?, include? }` → live quote; `422` with reasons if a change breaks a rule |
| `POST /api/quotes` | Same body (+ `attributionCode?`, e.g. `PTR-01`) → quote recomputed on the server and accepted (`Q-XXXXXXXX`, valid 7 days from 2026-07-15) |
| `GET /api/quotes/:id` | An accepted quote (kept in memory until the backend restarts) |
| `GET /api/advisor/status` | Is the AI helper on? (`mode: gemini` with the model, or `mode: basic`; never the key) |
| `POST /api/advisor/sessions` | `{ lang: "en" or "hi", attributionCode? }` → new chat: greeting and the first question |
| `POST /api/advisor/sessions/:id/messages` | `{ lang, text }` or `{ lang, choice }` → advisor reply (messages, quick replies, recommendation) |
| `POST /api/advisor/sessions/:id/lead` | `{ reason, phone?, callbackConsent?, note? }` → lead the advisor could not close (`AL-XXXXXXXX`) |
| `POST /api/kyc/cases` | `{ consent: { accepted: true, version: "kyc-consent-v2", purposes: [the 5 purposes], marketing? }, lang, channel?, quoteId?, attributionCode? }` → new KYC case (`KYC-XXXXXXXX`); `400` without consent or without every purpose named |
| `GET /api/kyc/cases/:id` | The case: masked business details, registry details, documents read, result |
| `PUT /api/kyc/cases/:id/business` | `{ applicantName, gstin or null, hasUdyam, udyamNumber? }` (GSTIN format + checksum checked) or `{ sampleId: "K01" }` (DEMO) → lookups |
| `PUT /api/kyc/cases/:id/documents/:docType` | Body = the image (`image/png`, `image/jpeg`, `image/webp`, ≤ 8 MB); `docType` = `gst_certificate`, `udyam_certificate`, `signatory_id` or `address_proof` → OCR + checks |
| `DELETE /api/kyc/cases/:id/documents/:docType` | Remove an uploaded document |
| `POST /api/kyc/cases/:id/submit` | "Check my documents" → `pass`, `fix_needed` or `manual_review` with the issues |
| `POST /api/kyc/cases/:id/esign/start` · `/esign/verify` | **MOCK** e-sign: agreement + one-time password (shown, not sent) → `{ otp }` signs |
| `DELETE /api/kyc/cases/:id` | Withdraw consent: the case and all its data are deleted |
| `GET /api/lookup/gstin/:gstin` · `GET /api/lookup/udyam/:number` | **MOCK** registry lookups (`mock_gstin_registry.csv`, `mock_udyam_registry.csv`), numbers masked |
| `GET /api/kyc/samples` · `/api/kyc/samples/:id/documents/:docType` | DEMO: the 12 sample applicants and their document images |
| `GET /api/propensity/model` | Lead propensity model card: inputs, excluded leakage columns, test AUC, bands |
| `POST /api/propensity/score` | `{ leads: [{ id?, lead: { lead_source: "Referral", has_gstin: "Y", ... } }] }` (1-500; missing inputs count as average) → score 0-100, band, top 3 reasons |
| `GET /api/propensity/leads/:leadId` | Score of a lead in `smb_leads.csv`, e.g. `L00001` |
| `GET /api/orders/checkout/:caseId` | What is due now for a signed KYC case (setup + first month) and whether it can be paid |
| `POST /api/orders` | `{ caseId, method: "upi" or "card" or "netbanking", simulateFailure? }` → **MOCK** payment → order (`ORD-XXXXXXXX`); `402` for a simulated failure, `409` with the reason if it cannot be paid |
| `GET /api/orders/:orderId` | Order status: stages with done / expected dates, each product's expected date, updates (no personal data) |
| `POST /api/orders/:orderId/advance` | **MOCK**: the next stage happens on its expected date (demo) |
| `GET /api/partners/:code` | Name of a partner / sales referral code (`PTR-01`, `SLS-01`, ...) |
| `GET /api/backoffice/accounts` · `POST /api/backoffice/session` | **MOCK** staff sign-in: demo accounts → `{ staffCode }` → token (send as `Authorization: Bearer ...`, 8 hours) |
| `GET /api/backoffice/leads` | Leads the advisor could not close + reason, masked phone, attribution, score + next action; filters `reason`, `segment`, `city`, `attribution`, `band`, `status`, `assignedTo` (partners: their own only) |
| `PATCH /api/backoffice/leads/:leadId` | `{ status?: new / contacted / converted / lost, assignedTo? }` follow-up |
| `GET /api/backoffice/crm-leads` | Past-quarter dropped leads (`smb_leads.csv`) by score, 25 a page; filters `segment`, `city`, `source`, `reason`, `stage`, `band`, `page` (admin, sales) |
| `GET /api/backoffice/kyc` · `POST /api/backoffice/kyc/:caseId/review` | KYC exceptions queue; `{ decision: approved / rejected, note? }` (operations desk only) |
| `GET /api/backoffice/attribution` | Leads, quotes, KYC cases, orders and monthly value per partner / sales code |
| `POST /api/channels/whatsapp/messages` | **MOCK** WhatsApp webhook: header `x-wa-from: <mobile>`, body `{ text, voice? }` or `{ buttonId }` → the bot's replies (text, buttons, lists) |
| `GET /api/privacy/retention` | Retention periods (one config, marked proposed) and the five consent purposes |
| `POST /api/kyc/lookup` | Before consent, nothing stored: `{ gstin, hasUdyam, udyamNumber?, quoteId? }` or `{ sampleId }` → masked registry record, documents still needed, readiness preview |
| `POST /api/kyc/cases/:id/resume` · `GET /api/kyc/cases/:id/my-data` | Save and return; My data (masked holdings, purposes, deletion countdown, deletion log) |
| `POST /api/kyc/cases/:id/documents/delete` · `DELETE /api/kyc/cases/:id?cancel=true` | Delete the photos now (the result is kept); cancel the application (same deletion as withdrawing) |
| `POST /api/kyc/cases/:id/alternative` · `/gstin-suggestion` · `/authorisation` · `/authorisation/sign` · `/answers` | No Dead Ends fixes: switch to the offered bundle `{ kind }`, confirm "Did you mean", MOCK signing link for the registered owner, answer the team's question `{ blockerId, answer }` |
| `GET /api/backoffice/metrics` · `POST /api/backoffice/retention/run` · `GET /api/backoffice/kyc/:caseId/documents/:docType` | One-sitting metrics (admin, sales); retention job `{ asOf? }` and a stored photo (operations desk only) |
| `POST /api/channels/whatsapp/photo` | **MOCK** WhatsApp photo: header `x-wa-from`, body = the image (`image/png`, `image/jpeg`, `image/webp`, ≤ 8 MB) → read by OCR for the document the bot asked for |

A `profile` is `{ "cityTier": 1 or 2, "employees": n, "sites": n, "gstin": "active" | "inactive" | "none" }`.

```powershell
$chat = Invoke-RestMethod http://localhost:4000/api/advisor/sessions -Method Post -ContentType "application/json" -Body '{"lang":"en"}'
$reply = Invoke-RestMethod "http://localhost:4000/api/advisor/sessions/$($chat.sessionId)/messages" -Method Post -ContentType "application/json" `
  -Body '{"lang":"en","text":"I run a dental clinic in Kochi with 5 people"}'
$reply.messages | Select-Object source, text
```

```powershell
# KYC: consent, a sample applicant's details, one real document through the OCR, then the result.
$kyc = Invoke-RestMethod http://localhost:4000/api/kyc/cases -Method Post -ContentType "application/json" `
  -Body '{"consent":{"accepted":true,"version":"kyc-consent-v2","purposes":["identity_verification","product_eligibility","order_activation","electronic_signing","manual_review"]},"lang":"en"}'
$case = "http://localhost:4000/api/kyc/cases/$($kyc.caseId)"
Invoke-RestMethod "$case/business" -Method Put -ContentType "application/json" -Body '{"sampleId":"K11"}' | Out-Null
$r = Invoke-RestMethod "$case/documents/address_proof" -Method Put -ContentType "image/png" -InFile "data\raw\kyc_documents\K11_address_proof.png"
$r.documents.address_proof.read | Format-List
$r.result.issues | ForEach-Object { "$($_.code) ($($_.severity)): $($_.params | ConvertTo-Json -Compress)" }
```

```powershell
Invoke-RestMethod http://localhost:4000/api/bundles/build -Method Post -ContentType "application/json" `
  -Body '{"segment":"multi","profile":{"cityTier":2,"employees":15,"sites":3,"gstin":"active"}}' |
  Select-Object name, @{n="monthly";e={$_.price.monthlyInr}}, @{n="setup";e={$_.price.setupInr}}, @{n="months";e={$_.price.contractMonths}}
```

### Configuration

All services read the `.env` in the repo root (see `.env.example`): `BACKEND_PORT`,
`AI_SERVICE_PORT`, `AI_SERVICE_URL`, `FRONTEND_PORT`, `LOG_LEVEL`, and for the advisor's AI
helper `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` (see "Gemini setup"), and for
the encrypted KYC photos `DOCUMENT_ENCRYPTION_KEY` (64 hex characters; make one with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; without it a random
key is used for that run) and `DOCUMENT_STORE_DIR` (default `backend/var/documents`, git-ignored). `.env` is
git-ignored; never commit secrets. Check with `git status` that `.env` is never listed.

### Privacy in logs

The backend and the ai-service write JSON log lines in which GSTIN, Udyam, ID, Aadhaar, PAN,
phone numbers and emails are masked (one format everywhere: GSTIN `27XU********1ZP`, Udyam / ID /
phone the last 4), and request bodies, documents and images are never logged. Gemini calls log only the model, task, outcome, time and token counts,
never the prompt, the reply or the key.

KYC documents: the ai-service reads the image in memory and keeps nothing; the backend stores
the photo encrypted (AES-256-GCM, key from `.env`) and deletes it 30 days after verification, at
once on the owner's request or withdrawal, or when the retention job runs. Log lines have only the
document type, whether it was readable and the time. The app and the API show GSTIN, Udyam, ID and
consumer numbers only masked. Withdrawing consent deletes all KYC data immediately (the consent
record and the deletion log stay as proof) and stops an order that is not activated yet; the
rest of the KYC data is in memory and also disappears when the backend restarts. See
[docs/privacy-note.md](docs/privacy-note.md). Orders hold no names or identifiers, and the MOCK payment asks for no
card or UPI details (only the method and the amount are kept).

### Troubleshooting

- **"port … is already in use"**: another copy is still running. Close it, or change the port in `.env`.
- **npm error "Cannot read properties of null (reading 'edgesOut')"**: run `npm install` inside
  `backend/` or `frontend/`, where the `.npmrc` (`legacy-peer-deps=true`) avoids this npm 10.9 bug.
- **System status shows "Not reachable" for the AI service**: start Terminal 1 first, then press
  "Check again".
- **The chat says "Basic mode" although the key is in `.env`**: restart the ai-service after
  saving `.env`; check the key has no quotes or spaces and look at the `reason` in
  `/api/advisor/status`. A free-plan quota error switches to basic mode for about a minute, then
  Gemini is tried again.
- **`Configuration error: GEMINI_MODEL …`**: the model name in `.env` has a typo; use
  `gemini-3.5-flash-lite`.
- **KYC upload says "We cannot read documents right now"**: the ai-service is not running, or
  its OCR packages are missing. Start Terminal 1; if it was set up before step 4, run
  `cd ai-service; .\.venv\Scripts\python -m pip install -r requirements-dev.txt; cd ..` once.
- **The first KYC document takes a few seconds longer**: the OCR models load on first use.
