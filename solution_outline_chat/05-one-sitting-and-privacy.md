# Add-ons: One-Sitting Completion, privacy inside the journey, time to value

The case subtitle is "making small businesses go digital **in one sitting**". Two add-ons make that
visible to the owner and keep the KYC data minimal (DPDP Act 2023). Both are built on branch
`feature/add-ons`.

## A1. One-Sitting Completion + No Dead Ends
- **When**: right after the quote and the GSTIN entry, before any upload (registry lookups, rules
  engine, MOCK coverage, documents still needed), and again after every upload or fix.
- **States** (for the selected bundle, by precedence): Not possible as chosen (always with an
  alternative or save-and-return) > Partner help recommended (leased line, SD-WAN, 3+ sites,
  over Rs 10,000 a month, install 14+ days; the owner can still finish online) > Needs a check by
  our team (says what, who, when: within 4 working hours, MOCK) > Almost ready > Ready.
- **Readiness %**: verified groups out of the applicable ones: business details, GSTIN (if needed
  or given), signatory identity, address proof, service feasibility. Udyam is never counted (no
  product needs it). It is a completion check, not an approval or a risk score.
- **Blockers**: `{id, category, customerMessage en/hi, requiredAction, actionType, responsibleParty,
  status, expectedResolution, alternative}`, kept on the application; the tracker and the
  back-office show the same ones. Every blocker has an action.
- **Fixes**: K11 bill too old -> a bill dated on or after 16 April 2026; K01 cancelled GSTIN -> the
  bundle without GSTIN-only products; K06 checksum failure -> "Did you mean ...?" only when the
  near-miss registry record has the certificate's name (no other business's data is ever shown);
  K10 signatory -> MOCK signing link to the registered owner; K04 blurred -> re-upload with photo
  tips; K07 name differs -> review with a question to the owner; K05 Udyam missing -> optional.
- **Metrics** (back-office): journeys completed in one sitting (paid within 60 minutes of consent,
  without leaving), blockers resolved without staff, alternatives accepted.

## A2. Privacy inside the journey
- **Lookup first**: the GSTIN / Udyam number is looked up before consent (public registries,
  nothing stored); the owner sees what was found and how many documents are not needed.
- **Consent**: five short sections (what - only this journey's documents; why - five separate
  purposes; what is optional - Udyam, no Aadhaar, any accepted ID, marketing as a separate unticked
  consent; how long; how to withdraw). The record keeps id, notice version, purposes, language,
  channel and time; the server refuses KYC writes without it (403).
- **Masking**: one utility for UI, API and logs: GSTIN first 4 + last 3, Udyam / ID / phone last 4.
- **Storage**: document photos encrypted (AES-256-GCM, key from `.env`), outside public folders,
  viewable only by the operations desk; retention periods in one config marked "proposed - to be
  confirmed by legal"; a retention job deletes expired photos and logs it.
- **My data**: what is held (masked), purposes, consent date, each photo's deletion date, and
  withdraw / cancel / delete documents, with "Deleted on <date>". Withdrawal stops an order that is
  not activated yet.
- The 1-page note: [docs/privacy-note.md](../docs/privacy-note.md).

## A3. Time-to-value quote + Day-1 value
- **One ETA function** (`backend/src/timeline/timeline.ts`, `computeTimeline`) for the quote, the
  readiness check and the tracker: per product, typical_install_days from the catalogue; a product
  with requires_one_of is never ready before the base link it needs (max of the two); the bundle
  is ready with its latest product; Day-1 products are ready within a day. Start: today when the
  readiness is Ready, one day later when a person must review. Always "approximately".
- **Quote card**: bundle name, monthly price, one-time setup, the contract (= the longest minimum
  contract, naming the product that drives it, e.g. "12 months because of Secure Wi-Fi" with
  "Remove Secure Wi-Fi for a 6-month contract") and "Expected ready in approximately N days (by
  date)". Long or complex installations (leased lines, SD-WAN, managed firewall, machine IoT) show
  a service window ("21-30 days, site survey required") and partner assistance.
- **Value timeline**: "What you can start using, and when", by day, with the banner "Start using N
  services from tomorrow while your internet is being installed."
- **Tracker**: planned vs actual date per product. No fibre at the address (MOCK coverage): the
  5G AirFiber bundle with its own date, or a clear "no fallback".
