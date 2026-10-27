import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@/test/render";
import { useAuthStore } from "@/store/authStore";
import { transactionsApi } from "@/lib/transactions";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import {
  sharedEntryFixture,
  sharedGroupFixture,
} from "@/components/shared-expenses/__fixtures__/shared-fixtures";
import ShareBankPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ transactionId: "bank-row" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/transactions", () => ({
  transactionsApi: { getById: vi.fn() },
}));
vi.mock("@/lib/shared-expenses", async (original) => ({
  ...(await original<typeof import("@/lib/shared-expenses")>()),
  sharedExpensesApi: { groups: vi.fn(), group: vi.fn(), finances: vi.fn() },
}));

describe("Continue from a saved payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: "owner" } as never,
      actingAsUserId: null,
    });
    vi.mocked(transactionsApi.getById).mockResolvedValue({
      id: "bank-row",
      userId: "owner",
      amount: -300,
      currencyCode: "PLN",
      account: { accountType: "CHEQUING" },
    } as never);
    vi.mocked(sharedExpensesApi.groups).mockResolvedValue([
      sharedGroupFixture(),
      sharedGroupFixture({ id: "other", name: "Other" }),
    ]);
    vi.mocked(sharedExpensesApi.group).mockResolvedValue(
      sharedGroupFixture({
        entries: [
          sharedEntryFixture({
            ownEffect: {
              cash: "-300.0000",
              personal: "-150.0000",
              position: "150.0000",
              originalCash: "-300.0000",
              originalCurrency: "PLN",
            },
          }),
        ],
      }),
    );
    vi.mocked(sharedExpensesApi.finances).mockResolvedValue({
      integration: {
        id: "integration",
        accountId: "position",
        currencyCode: "PLN",
        participantId: "me",
      },
      entries: [],
      pendingCount: 0,
    });
  });
  it("offers creating first and loads matching only when requested", async () => {
    await act(async () => render(<ShareBankPage />));
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Group"), {
        target: { value: "group" },
      }),
    );
    expect(
      screen.getByRole("button", { name: "Create A Shared Expense" }),
    ).toBeEnabled();
    expect(sharedExpensesApi.finances).not.toHaveBeenCalled();
    const details = screen
      .getByText("Already in the group?")
      .closest("details")!;
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(sharedExpensesApi.finances).toHaveBeenCalledWith("group");
    expect(
      screen.getByRole("button", { name: "Use This Expense" }),
    ).toBeEnabled();
    let reject!: (error: Error) => void;
    vi.mocked(sharedExpensesApi.group).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Search"), {
        target: { value: "New search" },
      }),
    );
    expect(
      screen.getByRole("button", { name: "Use This Expense" }),
    ).toBeDisabled();
    await act(async () => reject(new Error("Search failed")));
    expect(screen.getByRole("alert")).toHaveTextContent("Search failed");
    expect(
      screen.getByRole("button", { name: "Use This Expense" }),
    ).toBeDisabled();
  });
  it("removes the old group's action while another group loads or fails", async () => {
    await act(async () => render(<ShareBankPage />));
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Group"), {
        target: { value: "group" },
      }),
    );
    expect(
      screen.getByRole("button", { name: "Create A Shared Expense" }),
    ).toBeEnabled();
    let reject!: (error: Error) => void;
    vi.mocked(sharedExpensesApi.group).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Group"), {
        target: { value: "other" },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Create A Shared Expense" }),
    ).not.toBeInTheDocument();
    await act(async () => reject(new Error("Access revoked")));
    expect(screen.getByRole("alert")).toHaveTextContent("Access revoked");
    expect(
      screen.queryByRole("button", { name: "Create A Shared Expense" }),
    ).not.toBeInTheDocument();
  });
});
