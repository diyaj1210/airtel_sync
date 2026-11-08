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

Current state (after step 3): the owner can **chat with an advisor or fill a short form, then
get a quote on their phone**.
- **Advisor chat** (Home → "Chat with our advisor"): type freely in English, Hindi or Hinglish
  ("मेरी जयपुर में किराना दुकान है, 3 लोग") or tap the quick replies. It asks the business type,
  size, locations, city, GSTIN and current tools, recommends a bundle with one monthly price and
  says why each product is there, answers questions ("Can I get SD-WAN?"), and opens the quote.
  "Talk to a person" and "Not for me" save a lead with the reason for the back-office.
- **Quote** (from the chat, or Home → "Get my price" → short form): one monthly price, setup fee,
  contract and ready time, add-on switches that re-price live, greyed-out items with the reason →
  accept → quote reference valid for 7 days.

Every product and price comes from the backend **catalogue rules engine**. The AI helper
(Gemini, optional) only reads the owner's messages and rewords the engine's facts; every sentence
it writes is checked before it is shown, and without a key the advisor runs in **basic mode** on
its own rules. KYC and the tracker arrive in steps 4–8.

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

A `profile` is `{ "cityTier": 1 or 2, "employees": n, "sites": n, "gstin": "active" | "inactive" | "none" }`.

```powershell
$chat = Invoke-RestMethod http://localhost:4000/api/advisor/sessions -Method Post -ContentType "application/json" -Body '{"lang":"en"}'
$reply = Invoke-RestMethod "http://localhost:4000/api/advisor/sessions/$($chat.sessionId)/messages" -Method Post -ContentType "application/json" `
  -Body '{"lang":"en","text":"I run a dental clinic in Kochi with 5 people"}'
$reply.messages | Select-Object source, text
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
