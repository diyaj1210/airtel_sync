import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { setReferral } from "../referral";

afterEach(() => {
  setReferral(null);
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = "en";
});
