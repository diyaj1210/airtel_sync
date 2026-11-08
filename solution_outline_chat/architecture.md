# Architecture

## Components
```
 [Owner: mobile web/app]   [WhatsApp simulator / voice]   [Partner & back-office UI]
            \                         |                           /
             +---------------- API Gateway (backend) ------------+
                                      |
   +-----------+-----------+----------+-----------+------------+-----------+
   | Advisor   | Catalogue | Quote    | KYC       | Order &    | Leads &   |
   | orchestr. | + Rules   | service  | service   | Tracker    | Backoffice|
   +-----+-----+-----------+----------+-----+-----+------+-----+-----+-----+
         |                                  |            |           |
   +-----v------------------+     +---------v----+  +----v-----+ +---v--------+
   | ai-service (Python)    |     | Mock GSTIN / |  | Events   | | Propensity |
   | LLM + RAG on catalogue |     | Udyam lookup |  | (status  | | model      |
   | OCR + doc parsing      |     | (CSV-backed) |  | updates) | | /score     |
   +------------------------+     +--------------+  +----------+ +------------+
                                      |
                              [Database + document store (encrypted)]
```

## Data flow (happy path)
1. Owner chats → ai-service extracts profile JSON (type, employees, sites, city tier, GSTIN, current internet)
2. Backend rules engine → eligible products → segment bundle → quote
3. ai-service writes plain-language explanation in owner's language (only from the given bundle)
4. Owner toggles add-ons → quote service re-validates and re-prices
5. Consent → GSTIN/Udyam lookup → document OCR → validation result
6. Order created → stage events → tracker + WhatsApp notifications
7. Unclosed / failed leads → back-office queue with propensity score

## Prototype stack (hackathon-friendly)
| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, mobile-first, i18n (Hindi/English + 1–2 regional) |
| Backend | Node.js + Express + TypeScript |
| AI service | Python FastAPI; LLM API for chat + explanation, with a deterministic no-key fallback so the demo runs without a key; OCR with RapidOCR (pip-installable, offline: the models ship in the wheel; chosen in step 4 over Tesseract, which needs a separate install, and a vision LLM, which would send customer documents out); scikit-learn for propensity |
| Data | SQLite or JSON for prototype; CSVs loaded at startup for registries & catalogue |
| Events | In-process event emitter (prototype) |

## Production version (to show in the deck — Airtel-style stack)
Java/Spring Boot or Node microservices · React / React Native · Kafka for order events ·
Redis for lookup cache & chat sessions · MongoDB/Cassandra for leads & orders ·
Elasticsearch for catalogue search · observability (logs/metrics/tracing) · CI/CD.

## Key design decisions
- **Deterministic rules engine + LLM for language** → no hallucinated or ineligible products.
- **One backend, many front doors** (app, WhatsApp, partner assist).
- **Lookup before upload** → fewer documents, faster KYC.
- **Privacy by design** → masking, encryption, retention limits, consent log.
