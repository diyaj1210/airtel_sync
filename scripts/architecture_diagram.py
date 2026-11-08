"""Architecture diagram of Udyam Digital, drawn in draw.io's default style.

Writes, from ONE description below (so they always match):
  docs/architecture/architecture.drawio   open and edit it in draw.io (app.diagrams.net)
  docs/architecture/architecture.svg      transparent background
The PNG (transparent) is rendered from the SVG with Chrome / Edge headless, see docs/architecture/README.md.

Run:  python scripts/architecture_diagram.py
"""
from __future__ import annotations

import html
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "architecture"

# draw.io's default palette (fill, stroke)
BLUE = ("#dae8fc", "#6c8ebf")
GREEN = ("#d5e8d4", "#82b366")
PURPLE = ("#e1d5e7", "#9673a6")
YELLOW = ("#fff2cc", "#d6b656")
RED = ("#f8cecc", "#b85450")
GREY = ("#f5f5f5", "#666666")
ORANGE = ("#ffe6cc", "#d79b00")
WHITE = ("#ffffff", "#666666")

W, H = 2240, 1000
FONT = "Helvetica"
TITLE_PX, BODY_PX, LINE = 12, 11, 14


@dataclass
class Box:
    id: str
    x: int
    y: int
    w: int
    h: int
    title: str
    lines: list[str] = field(default_factory=list)
    color: tuple[str, str] = WHITE
    dashed: bool = False
    shape: str = "box"  # box | lane | actor | note
    parent: str | None = None


@dataclass
class Edge:
    points: list[tuple[int, int]]
    label: list[str] = field(default_factory=list)
    label_at: tuple[int, int] | None = None  # top-left of the label text
    dashed: bool = False
    both: bool = False


boxes: list[Box] = []
edges: list[Edge] = []


def lane(id, x, y, w, h, title, color):
    boxes.append(Box(id, x, y, w, h, title, color=color, shape="lane"))


def box(id, x, y, w, h, title, lines, color, dashed=False, parent=None, shape="box"):
    boxes.append(Box(id, x, y, w, h, title, lines, color, dashed, shape, parent))


# ---------------------------------------------------------------- people (left)
box("owner", 20, 140, 185, 76, "Small-business owner", ["phone browser, English / हिंदी", "self-serve, in one sitting"], YELLOW, shape="actor")
box("partner", 20, 280, 185, 66, "Partner / field sales", ["shares a referral link / QR", "/?ref=PTR-01"], YELLOW, shape="actor")
box("staff", 20, 480, 185, 80, "Staff", ["MOCK sign-in, 3 roles:", "operations desk (KYC review),", "field sales, channel partners"], YELLOW, shape="actor")
box("speech", 20, 588, 185, 84, "Browser speech service", ["Web Speech API", "Chrome → Google", "Edge → Microsoft"], GREY)

# ---------------------------------------------------------------- frontend
lane("fe", 290, 70, 330, 690, "Frontend · React 19 + Vite 7 + TS · :5173", BLUE)
box("app", 305, 110, 300, 150, "Owner app (mobile-first, EN / HI)", [
    "Home · Advisor chat (GenAI)",
    "Quote: price, setup, contract, value timeline",
    "KYC: lookup → consent → name → documents",
    "  One-Sitting readiness card, a fix per blocker",
    "MOCK e-sign · MOCK payment · Tracker",
    "My data · Continue my application",
], BLUE)
box("vite", 305, 275, 300, 90, "Shared in the app", [
    "i18n English / हिंदी (key-parity tested)",
    "identifiers only ever shown masked",
    "referral ?ref= code kept with the journey",
    "dev server proxies /api/* to the backend",
], BLUE)
box("wasim", 305, 380, 300, 80, "WhatsApp simulator", [
    "plays the owner's WhatsApp: buttons, lists,",
    "photos, voice notes · labelled MOCK",
], BLUE)
box("bo", 305, 470, 300, 100, "Staff back-office  /backoffice", [
    "Advisor leads + propensity score · Past",
    "quarter (CRM) · KYC exceptions + photos ·",
    "Partner credit · One-sitting metrics ·",
    "retention job (DEMO date)",
], BLUE)
box("voice", 305, 600, 300, 60, "Voice dictation 🎤 + read-aloud 🔊", [
    "words appear in the box; owner edits, then Send",
], BLUE)

