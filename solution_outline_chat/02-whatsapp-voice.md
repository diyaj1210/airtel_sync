# Solution 2 – WhatsApp & Voice, Vernacular

**Idea:** Micro retail (55% of the SMB base) lives on WhatsApp. Run the same journey as a WhatsApp
conversation, with voice notes, through a WhatsApp Business API channel (Airtel IQ style).

## User flow
1. Owner messages "Hi" (or scans a QR at a partner shop) → picks language
2. Same advisor questions; owner can **reply by voice note**
3. Quote arrives as a WhatsApp card with **Buy** button → payment link
4. Owner **sends photos** of GST/Udyam/ID/bill in the chat → KYC runs on backend
5. Owner types **"status"** anytime → tracker reply

## How it is implemented
| Part | Implementation |
|---|---|
| Channel | Webhook endpoint `/channels/whatsapp` in backend. For the demo: a **WhatsApp-style chat simulator** in the frontend (real API needs Meta business verification). Optional: Twilio WhatsApp sandbox. |
| Voice | Speech-to-text → advisor → text-to-speech reply. Demo: browser Web Speech API on the advisor screen. |
| Brain | Reuses Solution 1's advisor, rules engine, quote, KYC and order APIs — **no duplicate logic** |
| Session | Conversation state stored per phone number (Redis or in-memory for the prototype) |

## Why it matters
- Removes "no time for a visit" (531) and app-download friction.
- WhatsApp campaign leads convert at only 3% when called — let them self-serve instead.
