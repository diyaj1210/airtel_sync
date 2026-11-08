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
The back-office that shows it to sales comes in step 7.

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

**Try the KYC**: Home → **Complete your KYC** → tick the consent box → in the dashed **DEMO** box
choose a sample applicant (K01–K12 from `data/raw/kyc_documents`) → **Use this sample**. The app
fills in that applicant's details and uploads their document images one by one through the same
upload + OCR path a phone photo takes (about 2 s per page; the first page also loads the OCR
models). For example **K03** passes (then **Sign the agreement** → MOCK one-time password),
**K11** is asked for a recent bill (257 days old) and **K07** goes to manual review (the legal
name on the GST certificate differs from the registry). To upload your own photo, enter the
details yourself and use **Upload photo** on each document.

**Try payment and the tracker**: start from a quote (Home → **Get my price** → … → **Accept this
quote** → **Continue to KYC**), do the KYC with sample **K03** and sign, then **Pay and place my
order** → choose UPI → **Pay … (MOCK)**. The tracker shows when each product will be ready (for
Office Pro: SIMs 16 July, fibre 20 July 2026) and the updates; the dashed **MOCK: move to the next
stage** button plays the installation forward on its expected dates. Note the order reference and
use Home → **Track my order** to open it again.

Expected results (all 12 checked by tests, and live with the real OCR):

| Applicant | Result | Why |
|---|---|---|
| K01 | Manual review | GSTIN **Cancelled** in the registry (GSTIN-only products blocked); blank Udyam certificate not used |
| K02 | Pass | GST certificate is rotated: straightened before OCR |
| K03, K08, K09, K12 | Pass | (only soft notes, e.g. the Udyam registration date) |
| K04 | Fix needed | GST certificate blurred: re-upload |
| K05 | Fix needed | Udyam certificate missing (or enter the Udyam number) |
| K06 | Fix needed | GSTIN on the certificate fails the checksum and differs from the one entered |
| K07 | Manual review | Legal name on the certificate differs from the registry (possible tampering) |
| K10 | Manual review | Signatory is not the applicant, and an LLP has no person to match |
| K11 | Fix needed | Electricity bill 257 days old (more than 90) |

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

### Try the API (backend running)

| Endpoint | What it does |
|---|---|
| `GET /api/catalogue` | All 25 products from `data/raw/product_catalogue.csv` |
| `GET /api/bundles/templates` | The 5 segment bundles (micro standard + lite, prof, multi, mfg) |
| `POST /api/eligibility` | `{ profile, productIds }` → eligible or not, with reasons, per product |
| `POST /api/bundles/build` | `{ segment, variant?, profile }` → eligible bundle, price, removed lines, add-ons |
| `GET /api/cities` | The 22 cities in the data, with their tier |
| `POST /api/quote` | `{ segment, variant?, profile, exclude?, include? }` → live quote; `422` with reasons if a change breaks a rule |
| `POST /api/quotes` | Same body → quote recomputed on the server and accepted (`Q-XXXXXXXX`, valid 7 days from 2026-07-15) |
| `GET /api/quotes/:id` | An accepted quote (kept in memory until the backend restarts) |
| `GET /api/advisor/status` | Is the AI helper on? (`mode: gemini` with the model, or `mode: basic`; never the key) |
| `POST /api/advisor/sessions` | `{ lang: "en" or "hi" }` → new chat: greeting and the first question |
| `POST /api/advisor/sessions/:id/messages` | `{ lang, text }` or `{ lang, choice }` → advisor reply (messages, quick replies, recommendation) |
| `POST /api/advisor/sessions/:id/lead` | `{ reason, phone?, callbackConsent?, note? }` → lead the advisor could not close (`AL-XXXXXXXX`) |
| `GET /api/advisor/leads` | Leads for the back-office, with the reason (phone masked) |
| `POST /api/kyc/cases` | `{ consent: { accepted: true, version: "kyc-consent-v1" }, lang, quoteId? }` → new KYC case (`KYC-XXXXXXXX`); `400` without consent |
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
  -Body '{"consent":{"accepted":true,"version":"kyc-consent-v1"},"lang":"en"}'
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
helper `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` (see "Gemini setup"). `.env` is
git-ignored; never commit secrets. Check with `git status` that `.env` is never listed.

### Privacy in logs

The backend and the ai-service write JSON log lines in which GSTIN, Udyam, ID, Aadhaar, PAN,
phone numbers and emails are masked (e.g. `27XUIX******1ZP`), and request bodies, documents and
images are never logged. Gemini calls log only the model, task, outcome, time and token counts,
never the prompt, the reply or the key.

KYC documents: the image is read by OCR in memory and dropped at once (never written to disk,
never logged); the log line has only the document type, whether it was readable and the time.
The app and the API show GSTIN, Udyam, ID and consumer numbers only masked. Withdrawing consent
deletes the case immediately; in this prototype all KYC data is in memory and also disappears
when the backend restarts. Orders hold no names or identifiers, and the MOCK payment asks for no
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