# ---------------------------------------------------------------- backend
lane("be", 740, 70, 650, 690, "Backend API · Node 22 + Express 5 + TS · :4000 — every decision is made here", GREEN)
A, B, CW = 755, 1075, 300
box("advisor", A, 110, CW, 80, "Advisor engine", [
    "7 questions · EN / HI / Hinglish parser",
    "LLM only words it: guard on every sentence",
    "basic mode without a key · leads not closed",
], GREEN)
box("rules", A, 200, CW, 80, "Catalogue rules engine", [
    "5 eligibility rules (tier, people, sites,",
    "active GSTIN, requires_one_of) · pricing ·",
    "5 segment bundle templates",
], GREEN)
box("quote", A, 290, CW, 80, "Quote engine + computeTimeline", [
    "one monthly price, setup, contract (and its",
    "driver), ready dates, Day-1 products, add-ons",
    "re-checked by the rules on every toggle",
], GREEN)
box("wabot", A, 380, CW, 80, "WhatsApp bot · MOCK Business API webhook", [
    "/api/channels/whatsapp · one chat per number",
    "the whole journey, reusing the same modules",
], GREEN)
box("boapi", A, 470, CW, 100, "Back-office API", [
    "MOCK staff sign-in, roles admin / sales /",
    "partner · referral attribution · CRM leads ·",
    "KYC review (approve / reject) · metrics ·",
    "retention trigger",
], GREEN)
box("logger", A, 580, CW, 60, "Masking JSON logger", [
    "no identifier, document or OCR text in logs",
], GREEN)
box("kyc", B, 110, CW, 100, "Smart KYC", [
    "GSTIN mod-36 checksum (X allowed), Udyam",
    "(district 00 ok), O/0 I/1 fixes · checks for",
    "K01–K12 · Pass / Fix needed / Manual review",
    "· 'Did you mean …?' · reviewer decision",
], GREEN)
box("ready", B, 220, CW, 80, "One-Sitting Completion", [
    "readiness state + %, blockers with a fix,",
    "alternative bundles (via the rules engine),",
    "partner assistance · save and return",
], GREEN)
box("privacy", B, 310, CW, 100, "Privacy (DPDP)", [
    "consent record, KYC writes refused without",
    "it (403) · lookup first · one masking utility",
    "· AES-256-GCM photo vault · retention job",
    "every 6 h · My data, withdraw, delete",
], GREEN)
box("orders", B, 420, CW, 80, "Orders + tracker", [
    "checkout (setup + 1st month) · order ·",
    "stages, planned vs actual per product ·",
    "stopped if consent is withdrawn",
], GREEN)
box("mocks", B, 510, CW, 70, "MOCK services (labelled)", [
    "GST / Udyam registry lookups (CSV) · OTP",
    "e-sign · payment · owner signing link · coverage",
], ORANGE, dashed=True)
box("propc", B, 590, CW, 50, "Propensity client", [
    "back-office lists still work if it is down",
], GREEN)
box("stores", A, 675, 620, 70, "In-memory stores (prototype: cleared on restart)", [
    "accepted quotes · advisor chats + leads · KYC cases (consent record, blockers, deletion log) ·",
    "orders · staff sessions (8 h) · WhatsApp chats (24 h)",
], WHITE)

# ---------------------------------------------------------------- AI service
lane("ai", 1530, 70, 340, 430, "AI service · Python 3.13 + FastAPI · :8000", PURPLE)
box("aiadv", 1545, 110, 310, 80, "/advisor/understand · /advisor/explain", [
    "Gemini via google-genai, JSON-schema output",
    "identifiers masked before sending",
], PURPLE)
box("ocr", 1545, 200, 310, 90, "/kyc/read · OCR", [
    "RapidOCR (ONNX, offline) · pink watermark",
    "removed · tilted pages straightened ·",
    "fields by page layout · image never kept",
], PURPLE)
box("prop", 1545, 300, 310, 90, "/propensity/score · /leads · /model", [
    "loads models/propensity.json (coefficients)",
    "score 0–100, band, top 3 reasons",
    "no leakage columns · test AUC 0.670",
], PURPLE)
box("train", 1545, 400, 310, 80, "Offline training", [
    "python -m app.propensity.train",
    "scikit-learn, stratified split, 5-fold CV",
], PURPLE)

