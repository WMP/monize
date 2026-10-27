import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/test/render";
import { SharedBooking } from "./SharedBooking";
import { sharedGroupFixture } from "./__fixtures__/shared-fixtures";
import { accountsApi } from "@/lib/accounts";
import { categoriesApi } from "@/lib/categories";
import { payeesApi } from "@/lib/payees";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { useAuthStore } from "@/store/authStore";
import type {
  SharedFinanceOverview,
  SharedFinancePreview,
} from "@/types/shared-expense";

vi.mock("@/lib/accounts", () => ({ accountsApi: { getAll: vi.fn() } }));
vi.mock("@/lib/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/lib/payees", () => ({ payeesApi: { getAll: vi.fn() } }));
vi.mock("@/lib/shared-expenses", async (original) => ({
  ...(await original<typeof import("@/lib/shared-expenses")>()),
  sharedExpensesApi: { previewFinance: vi.fn(), book: vi.fn() },
}));
const effect = {
  cash: "-300.0000",
  originalCash: "-300.0000",
  personal: "-100.0000",
  position: "200.0000",
  originalCurrency: "PLN",
};
const row: SharedFinanceOverview["entries"][number] = {
  entryId: "entry",
  title: "Dinner",
  date: "2026-01-10",
  type: "EXPENSE",
  state: "POSTED",
  revision: 1,
  effect,
  posting: null,
  needsReview: true,
};
const preview: SharedFinancePreview = {
  effect,
  previous: null,
  fingerprint: "accepted",
  bankCurrency: "PLN",
  settlementCurrency: "PLN",
  sourceTransactionId: null,
  breakdown: {
    bankTotal: "-300.0000",
    sharedPortion: "-300.0000",
    agreedPortion: "-300.0000",
    privateRemainder: "0.0000",
    fxDifference: "0.0000",
  },
};
describe("Personal booking review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: "owner" } as never,
      actingAsUserId: null,
    });
    vi.mocked(accountsApi.getAll).mockResolvedValue([
      {
        id: "bank",
        userId: "owner",
        name: "My bank",
        currencyCode: "PLN",
        accountType: "CHEQUING",
      },
    ] as never);
    vi.mocked(categoriesApi.getAll).mockResolvedValue([]);
    vi.mocked(payeesApi.getAll).mockResolvedValue([]);
    vi.mocked(sharedExpensesApi.previewFinance).mockResolvedValue(preview);
    vi.mocked(sharedExpensesApi.book).mockResolvedValue({});
  });
  it("keeps contribution parts separate and invalidates the preview after changing a source", async () => {
    render(
      <SharedBooking
        group={sharedGroupFixture()}
        row={row}
        initialInput={{ bankAccountId: "bank", bankAmount: "300" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "My bank · PLN" });
    fireEvent.click(
      screen.getByRole("button", { name: "Add another payment" }),
    );
    const parts = screen.getAllByLabelText(
      "Part of my contribution covered by this payment",
    );
    fireEvent.change(parts[0], { target: { value: "200" } });
    fireEvent.change(parts[1], { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview my ledger" }));
    await waitFor(() =>
      expect(sharedExpensesApi.previewFinance).toHaveBeenCalledOnce(),
    );
    const sent = vi.mocked(sharedExpensesApi.previewFinance).mock.calls[0][2];
    expect(sent).toMatchObject({
      payments: [
        { bankAccountId: "bank", contributionAmount: "200" },
        { contributionAmount: "100" },
      ],
    });
    expect(sent.bankAccountId).toBeUndefined();
    await screen.findByRole("button", { name: "Accept booking" });
    fireEvent.change(parts[1], { target: { value: "90" } });
    expect(
      screen.queryByRole("button", { name: "Accept booking" }),
    ).not.toBeInTheDocument();
    expect(sharedExpensesApi.book).not.toHaveBeenCalled();
  });
  it("passes the combined preview to its one commit callback without posting a standalone booking", async () => {
    const onPreview = vi
      .fn()
      .mockResolvedValue({ ...preview, commitFingerprint: "combined" });
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <SharedBooking
        group={sharedGroupFixture()}
        row={row}
        initialInput={{ bankAccountId: "bank", bankAmount: "300" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    await screen.findByRole("option", { name: "My bank · PLN" });
    fireEvent.click(screen.getByRole("button", { name: "Preview my ledger" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept booking" }),
    );
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit.mock.calls[0][1].commitFingerprint).toBe("combined");
    expect(sharedExpensesApi.book).not.toHaveBeenCalled();
  });
});
