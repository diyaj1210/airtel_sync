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

Current state (after step 2): the owner can **get a quote on their phone**: Home → "Get my
price" → a short form (type of business, city, people, locations, GSTIN) → a quote with one
monthly price, setup fee, contract and ready time, add-on switches that re-price live, and greyed-
out items that explain why (e.g. "Needs an active GSTIN", "Can't remove: needed by …") → accept →
quote reference valid for 7 days. English and हिंदी. Every price and rule comes from the backend
**catalogue rules engine**. The advisor chat, KYC and tracker arrive in steps 3–8.

## How to run (Windows PowerShell)

Prerequisites: **Node.js 22.12+** and **Python 3.11+** (developed on Node 22.18, Python 3.13).

### 1. One-time setup

Run from the repo root:

```powershell
# Optional: the defaults already work without a .env file
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
server and the AI service. Tap **Get my price** to try the quote journey; for example, an office
or clinic in Kochi with 5 people, 1 location and no GSTIN gets **Office Pro at ₹4,215/month**. To see the phone layout on a laptop, press F12 and turn on the device
toolbar (Ctrl+Shift+M). Stop any service with Ctrl+C.

### 3. Run the tests

```powershell
cd backend; npm test; npm run typecheck; cd ..
cd frontend; npm test; npm run build; cd ..
cd ai-service; .\.venv\Scripts\python -m pytest; cd ..
python scripts/verify_outline.py
```

The frontend tests start the real backend code in-process (so the screens are tested against the
real rules and prices), which means `npm install` must have been run in `backend/` first.

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

A `profile` is `{ "cityTier": 1 or 2, "employees": n, "sites": n, "gstin": "active" | "inactive" | "none" }`.

```powershell
Invoke-RestMethod http://localhost:4000/api/bundles/build -Method Post -ContentType "application/json" `
  -Body '{"segment":"multi","profile":{"cityTier":2,"employees":15,"sites":3,"gstin":"active"}}' |
  Select-Object name, @{n="monthly";e={$_.price.monthlyInr}}, @{n="setup";e={$_.price.setupInr}}, @{n="months";e={$_.price.contractMonths}}
```

### Configuration

All services read the `.env` in the repo root (see `.env.example`): `BACKEND_PORT`,
`AI_SERVICE_PORT`, `AI_SERVICE_URL`, `FRONTEND_PORT`, `LOG_LEVEL`. `.env` is git-ignored; never
commit secrets.

### Privacy in logs

The backend and the ai-service write JSON log lines in which GSTIN, Udyam, ID, Aadhaar, PAN,
phone numbers and emails are masked (e.g. `27XUIX******1ZP`), and request bodies, documents and
images are never logged.

### Troubleshooting

- **"port … is already in use"**: another copy is still running. Close it, or change the port in `.env`.
- **npm error "Cannot read properties of null (reading 'edgesOut')"**: run `npm install` inside
  `backend/` or `frontend/`, where the `.npmrc` (`legacy-peer-deps=true`) avoids this npm 10.9 bug.
- **System status shows "Not reachable" for the AI service**: start Terminal 1 first, then press
  "Check again".
