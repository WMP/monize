import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@/test/render";
import { SharedEntryEditor } from "./SharedEntryEditor";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { exchangeRatesApi } from "@/lib/exchange-rates";
import {
  sharedEntryFixture,
  sharedGroupFixture,
} from "./__fixtures__/shared-fixtures";
import type { SharedEntry } from "@/types/shared-expense";

vi.mock("@/lib/shared-expenses", async (original) => ({
  ...(await original<typeof import("@/lib/shared-expenses")>()),
  sharedExpensesApi: { preview: vi.fn(), saveEntry: vi.fn() },
}));
vi.mock("@/lib/exchange-rates", async (original) => ({
  ...(await original<typeof import("@/lib/exchange-rates")>()),
  exchangeRatesApi: { getCurrencies: vi.fn() },
}));
vi.mock("@/hooks/useFinancialToday", () => ({
  useFinancialToday: () => "2026-10-25",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
describe("SharedEntryEditor", () => {
  beforeEach(() => {
    vi.mocked(sharedExpensesApi.preview).mockReset();
    vi.mocked(sharedExpensesApi.saveEntry).mockReset();
    vi.mocked(exchangeRatesApi.getCurrencies).mockResolvedValue([
      { code: "PLN", name: "Polish zloty", decimalPlaces: 2, symbol: "zł" },
    ] as never);
  });
  async function setup() {
    const onSaved = vi.fn(),
      onClose = vi.fn();
    render(
      <SharedEntryEditor
        group={sharedGroupFixture()}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    await screen.findByRole("option", { name: /PLN.*Polish/ });
    fireEvent.change(screen.getByLabelText("What was it for?"), {
      target: { value: "Dinner" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "300" },
    });
    return { onSaved, onClose };
  }
  it("accepts only the preview for the current draft, and saves no private bank movement", async () => {
    let resolve!: (value: SharedEntry) => void;
    vi.mocked(sharedExpensesApi.preview)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(
        sharedEntryFixture({
          originalAmount: "120.0000",
          groupAmount: "120.0000",
        }),
      );
    vi.mocked(sharedExpensesApi.saveEntry).mockResolvedValue(
      sharedEntryFixture(),
    );
    const { onSaved } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Review split" }));
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "120" },
    });
    await act(async () => resolve(sharedEntryFixture()));
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review split" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const sent = vi.mocked(sharedExpensesApi.saveEntry).mock.calls[0][1];
    expect(sent).toMatchObject({
      amount: "120",
      contributions: [{ participantId: "me", value: "120" }],
      previewFingerprint: "preview",
    });
    expect(sent).not.toHaveProperty("bankAccountId");
    expect(sent).not.toHaveProperty("bankTransactionId");
  });
  it("keeps the draft and command identity after a lost save response", async () => {
    vi.mocked(sharedExpensesApi.preview).mockResolvedValue(
      sharedEntryFixture(),
    );
    vi.mocked(sharedExpensesApi.saveEntry)
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValueOnce(sharedEntryFixture());
    const { onSaved } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Review split" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted",
    );
    expect(screen.getByLabelText("What was it for?")).toHaveValue("Dinner");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(sharedExpensesApi.saveEntry).mock.calls[1]).toEqual(
      vi.mocked(sharedExpensesApi.saveEntry).mock.calls[0],
    );
  });
  it("keeps failed preview values as a draft and offers another preview", async () => {
    vi.mocked(sharedExpensesApi.preview).mockRejectedValue(
      new Error("Choose a rate"),
    );
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Review split" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a rate");
    expect(sharedExpensesApi.saveEntry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review split" })).toBeEnabled();
  });
  it("waits for a foreign currency's precision before allowing money input", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof exchangeRatesApi.getCurrencies>>,
    ) => void;
    vi.mocked(exchangeRatesApi.getCurrencies).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <SharedEntryEditor
        group={sharedGroupFixture()}
        entry={sharedEntryFixture({
          currencyCode: "KWD",
          originalAmount: "1.0010",
        })}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    await act(async () =>
      resolve([
        { code: "KWD", name: "Kuwaiti dinar", decimalPlaces: 3, symbol: "KWD" },
      ] as never),
    );
    expect(screen.getByLabelText("Amount")).toBeEnabled();
    expect(screen.getByLabelText("Amount")).toHaveValue("1.001");
  });
});
