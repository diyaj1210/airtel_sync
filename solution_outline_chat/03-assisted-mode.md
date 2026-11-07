# Solution 3 – Partner & Field Assist Mode + Back-Office

**Idea:** Digital adds to the field force and channel partners instead of competing with them
(Key question 4). Same tool, an "assist mode" login.

## Roles
| Deal size | Who closes it |
|---|---|
| < ₹5k/month (micro, small professional) | Fully self-serve (Sol 1/2); partner earns commission if they referred |
| ₹5k–10k/month | Self-serve, partner/field can step in on request |
| > ₹10k/month (multi-site, manufacturers) | Field sales assisted — they earn ₹16k–28k/month, worth a visit |

## Features
- **Assist mode**: partner/sales fills the advisor at the counter; quote + consent link sent to
  owner's phone; owner consents and pays themselves (consent must come from the owner).
- **Attribution code**: every partner/sales exec has a code; commission even if the customer
  finishes later on their own.
- **Back-office dashboard** (stretch goal):
  - Leads the advisor could not close + the reason (price, wants human, KYC failed, not feasible)
  - Propensity score (Solution 4) and suggested next action
  - Filter by city, segment, partner; assign to a sales exec
  - KYC exceptions queue for manual review

## How it is implemented
- `role` on user: `owner | partner | sales | admin`
- Leads table with `status`, `stall_reason`, `assigned_to`, `attribution_code`
- Frontend route `/backoffice` (table + filters + lead detail)
