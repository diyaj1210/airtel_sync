/** English strings. Every other language must define exactly these keys (checked by TypeScript). */
export const en = {
  "app.name": "Udyam Digital",
  "app.byline": "by Accel Business",
  "language.label": "Language",
  "home.title": "Your business, online in one sitting",
  "home.body":
    "Get the right internet, phone and cloud bundle for your business with one clear monthly price, on your phone and in your language.",
  "status.title": "System status",
  "status.backend": "App server",
  "status.aiService": "AI service",
  "status.ok": "Working",
  "status.down": "Not reachable",
  "status.unknown": "Can't check",
  "status.checking": "Checking…",
  "status.retry": "Check again",
  "footer.note": "Prototype for the Airtel SYNC YTL Hackathon 2026. All data is synthetic.",
} as const;

export type MessageKey = keyof typeof en;
