import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BackOffice } from "./components/backoffice/BackOffice";
import { I18nProvider } from "./i18n/I18nProvider";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      {/* Staff back-office at /backoffice (the dev server and the preview serve index.html for every path). */}
      {window.location.pathname.replace(/\/+$/, "") === "/backoffice" ? <BackOffice /> : <App />}
    </I18nProvider>
  </StrictMode>,
);
