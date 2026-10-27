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
    fireEvent.click(screen.getByRole("checkbox", { name: "Anna" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Apply split" }));
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
    expect(screen.getByRole("button", { name: "Apply split" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Share for Anna"), {
      target: { value: "50" },
    });
    expect(screen.getByRole("button", { name: "Apply split" })).toBeEnabled();
  });
});
