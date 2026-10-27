import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@/test/render";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import type { SharedFinanceOverview } from "@/types/shared-expense";
import { SharedFinances } from "./SharedFinances";
import { sharedGroupFixture } from "./__fixtures__/shared-fixtures";

vi.mock("@/lib/shared-expenses", async (original) => ({
  ...(await original<typeof import("@/lib/shared-expenses")>()),
  sharedExpensesApi: { finances: vi.fn(), enableFinance: vi.fn() },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const overview: SharedFinanceOverview = {
  integration: {
    id: "integration",
    accountId: "account",
    currencyCode: "PLN",
    participantId: "me",
  },
  pendingCount: 0,
  entries: [
    {
      entryId: "entry",
      title: "Dinner",
      date: "2026-10-25",
      type: "EXPENSE",
      state: "POSTED",
      revision: 1,
      effect: {
        cash: "0.0000",
        originalCash: "0.0000",
        originalCurrency: "PLN",
        personal: "-100.0000",
        position: "-100.0000",
      },
      needsReview: false,
      reviewReason: "NOT_BOOKED",
      posting: null,
    },
  ],
};

describe("Optional personal finances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sharedExpensesApi.finances).mockResolvedValue(overview);
  });
  it("offers adding a group-only entry without labelling it a required review", async () => {
    await act(async () =>
      render(<SharedFinances group={sharedGroupFixture()} />),
    );
    expect(screen.getByText("Group only")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to My Finances" }),
    ).toBeEnabled();
    expect(screen.queryByText("Needs your review")).not.toBeInTheDocument();
  });
  it("keeps previous rows non-actionable during a reload and after its failure", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(sharedExpensesApi.finances)
      .mockResolvedValueOnce(overview)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      );
    const view = await act(async () =>
      render(<SharedFinances group={sharedGroupFixture()} />),
    );
    await act(async () =>
      view.rerender(
        <SharedFinances group={sharedGroupFixture({ revision: 3 })} />,
      ),
    );
    expect(
      screen.getByRole("button", { name: "Add to My Finances" }),
    ).toBeDisabled();
    await act(async () => reject(new Error("Refresh failed")));
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
    expect(
      screen.getByRole("button", { name: "Add to My Finances" }),
    ).toBeDisabled();
  });
  it("uses the group name for setup, with a name override behind More options", async () => {
    vi.mocked(sharedExpensesApi.finances).mockResolvedValue({
      integration: null,
      entries: [],
      pendingCount: 0,
    });
    await act(async () =>
      render(<SharedFinances group={sharedGroupFixture()} />),
    );
    const accountName = screen.getByLabelText("Account name (optional)");
    expect(accountName).toHaveValue("Weekend");
    expect(accountName.closest("details")).not.toHaveAttribute("open");
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Set Up My Finances" }),
      ),
    );
    expect(sharedExpensesApi.enableFinance).toHaveBeenCalledWith(
      "group",
      expect.objectContaining({ accountName: "Weekend" }),
    );
  });
});