# ---------------------------------------------------------------- external
lane("ext", 1920, 70, 290, 300, "External", GREY)
box("gemini", 1935, 110, 260, 80, "Google Gemini API (optional)", [
    "gemini-3.5-flash-lite",
    "key only in .env, used by the ai-service",
], YELLOW)
box("legend", 1935, 210, 260, 145, "Legend", [
    "→  request / data flow",
    "- - -  dashed box: MOCK, a working",
    "      stand-in, labelled in the UI",
    "Green: decides · Purple: AI helps",
    "Masked IDs everywhere:",
    "GSTIN 27XU********1ZP",
], WHITE, shape="note")
box("why", 1935, 380, 260, 120, "Design rules", [
    "Rules engine decides eligibility and",
    "price; the LLM only explains.",
    "Today = 2026-07-15, injected.",
    "Every mock works without keys;",
    "no LLM key → basic mode.",
], WHITE, shape="note")

# ---------------------------------------------------------------- data
lane("data", 290, 800, 1580, 160, "Data & files", RED)
box("raw", 305, 840, 520, 100, "data/raw (read-only, treated as customer data)", [
    "product_catalogue.csv (25 products) · smb_leads.csv (5,000 leads)",
    "mock_gstin_registry.csv · mock_udyam_registry.csv",
    "kyc_documents/ (K01–K12 sample images, DEMO)",
], RED)
box("vault", 845, 840, 320, 100, "backend/var/documents", [
    "KYC photos, AES-256-GCM encrypted",
    "random file names, git-ignored",
    "deleted 30 days after verification,",
    "or at once on request / withdrawal",
], RED)
box("env", 1185, 840, 300, 100, ".env (never committed)", [
    "GEMINI_API_KEY (ai-service only)",
    "DOCUMENT_ENCRYPTION_KEY (backend)",
    "ports, log level · .env.example lists them",
], RED)
box("model", 1545, 840, 310, 100, "ai-service/models/propensity.json", [
    "coefficients (no pickle) +",
    "docs/propensity-report.md",
    "ai-service/tests/fixtures (recorded OCR)",
], RED)

# ---------------------------------------------------------------- arrows
edges += [
    Edge([(205, 178), (305, 178)], ["uses"], (232, 162)),
    Edge([(112, 280), (112, 216)], ["sends link"], (118, 240)),
    Edge([(205, 520), (305, 520)], ["signs in"], (226, 504)),
    Edge([(305, 630), (205, 630)], ["audio → text"], (214, 614)),
    Edge([(605, 185), (740, 185)], ["JSON /api/*", "(Vite proxy in dev)"], (630, 155)),
    Edge([(605, 420), (755, 420)], ["MOCK webhook:", "text, buttons, photos"], (630, 390)),
    Edge([(605, 520), (755, 520)], ["Bearer token", "(staff, 8 h)"], (630, 490)),
    Edge([(1390, 150), (1545, 150)], ["masked facts + message", "→ wording (optional)"], (1398, 120)),
    Edge([(1390, 245), (1545, 245)], ["KYC photo → fields", "(nothing stored)"], (1405, 215)),
    Edge([(1390, 345), (1545, 345)], ["lead features →", "score + reasons"], (1415, 315)),
    Edge([(1855, 150), (1935, 150)], ["HTTPS"], (1872, 134)),
    Edge([(790, 760), (790, 840)], ["reads CSVs at start-up (read-only)"], (798, 772)),
    Edge([(1120, 760), (1120, 840)], ["encrypt / decrypt / delete"], (1128, 772)),
    Edge([(1700, 480), (1700, 840)], ["writes model + report"], (1708, 640)),
]

