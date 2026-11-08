import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { en } from "./i18n/en";
import { hi } from "./i18n/hi";
import { I18nProvider, STORAGE_KEY } from "./i18n/I18nProvider";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const allOk = () =>
  vi.fn().mockImplementation(async () =>
    jsonResponse(200, { status: "ok", services: { backend: { status: "ok" }, aiService: { status: "ok" } } }),
  );

function renderApp(fetchFn: typeof fetch = allOk()) {
  return render(
    <I18nProvider>
      <App fetchFn={fetchFn} />
    </I18nProvider>,
  );
}

function statusRow(label: string) {
  return screen.getByText(label).closest("li") as HTMLElement;
}

describe("App shell and language switch", () => {
  it("renders in English by default", async () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en["app.name"]);
    expect(screen.getByText(en["home.title"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.lang).toBe("en");
    await waitFor(() => expect(within(statusRow(en["status.backend"])).getByText(en["status.ok"])).toBeInTheDocument());
  });

  it("switches every visible string to Hindi and back", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "हिंदी" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(hi["app.name"]);
    expect(screen.getByText(hi["home.title"])).toBeInTheDocument();
    expect(screen.getByText(hi["home.body"])).toBeInTheDocument();
    expect(screen.getByText(hi["status.title"])).toBeInTheDocument();
    expect(screen.getByText(hi["footer.note"])).toBeInTheDocument();
    expect(screen.queryByText(en["home.title"])).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("hi");
    await waitFor(() => expect(within(statusRow(hi["status.backend"])).getByText(hi["status.ok"])).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText(en["home.title"])).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("remembers the chosen language on this device", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await user.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("hi");
    unmount();

    renderApp();
    expect(screen.getByText(hi["home.title"])).toBeInTheDocument();
  });

  it("ignores an invalid saved language", () => {
    window.localStorage.setItem(STORAGE_KEY, "xx");
    renderApp();
    expect(screen.getByText(en["home.title"])).toBeInTheDocument();
  });

  it("still works when browser storage is blocked", async () => {
    const user = userEvent.setup();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      renderApp();
      expect(screen.getByText(en["home.title"])).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "हिंदी" }));
      expect(screen.getByText(hi["home.title"])).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("System status card", () => {
  it("shows both services working", async () => {
    renderApp();
    await waitFor(() => {
      expect(within(statusRow(en["status.backend"])).getByText(en["status.ok"])).toBeInTheDocument();
      expect(within(statusRow(en["status.aiService"])).getByText(en["status.ok"])).toBeInTheDocument();
    });
  });

  it("shows the ai-service as not reachable when the backend reports degraded", async () => {
    const fetchFn = vi.fn().mockImplementation(async () =>
      jsonResponse(503, {
        status: "degraded",
        services: { backend: { status: "ok" }, aiService: { status: "unreachable" } },
      }),
    );
    renderApp(fetchFn);
    await waitFor(() => {
      expect(within(statusRow(en["status.backend"])).getByText(en["status.ok"])).toBeInTheDocument();
      expect(within(statusRow(en["status.aiService"])).getByText(en["status.down"])).toBeInTheDocument();
    });
  });

  it("shows the backend down and the ai-service as can't-check when the backend is unreachable", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp(fetchFn);
    await waitFor(() => {
      expect(within(statusRow(en["status.backend"])).getByText(en["status.down"])).toBeInTheDocument();
      expect(within(statusRow(en["status.aiService"])).getByText(en["status.unknown"])).toBeInTheDocument();
    });
  });

  it("'Check again' runs a new check and shows the new result", async () => {
    const user = userEvent.setup();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async () =>
        jsonResponse(200, { status: "ok", services: { backend: { status: "ok" }, aiService: { status: "ok" } } }),
      );
    renderApp(fetchFn);
    await waitFor(() =>
      expect(within(statusRow(en["status.backend"])).getByText(en["status.down"])).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: en["status.retry"] }));
    await waitFor(() =>
      expect(within(statusRow(en["status.backend"])).getByText(en["status.ok"])).toBeInTheDocument(),
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
