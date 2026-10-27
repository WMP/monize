import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/test/render";
import { SharedGroupForm } from "./SharedGroupForm";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { exchangeRatesApi } from "@/lib/exchange-rates";

vi.mock("@/lib/shared-expenses", async (original) => ({
  ...(await original<typeof import("@/lib/shared-expenses")>()),
  sharedExpensesApi: { createGroup: vi.fn(), people: vi.fn() },
}));
vi.mock("@/lib/exchange-rates", async (original) => ({
  ...(await original<typeof import("@/lib/exchange-rates")>()),
  exchangeRatesApi: { getCurrencies: vi.fn() },
}));
describe("SharedGroupForm", () => {
  beforeEach(() => {
    vi.mocked(sharedExpensesApi.createGroup).mockReset();
    vi.mocked(sharedExpensesApi.people).mockResolvedValue([]);
    vi.mocked(exchangeRatesApi.getCurrencies).mockResolvedValue([
      { code: "CAD", name: "Canadian dollar", decimalPlaces: 2, symbol: "$" },
    ] as never);
  });
  it("creates a group with named people without requiring invitations or accounts", async () => {
    vi.mocked(sharedExpensesApi.createGroup).mockResolvedValue({
      id: "new-group",
    });
    const onCreated = vi.fn();
    render(<SharedGroupForm onClose={vi.fn()} onCreated={onCreated} />);
    await screen.findByRole("option", { name: /Canadian dollar/ });
    expect(screen.getByRole("button", { name: "Create group" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: " Weekend " },
    });
    fireEvent.change(screen.getByLabelText("Your name in this group"), {
      target: { value: " Me " },
    });
    fireEvent.change(screen.getByLabelText("Person’s name"), {
      target: { value: " Anna " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-group"));
    expect(sharedExpensesApi.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Weekend",
        myName: "Me",
        participants: [{ name: "Anna" }],
      }),
    );
  });
  it("keeps an unsuccessful create available for retry with its operation ID", async () => {
    vi.mocked(sharedExpensesApi.createGroup)
      .mockRejectedValueOnce(new Error("Network failed"))
      .mockResolvedValueOnce({ id: "new-group" });
    const onCreated = vi.fn();
    render(<SharedGroupForm onClose={vi.fn()} onCreated={onCreated} />);
    await screen.findByRole("option", { name: /Canadian dollar/ });
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Weekend" },
    });
    fireEvent.change(screen.getByLabelText("Your name in this group"), {
      target: { value: "Me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network failed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(vi.mocked(sharedExpensesApi.createGroup).mock.calls[0]).toEqual(
      vi.mocked(sharedExpensesApi.createGroup).mock.calls[1],
    );
  });
  it("reuses a saved private person without inviting or exposing their payee", async () => {
    vi.mocked(sharedExpensesApi.people).mockResolvedValue([
      { id: "contact", name: "Anna", payeeId: "private-payee", groups: [] },
    ]);
    vi.mocked(sharedExpensesApi.createGroup).mockResolvedValue({
      id: "new-group",
    });
    render(<SharedGroupForm onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(
      await screen.findByLabelText("Add someone from your people"),
      { target: { value: "contact" } },
    );
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Weekend" },
    });
    fireEvent.change(screen.getByLabelText("Your name in this group"), {
      target: { value: "Me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(sharedExpensesApi.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          participants: [{ name: "Anna", personId: "contact" }],
        }),
      ),
    );
  });
});
