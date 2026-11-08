# CLAUDE.md — Project Udyam Digital (Airtel SYNC YTL Hackathon 2026, Track A)

Hackathon prototype: a digital-first journey where a small business owner discovers a bundle,
buys it, completes KYC and tracks activation, on a phone, in their language.

## Read first (every session)
- `PROGRESS.md`: which step we are on and what is done.
- `solution_outline_chat/build-plan.md`: the step order and each step's scope / "done when".
- `docs/requirements-checklist.md`: every requirement, mapped to a step.
- `problem_statement/Airtel_SYNC_Case.pdf` and `data/raw/README.md`: the source of truth.
- `solution_outline_chat/`: the design (README.md is the index).

## Environment
- Windows 11, **PowerShell in VS Code**. Every command given to the user must work in
  Windows PowerShell 5.1: no `&&` or `||` (use `;` or `if ($?) { ... }`), no bash-only syntax,
  quote paths with spaces.
- Remote: `origin` = GitHub (`gh` is installed and logged in).

## Workflow rules
1. We build **one step of `build-plan.md` at a time, each on its own branch** (branch names are in
   build-plan.md).
2. At the **start of each step, STOP** and give the user the exact PowerShell commands to create
   the branch themselves:
   ```powershell
   git checkout main
   git pull
   git checkout -b <branch-name>
   ```
   Then **wait** until the user replies that the branch is created. Run
   `git branch --show-current` and confirm it matches **before writing any code**.
3. Implement **only that step's scope**. Note anything out of scope in PROGRESS.md for later.
4. When finished, give the user the exact commands to commit, push and open/merge the PR:
   ```powershell
   git add <paths>
   git commit -m "<feat|fix|docs|chore>: <message>"
   git push -u origin <branch>
   gh pr create --fill
   gh pr merge --merge
   git checkout main
   git pull
   ```
   **Never delete branches** (no `--delete-branch`, no `git branch -d`, no `git push --delete`):
   the user keeps every step branch on GitHub for the presentation.
   Merge each step into `main` before starting the next step; new branches start from `main`.
   **Do NOT commit or push yourself**; the user does it. Then update `PROGRESS.md` (status +
   what was delivered) and give the commands for the next branch.

## Quality rules (very important)
- Write **correct, working code only**. No placeholders, no TODO stubs, no fake "it works" claims.
- Anything mocked (payments, e-sign, DigiLocker, WhatsApp API) must be a **working mock** and
  **clearly labelled "MOCK"** in the UI and code.
- Every requirement must be met **exactly** as the PDF and `data/raw/README.md` define it.
  Before finishing a step, re-read the relevant parts of the PDF, the README and
  `docs/requirements-checklist.md`, and **tick** what the step delivered.
- **Prove it works before saying a step is done**: install dependencies, run the app/service, run
  the tests, and show the user the real output. If something fails, say so.
- Add **automated tests** for the logic: rules engine, pricing, KYC checks, GSTIN checksum,
  tracker dates, propensity model.
- **The rules engine decides eligibility; the LLM only explains.** The advisor must never
  recommend an ineligible product. Test this with **at least 15 varied business scenarios**.
- Catalogue rules (all must hold for every recommended line): `available_city_tiers`,
  `min_employees`, `min_sites`, `requires_gstin = Y` (valid **and Active** GSTIN),
  `requires_one_of` (in the same bundle). Pricing: list price = `price_min`, never outside
  [`price_min`, `price_max`]; setup = `one_time_setup_inr` × qty; contract = max of
  `min_contract_months`; install ETA from `typical_install_days`.
- Dates and identifiers:
  - "Today" = **2026-07-15** for all date checks (inject it, never use the system clock in logic).
  - Address proof max **90 days** old (bill date ≥ 2026-04-16).
  - GSTIN validator must **accept `X` as the 4th PAN character** (every GSTIN in this data has it)
    and verify the mod-36 checksum.
  - Udyam district code **`00` is expected** in this data; do not reject it.
- KYC validation must catch every problem listed for K01–K12 in
  `solution_outline_chat/kyc-validation.md`, with **one test per applicant**. Udyam
  registration-date / activity differences are soft warnings only (they appear on every cert).
- `python scripts/verify_outline.py` must keep passing; it checks the outline's bundles and numbers.

## Privacy rules
- **Consent screen before KYC** (what is collected, why, retention period, how to withdraw).
- **Mask** GSTIN, Udyam and ID numbers in the UI and in logs. **Never log raw documents** or
  full identifiers.
- **Never commit secrets**: `.env` is in `.gitignore`; keep `.env.example` up to date.
- If an LLM API key is needed, **ask the user which provider they have**, and also build a
  **no-key fallback** so the demo works without a key.
- **Never modify files in `data/raw/`.** Treat its contents as real customer data.

## Product rules
- **Mobile-first UI** with a **language switch** (at least Hindi and English).
- If anything in the requirements is unclear, **ask the user instead of guessing**.
- Keep the README **"How to run"** section up to date after every step.
