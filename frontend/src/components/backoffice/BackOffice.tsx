import { useCallback, useEffect, useMemo, useState } from "react";
import { listAccounts, signIn, signOut, type Staff, type StaffRole } from "../../api/backoffice";
import { useI18n } from "../../i18n/I18nProvider";
import { LanguageSwitch } from "../LanguageSwitch";
import { AttributionTab } from "./AttributionTab";
import { CrmTab } from "./CrmTab";
import { KycQueueTab } from "./KycQueueTab";
import { LeadsTab } from "./LeadsTab";
import { LoadError, staffNames } from "./common";

type Tab = "leads" | "crm" | "kyc" | "partners";
/** What each role may open (the backend enforces the same). */
const TABS: Record<StaffRole, Tab[]> = {
  admin: ["leads", "crm", "kyc", "partners"],
  sales: ["leads", "crm", "partners"],
  partner: ["leads", "partners"],
};

/**
 * Staff back-office (step 7), at /backoffice. MOCK sign-in with a demo account; the token lives in
 * memory only, so closing or reloading the page signs out.
 */
export function BackOffice({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Staff[] | null>(null);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [session, setSession] = useState<{ token: string; staff: Staff } | null>(null);
  const [tab, setTab] = useState<Tab>("leads");
  const [notice, setNotice] = useState<"bo.expired" | "bo.signIn.error" | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAccounts = useCallback(async () => {
    setAccountsFailed(false);
    try {
      setAccounts((await listAccounts(fetchFn)).accounts);
    } catch {
      setAccountsFailed(true);
    }
  }, [fetchFn]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const names = useMemo(() => staffNames(accounts ?? []), [accounts]);
  const expired = useCallback(() => {
    setSession(null);
    setNotice("bo.expired");
  }, []);

  const start = async (code: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const s = await signIn(code, fetchFn);
      setSession({ token: s.token, staff: s.staff });
      setTab("leads");
    } catch {
      setNotice("bo.signIn.error");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (session) await signOut(session.token, fetchFn).catch(() => undefined);
    setSession(null);
  };

  return (
    <div className="app app--wide">
      <header className="app-header">
        <div>
          <h1 className="app-header__name">
            {t("app.name")} · {t("bo.title")}
          </h1>
          <p className="app-header__byline">{t("bo.byline")}</p>
        </div>
        <LanguageSwitch />
      </header>

      <main className="app-main">
        {notice && (
          <p className="card card--alert" role="alert">
            {t(notice)}
          </p>
        )}

        {!session && (
          <section className="card" aria-labelledby="bo-signin-title">
            <h2 id="bo-signin-title" className="card__title">
              {t("bo.signIn.title")}
            </h2>
            <p>
              <span className="mock-badge">MOCK</span> {t("bo.mock")}
            </p>
            <p className="muted small">{t("bo.signIn.hint")}</p>
            {accountsFailed && <LoadError onRetry={() => void loadAccounts()} />}
            {!accounts && !accountsFailed && <p className="muted">{t("bo.loading")}</p>}
            <ul className="bo-accounts">
              {accounts?.map((a) => (
                <li key={a.code}>
                  <button type="button" className="button-secondary bo-account" disabled={busy} onClick={() => void start(a.code)}>
                    <span>{t("bo.signIn.as", { name: a.name })}</span>
                    <span className="small muted">
                      {a.code} · {t(`bo.role.${a.role}`)} · {a.area}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {session && (
          <>
            <div className="bo-bar">
              <p className="small">
                <span className="mock-badge">MOCK</span> {t("bo.signedInAs", { name: session.staff.name, role: t(`bo.role.${session.staff.role}`) })}
              </p>
              <button type="button" className="link-button" onClick={() => void end()}>
                {t("bo.signOut")}
              </button>
            </div>
            <nav className="bo-tabs" aria-label={t("bo.tabs")}>
              {TABS[session.staff.role].map((name) => (
                <button key={name} type="button" className={`chip${tab === name ? " chip--on" : ""}`} aria-pressed={tab === name} onClick={() => setTab(name)}>
                  {t(`bo.tab.${name}`)}
                </button>
              ))}
            </nav>
            {tab === "leads" && <LeadsTab token={session.token} staff={session.staff} names={names} onExpired={expired} fetchFn={fetchFn} />}
            {tab === "crm" && <CrmTab token={session.token} names={names} onExpired={expired} fetchFn={fetchFn} />}
            {tab === "kyc" && <KycQueueTab token={session.token} names={names} onExpired={expired} fetchFn={fetchFn} />}
            {tab === "partners" && <AttributionTab token={session.token} staff={session.staff} onExpired={expired} fetchFn={fetchFn} />}
          </>
        )}
      </main>

      <footer className="app-footer">
        <a href="/">{t("track.home")}</a> · <span>{t("footer.note")}</span>
      </footer>
    </div>
  );
}