TITLE = "Udyam Digital — solution architecture (prototype)"
SUBTITLE = ("Journey: advisor → quote with time to value → KYC (lookup first → consent → documents → readiness) → "
            "MOCK e-sign → MOCK payment → tracker · same journey on WhatsApp · back-office for exceptions")


# ================================================================= draw.io file
def drawio() -> str:
    cells = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />']
    cells.append(f'<mxCell id="title" value="&lt;b style=&quot;font-size:18px&quot;&gt;{html.escape(TITLE)}&lt;/b&gt;&lt;br&gt;{html.escape(html.escape(SUBTITLE))}" '
                 f'style="text;html=1;align=left;verticalAlign=top;fontFamily={FONT};fontSize={BODY_PX};" vertex="1" parent="1">'
                 f'<mxGeometry x="20" y="8" width="2100" height="50" as="geometry" /></mxCell>')
    for b in boxes:
        fill, stroke = b.color
        if b.shape == "lane":
            style = (f"swimlane;rounded=1;arcSize=4;whiteSpace=wrap;html=1;startSize=30;fillColor={fill};strokeColor={stroke};"
                     f"swimlaneFillColor=none;fontFamily={FONT};fontSize=13;fontStyle=1;align=center;")
            value = html.escape(b.title)
        else:
            body = "<br>".join(html.escape(l).replace("  ", "&nbsp;&nbsp;") for l in b.lines)
            value = html.escape(f"<b>{html.escape(b.title)}</b>" + (f"<br><font style=\"font-size:{BODY_PX}px\">{body}</font>" if body else ""))
            base = "shape=note;size=14;" if b.shape == "note" else "rounded=1;arcSize=8;"
            style = (f"{base}whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontFamily={FONT};fontSize={TITLE_PX};"
                     f"align=left;verticalAlign=top;spacingLeft=8;spacingTop=2;" + ("dashed=1;" if b.dashed else "")
                     + ("shadow=0;" if b.shape != "actor" else "strokeWidth=1;"))
        cells.append(f'<mxCell id="{b.id}" value="{value}" style="{style}" vertex="1" parent="1">'
                     f'<mxGeometry x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" as="geometry" /></mxCell>')
    for i, e in enumerate(edges):
        (sx, sy), (tx, ty) = e.points[0], e.points[-1]
        style = f"edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#333333;fontFamily={FONT};" + ("dashed=1;" if e.dashed else "")
        cells.append(f'<mxCell id="e{i}" style="{style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry">'
                     f'<mxPoint x="{sx}" y="{sy}" as="sourcePoint" /><mxPoint x="{tx}" y="{ty}" as="targetPoint" /></mxGeometry></mxCell>')
        if e.label:
            lx, ly = e.label_at
            value = html.escape("<br>".join(html.escape(l) for l in e.label))
            cells.append(f'<mxCell id="l{i}" value="{value}" style="text;html=1;align=left;verticalAlign=top;fontFamily={FONT};fontSize=10;fontColor=#333333;" '
                         f'vertex="1" parent="1"><mxGeometry x="{lx}" y="{ly}" width="{max(len(l) for l in e.label) * 6 + 8}" height="{len(e.label) * 13 + 4}" as="geometry" /></mxCell>')
    model = (f'<mxGraphModel dx="{W}" dy="{H}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" '
             f'pageScale="1" pageWidth="{W}" pageHeight="{H}" background="none" math="0" shadow="0"><root>{"".join(cells)}</root></mxGraphModel>')
    return ('<mxfile host="app.diagrams.net" type="device">'
            f'<diagram id="architecture" name="Architecture">{model}</diagram></mxfile>\n')


# ================================================================= SVG (same coordinates, draw.io look)
def t(x, y, s, size=BODY_PX, bold=False, color="#000000", anchor="start"):
    return (f'<text x="{x}" y="{y}" font-family="Helvetica, Arial, sans-serif" font-size="{size}" '
            f'{"font-weight=\"bold\" " if bold else ""}fill="{color}" text-anchor="{anchor}">{html.escape(s)}</text>')


