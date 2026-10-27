import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/render";
import { SharedSplitEditor } from "./SharedSplitEditor";
import { initialSharedEntry } from "@/lib/shared-split-draft";
import { sharedGroupFixture } from "./__fixtures__/shared-fixtures";

function setup() {
  const group = sharedGroupFixture();
  const input = { ...initialSharedEntry(group, "2026-10-25"), amount: "100" };
  const onApply = vi.fn(),
    onClose = vi.fn();
  render(
    <SharedSplitEditor
      input={input}
      participants={group.participants}
      places={2}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose, input };
}
describe("SharedSplitEditor", () => {
  it("cancels local edits without replacing the parent's split", () => {
    const { input, onApply, onClose } = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Anna" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    expect(input.shares).toHaveLength(2);
  });
  it("keeps mode drafts and assigns only the missing exact amount", () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Exact amounts" }));
    fireEvent.change(screen.getByLabelText("Share for Me"), {
      target: { value: "35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shares" }));
    fireEvent.click(screen.getByRole("button", { name: "Exact amounts" }));
    expect(screen.getByLabelText("Share for Me")).toHaveValue("35.00");
    fireEvent.click(screen.getByRole("button", { name: /remainder.*Anna/i }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Split" }));
    expect(onApply).toHaveBeenCalledWith({
      splitMode: "EXACT",
      shares: [
        { participantId: "me", value: "35" },
        { participantId: "anna", value: "65.00" },
      ],
    });
  });
  it("identifies a missing 0.01 percent instead of normalizing 99.99 percent", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Percentages" }));
    fireEvent.change(screen.getByLabelText("Share for Me"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("Share for Anna"), {
      target: { value: "49.99" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("0.01%");
    expect(screen.getByRole("button", { name: "Apply Split" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Share for Anna"), {
      target: { value: "50" },
    });
    expect(screen.getByRole("button", { name: "Apply Split" })).toBeEnabled();
  });
  it("explains why an empty selection cannot be applied", () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Me" }));
    fireEvent.click(screen.getByRole("switch", { name: "Anna" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose at least one person",
    );
    expect(screen.getByRole("button", { name: "Apply Split" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });
  it("keeps extras optional and only applies their calculation on request", () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Exact amounts" }));
    fireEvent.change(screen.getByLabelText("Share for Me"), {
      target: { value: "20" },
    });
    const disclosure = screen
      .getByText("More split options")
      .closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByText("More split options"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByLabelText("Share for Me")).toHaveValue("20.00");
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Extras, then split the rest equally",
      }),
    );
    expect(screen.getByLabelText("Share for Me")).toHaveValue("60.00");
    expect(screen.getByLabelText("Share for Anna")).toHaveValue("40.00");
    expect(screen.getByRole("status")).toHaveTextContent("Ready to apply");
    expect(screen.getByRole("status")).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: /Give remainder/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply Split" }));
    expect(onApply).toHaveBeenCalledWith({
      splitMode: "EXACT",
      shares: [
        { participantId: "me", value: "60.00" },
        { participantId: "anna", value: "40.00" },
      ],
    });
  });
  it("names over-allocation and does not offer a positive-remainder action", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Exact amounts" }));
    fireEvent.change(screen.getByLabelText("Share for Me"), {
      target: { value: "120" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Over-allocated:.*20/);
    expect(screen.getByRole("button", { name: "Apply Split" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Give remainder/ }),
    ).not.toBeInTheDocument();
  });
});
