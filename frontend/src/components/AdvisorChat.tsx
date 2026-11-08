import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { sendToAdvisor, startChat, type AdvisorReply, type Choice, type ProductCard, type Recommendation } from "../api/advisor";
import { fetchProducts, type QuoteRequest } from "../api/quote";
import { formatInr } from "../format";
import { useI18n, type Translate } from "../i18n/I18nProvider";
import { unitLabel } from "../i18n/products";
import { describeBlock } from "../i18n/reasons";
import { LeadForm } from "./LeadForm";
import { VoiceButton } from "./VoiceButton";

const MAX_CHARS = 500;

interface Bubble {
  id: number;
  from: "owner" | "advisor";
  text: string;
  source?: "gemini" | "rules";
  products?: ProductCard[];
}

const plural = (t: Translate, base: "quote.month" | "quote.day", n: number) => t(n === 1 ? `${base}.one` : `${base}.other`, { n });

/**
 * The advisor chat (R2). The backend's rules engine decides every product and price; text marked
 * "AI" was written by Gemini and checked against those rules before it reached this screen.
 */
export function AdvisorChat({ onSeeQuote, fetchFn }: { onSeeQuote: (request: QuoteRequest) => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [reply, setReply] = useState<AdvisorReply | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<"start" | "send" | null>(null);
  const [toolsDraft, setToolsDraft] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [form, setForm] = useState<"handoff" | "not_interested" | null>(null);
  const [leadRef, setLeadRef] = useState<{ id: string; kind: "handoff" | "not_interested" } | null>(null);
  const nextId = useRef(1);
  const lastFailed = useRef<{ lang: typeof lang; text: string } | { lang: typeof lang; choice: Choice } | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const started = useRef(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const nameOf = (id: string) => names.get(id) ?? id;

  // Product names for reasons such as "works only with Biz Fibre 100 or Biz Fibre 300".
  useEffect(() => {
    fetchProducts(fetchFn).then(
      (list) => setNames(new Map(list.map((p) => [p.id, p.name]))),
      () => undefined,
    );
  }, [fetchFn]);

  const addAdvisor = useCallback((r: AdvisorReply) => {
    setBubbles((b) => [...b, ...r.messages.map((m) => ({ id: nextId.current++, from: "advisor" as const, ...m }))]);
    setReply(r);
    setToolsDraft([]);
    setCity("");
    if (r.action) setForm(r.action);
  }, []);

  const start = useCallback(() => {
    setError(null);
    setSending(true);
    startChat(lang, fetchFn).then(
      (r) => {
        setSessionId(r.sessionId);
        addAdvisor(r);
        setSending(false);
      },
      () => {
        setError("start");
        setSending(false);
      },
    );
  }, [lang, fetchFn, addAdvisor]);

  // Start once; a language change later only changes the language of the next replies.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  useEffect(() => {
    const log = logRef.current;
    if (log && typeof log.scrollTo === "function") log.scrollTo({ top: log.scrollHeight });
  }, [bubbles, sending]);

  const send = (body: { lang: typeof lang; text: string } | { lang: typeof lang; choice: Choice }, shown: string) => {
    if (!sessionId || sending) return;
    setBubbles((b) => [...b, { id: nextId.current++, from: "owner", text: shown }]);
    setSending(true);
    setError(null);
    lastFailed.current = null;
    sendToAdvisor(sessionId, body, fetchFn).then(
      (r) => {
        addAdvisor(r);
        setSending(false);
      },
      () => {
        lastFailed.current = body;
        setError("send");
        setSending(false);
      },
    );
  };

  const retry = () => {
    const body = lastFailed.current;
    if (!body || !sessionId) return;
    setSending(true);
    setError(null);
    sendToAdvisor(sessionId, body, fetchFn).then(
      (r) => {
        lastFailed.current = null;
        addAdvisor(r);
        setSending(false);
      },
      () => {
        setError("send");
        setSending(false);
      },
    );
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    send({ lang, text: value }, value);
  };

  const choose = (choice: Choice, label: string) => send({ lang, choice }, label);

  const quick = reply && !form ? reply.quickReplies : [];
  const cityOptions = reply?.expecting === "city" ? quick.filter((q) => q.choice.slot === "city") : [];
  const otherQuick = reply?.expecting === "city" ? quick.filter((q) => q.choice.slot !== "city") : quick;

  return (
    <section className="advisor" aria-labelledby="advisor-title">
      <div className="advisor__head">
        <h2 id="advisor-title" className="card__title">
          {t("advisor.title")}
        </h2>
        {reply && (
          <span className={`mode-badge mode-badge--${reply.mode}`} data-testid="advisor-mode">
            {t(reply.mode === "gemini" ? "advisor.mode.gemini" : "advisor.mode.basic")}
          </span>
        )}
        <button type="button" className="button-secondary advisor__human" onClick={() => setForm("handoff")} disabled={!sessionId}>
          {t("advisor.human")}
        </button>
      </div>

      <ol className="chat" ref={logRef} aria-live="polite" aria-label={t("advisor.title")}>
        {bubbles.map((b) => (
          <li key={b.id} className={`bubble bubble--${b.from}`}>
            <span className="visually-hidden">{b.from === "owner" ? t("advisor.you") : t("advisor.title")}: </span>
            {b.source === "gemini" && (
              <span className="bubble__ai" title={t("advisor.aiTitle")}>
                {t("advisor.aiLabel")}
              </span>
            )}
            <p className="bubble__text">{b.text}</p>
            {b.products?.map((p) => <ProductCardView key={p.productId} card={p} nameOf={nameOf} />)}
          </li>
        ))}
        {sending && (
          <li className="bubble bubble--advisor bubble--typing" aria-label={t("advisor.typing")}>
            {t("advisor.typing")}
          </li>
        )}
      </ol>

      {error && (
        <div className="card card--alert" role="alert">
          <p>{t(error === "start" ? "advisor.error.start" : "advisor.error.send")}</p>
          <button type="button" className="button-secondary" onClick={error === "start" ? start : retry}>
            {t("advisor.retry")}
          </button>
        </div>
      )}

      {reply?.recommendation && !form && (
        <RecommendationCard rec={reply.recommendation} nameOf={nameOf} onSeeQuote={onSeeQuote} onNotForMe={() => setForm("not_interested")} />
      )}

      {leadRef && !form && (
        <p className="card card--ok" role="status" data-testid="lead-saved">
          {t(leadRef.kind === "handoff" ? "lead.saved.handoff" : "lead.saved.notInterested", { id: leadRef.id })}
        </p>
      )}

      {form && sessionId && (
        <LeadForm
          kind={form}
          sessionId={sessionId}
          fetchFn={fetchFn}
          onCancel={() => setForm(null)}
          onSaved={(id) => {
            setLeadRef({ id, kind: form });
            setForm(null);
          }}
        />
      )}

      {!form && cityOptions.length > 0 && (
        <div className="quick quick--city">
          <label className="visually-hidden" htmlFor="advisor-city">
            {t("form.city")}
          </label>
          <select id="advisor-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} disabled={sending}>
            <option value="">{t("form.cityPlaceholder")}</option>
            {cityOptions.map((q) => (
              <option key={String(q.choice.value)} value={String(q.choice.value)}>
                {q.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button-secondary"
            disabled={!city || sending}
            onClick={() => {
              const q = cityOptions.find((o) => String(o.choice.value) === city);
              if (q) choose(q.choice, q.label);
            }}
          >
            {t("advisor.chooseCity")}
          </button>
        </div>
      )}

      {!form && reply?.multiSelect ? (
        <div className="quick" role="group" aria-label={t("advisor.pickAll")}>
          {otherQuick.map((q) => {
            const values = Array.isArray(q.choice.value) ? (q.choice.value as string[]) : [];
            const none = values.length === 0;
            const on = none ? false : toolsDraft.includes(values[0]!);
            return (
              <button
                key={q.label}
                type="button"
                className={`chip${on ? " chip--on" : ""}`}
                aria-pressed={none ? undefined : on}
                disabled={sending}
                onClick={() => {
                  if (none) choose({ slot: "tools", value: [] }, q.label);
                  else setToolsDraft((d) => (on ? d.filter((v) => v !== values[0]) : [...d, values[0]!]));
                }}
              >
                {q.label}
              </button>
            );
          })}
          <button
            type="button"
            className="chip chip--done"
            disabled={toolsDraft.length === 0 || sending}
            onClick={() => {
              const labels = otherQuick.filter((q) => Array.isArray(q.choice.value) && toolsDraft.includes((q.choice.value as string[])[0]!)).map((q) => q.label);
              choose({ slot: "tools", value: toolsDraft }, labels.join(", "));
            }}
          >
            {t("advisor.done")}
          </button>
        </div>
      ) : (
        !form &&
        otherQuick.length > 0 && (
          <div className="quick">
            {otherQuick.map((q) => (
              <button key={q.label} type="button" className="chip" disabled={sending} onClick={() => choose(q.choice, q.label)}>
                {q.label}
              </button>
            ))}
          </div>
        )
      )}

      {!form && (
        <form className="composer" onSubmit={submitText}>
          <label className="visually-hidden" htmlFor="advisor-input">
            {t("advisor.placeholder")}
          </label>
          <input
            id="advisor-input"
            className="input composer__input"
            value={text}
            maxLength={MAX_CHARS}
            placeholder={t("advisor.placeholder")}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            disabled={!sessionId}
          />
          {/* Voice (step 8): the recognised words are sent like a typed message. */}
          <VoiceButton disabled={!sessionId || sending} onText={(said) => send({ lang, text: said.slice(0, MAX_CHARS) }, `🎤 ${said.slice(0, MAX_CHARS)}`)} />
          <button type="submit" className="button-primary composer__send" disabled={!sessionId || sending || text.trim() === ""}>
            {t("advisor.send")}
          </button>
        </form>
      )}
    </section>
  );
}

function ProductCardView({ card, nameOf }: { card: ProductCard; nameOf: (id: string) => string }) {
  const { t, lang } = useI18n();
  const verdict = card.eligible === true ? "available" : card.eligible === false ? "notAvailable" : "unknown";
  return (
    <div className={`product-card product-card--${verdict}`} data-testid={`product-${card.productId}`}>
      <p className="product-card__name">{card.name}</p>
      <p className="product-card__price">
        {t("advisor.product.from", { price: formatInr(card.unitPriceInr) })} {unitLabel(card.unit, lang)}
      </p>
      <p className="product-card__verdict">{t(`advisor.product.${verdict}`)}</p>
      {card.eligible === true && (card.inBundle || card.addOn) && (
        <p className="muted">{t(card.inBundle ? "advisor.product.inBundle" : "advisor.product.addOn")}</p>
      )}
      {card.eligible !== true && card.violations.length > 0 && (
        <p className="product-card__reasons">{card.violations.map((v) => describeBlock(v, t, nameOf)).join(" ")}</p>
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  nameOf,
  onSeeQuote,
  onNotForMe,
}: {
  rec: Recommendation;
  nameOf: (id: string) => string;
  onSeeQuote: (r: QuoteRequest) => void;
  onNotForMe: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="card recommendation" aria-labelledby="rec-title" data-testid="recommendation">
      <p className="muted">{t("advisor.rec.title")}</p>
      <h3 id="rec-title" className="recommendation__name">
        {rec.name}
      </h3>
      <p className="summary__price" data-testid="rec-monthly">
        {formatInr(rec.totals.monthlyInr)}
        <span className="summary__per">{t("quote.perMonth")}</span>
      </p>
      <dl className="summary__grid">
        <dt>{t("quote.setupTotal")}</dt>
        <dd>{formatInr(rec.totals.setupInr)}</dd>
        <dt>{t("quote.contract")}</dt>
        <dd>{plural(t, "quote.month", rec.totals.contractMonths)}</dd>
        <dt>{t("quote.ready")}</dt>
        <dd>{plural(t, "quote.day", rec.totals.installDays)}</dd>
      </dl>
      <ul className="recommendation__items">
        {rec.items.map((i) => (
          <li key={i.productId}>
            <span className="quote-item__name">
              {i.name}
              {i.qty > 1 ? ` × ${i.qty}` : ""}
            </span>
            <span className="quote-item__desc">{i.why}</span>
          </li>
        ))}
      </ul>
      {rec.unavailable.length > 0 && (
        <details className="recommendation__unavailable">
          <summary>{t("quote.unavailable")}</summary>
          <ul>
            {rec.unavailable.map((u) => (
              <li key={u.productId}>
                {u.name}: {u.violations.map((v) => describeBlock(v, t, nameOf)).join(" ")}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className="button-primary" onClick={() => onSeeQuote(rec.quoteRequest)}>
        {t("advisor.rec.seeQuote")}
      </button>
      <button type="button" className="link-button" onClick={onNotForMe}>
        {t("advisor.rec.notForMe")}
      </button>
    </section>
  );
}