def svg() -> str:
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">'
           '<path d="M0,0 L10,5 L0,10 z" fill="#333333" /></marker></defs>']
    out.append(t(20, 28, TITLE, 18, True))
    out.append(t(20, 48, SUBTITLE, BODY_PX, color="#333333"))
    # lanes first, then boxes, then edges and labels on top
    for b in [b for b in boxes if b.shape == "lane"]:
        fill, stroke = b.color
        out.append(f'<rect x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="8" fill="none" stroke="{stroke}" stroke-width="1" />')
        out.append(f'<path d="M{b.x},{b.y + 30} L{b.x},{b.y + 8} Q{b.x},{b.y} {b.x + 8},{b.y} L{b.x + b.w - 8},{b.y} Q{b.x + b.w},{b.y} {b.x + b.w},{b.y + 8} '
                   f'L{b.x + b.w},{b.y + 30} Z" fill="{fill}" stroke="{stroke}" stroke-width="1" />')
        out.append(t(b.x + b.w / 2, b.y + 20, b.title, 13, True, anchor="middle"))
    for b in [b for b in boxes if b.shape != "lane"]:
        fill, stroke = b.color
        dash = ' stroke-dasharray="6 4"' if b.dashed else ""
        if b.shape == "note":
            f = 14
            out.append(f'<path d="M{b.x},{b.y} L{b.x + b.w - f},{b.y} L{b.x + b.w},{b.y + f} L{b.x + b.w},{b.y + b.h} L{b.x},{b.y + b.h} Z" fill="{fill}" stroke="{stroke}" />')
            out.append(f'<path d="M{b.x + b.w - f},{b.y} L{b.x + b.w - f},{b.y + f} L{b.x + b.w},{b.y + f}" fill="none" stroke="{stroke}" />')
        else:
            out.append(f'<rect x="{b.x}" y="{b.y}" width="{b.w}" height="{b.h}" rx="{min(10, b.h * 0.08 + 4):.0f}" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash} />')
        if b.shape == "actor":
            cx, cy = b.x + b.w - 20, b.y + 18
            out.append(f'<circle cx="{cx}" cy="{cy - 5}" r="5" fill="none" stroke="{stroke}" />'
                       f'<path d="M{cx},{cy} L{cx},{cy + 12} M{cx - 7},{cy + 4} L{cx + 7},{cy + 4} M{cx},{cy + 12} L{cx - 6},{cy + 20} M{cx},{cy + 12} L{cx + 6},{cy + 20}" fill="none" stroke="{stroke}" />')
        out.append(t(b.x + 8, b.y + 17, b.title, TITLE_PX, True))
        for i, line in enumerate(b.lines):
            out.append(t(b.x + 8, b.y + 17 + LINE * (i + 1), line.replace("  ", "  "), BODY_PX, color="#1a1a1a"))
    for e in edges:
        pts = " ".join(f"{x},{y}" for x, y in e.points)
        dash = ' stroke-dasharray="6 4"' if e.dashed else ""
        out.append(f'<polyline points="{pts}" fill="none" stroke="#333333" stroke-width="1.3"{dash} marker-end="url(#arrow)" />')
        if e.label:
            lx, ly = e.label_at
            for i, line in enumerate(e.label):
                out.append(t(lx, ly + 10 + i * 13, line, 10, color="#333333"))
    out.append("</svg>\n")
    return "\n".join(out)


def check_layout() -> None:
    """No two boxes in the same parent area overlap (catches layout mistakes)."""
    solid = [b for b in boxes if b.shape != "lane"]
    for i, a in enumerate(solid):
        for b in solid[i + 1:]:
            if a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h:
                raise SystemExit(f"overlap: {a.id} and {b.id}")
        lines_h = 17 + LINE * len(a.lines) + 4
        if lines_h > a.h:
            raise SystemExit(f"text does not fit in {a.id}: needs {lines_h}px, has {a.h}px")


if __name__ == "__main__":
    check_layout()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "architecture.drawio").write_text(drawio(), encoding="utf-8")
    (OUT / "architecture.svg").write_text(svg(), encoding="utf-8")
    print("wrote", OUT / "architecture.drawio", "and", OUT / "architecture.svg")
