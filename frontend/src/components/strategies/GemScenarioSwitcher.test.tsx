import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@/test/render";
import { GemScenarioSwitcher } from "./GemScenarioSwitcher";

const twoScenarios = [
  { id: "strategy-1", name: "GEM 12m" },
  { id: "strategy-2", name: "GEM 6m" },
];

const renderSwitcher = (overrides: Record<string, unknown> = {}) => {
  const onSelect = vi.fn();
  // Three outcomes, not a boolean, and only "failed" keeps a dialog open:
  // `undefined` described a contract these no longer have, and a boolean could
  // not tell a refusal from a deferral.
  const onCreate = vi.fn().mockResolvedValue("done");
  const onDelete = vi.fn().mockResolvedValue("done");
  const props = {
    currentId: "strategy-1",
    currentName: "GEM 12m",
    scenarios: twoScenarios,
    onSelect,
    onCreate,
    onDelete,
    ...overrides,
  };
  const asProps = (extra: Record<string, unknown>) =>
    ({ ...props, ...extra }) as unknown as ComponentProps<
      typeof GemScenarioSwitcher
    >;
  const view = render(<GemScenarioSwitcher {...asProps({})} />);
  const rerenderWith = (next: Record<string, unknown>) =>
    view.rerender(<GemScenarioSwitcher {...asProps(next)} />);
  return { onSelect, onCreate, onDelete, rerenderWith };
};

/** The confirm button inside the dialog, which shares the trigger's label. */
const confirmDelete = () =>
  screen
    .getAllByRole("button", { name: "Delete scenario" })
    .at(-1) as HTMLElement;

describe("GemScenarioSwitcher", () => {
  it("offers the other scenarios and reports the pick", async () => {
    const { onSelect } = renderSwitcher();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch scenario" }));
    });
    // The scenario on screen is not offered as a destination.
    expect(screen.queryByRole("menuitem", { name: /GEM 12m/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /GEM 6m/ }));
    });

    expect(onSelect).toHaveBeenCalledWith("strategy-2");
  });

  it("hides the switcher until there is somewhere to switch to", () => {
    renderSwitcher({ scenarios: [twoScenarios[0]] });

    expect(
      screen.queryByRole("button", { name: "Switch scenario" }),
    ).toBeNull();
    // Creating one is still offered; that is how the second comes to exist.
    expect(
      screen.getByRole("button", { name: "New scenario" }),
    ).toBeInTheDocument();
  });

  it("creates a scenario with the typed name, trimmed", async () => {
    const { onCreate } = renderSwitcher();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "  IKZE quarterly  " },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(onCreate).toHaveBeenCalledWith("IKZE quarterly");
    // Accepted, so the dialog is done with.
    expect(screen.queryByLabelText("Scenario name")).not.toBeInTheDocument();
  });

  it("will not create a scenario with no name", async () => {
    // The server refuses a blank name, and its refusal arrives as a generic
    // toast that says nothing about which field was wrong. The button says so
    // instead, before the round-trip.
    const { onCreate } = renderSwitcher();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    });

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    // Whitespace is not a name either.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "   " },
      });
    });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Scenario name"), {
        key: "Enter",
      });
    });
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "IKZE" },
      });
    });
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("creates the scenario when Enter is pressed in the name field", async () => {
    // The dialog is not a `<form>` -- it renders inside the report page's own --
    // so Enter had to be wired up rather than inherited, and without it the
    // field looked like every other one that submits on Enter and did nothing.
    const { onCreate } = renderSwitcher();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "  IKZE quarterly  " },
      });
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Scenario name"), {
        key: "Enter",
      });
    });

    expect(onCreate).toHaveBeenCalledWith("IKZE quarterly");
    expect(screen.queryByLabelText("Scenario name")).not.toBeInTheDocument();
  });

  /**
   * The parent catches its own errors, so the switcher saw a resolved promise
   * whether the server accepted the scenario or rejected it, and closed either
   * way -- discarding the name the user had just typed.
   */
  it("keeps the create dialog and the typed name when the server refuses", async () => {
    const onCreate = vi.fn().mockResolvedValue("failed");
    renderSwitcher({ onCreate });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "IKZE quarterly" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(onCreate).toHaveBeenCalledWith("IKZE quarterly");
    const field = screen.getByLabelText("Scenario name") as HTMLInputElement;
    expect(field).toBeInTheDocument();
    expect(field.value).toBe("IKZE quarterly");
  });

  it("closes the create dialog when the parent defers the create", async () => {
    // Deferred is not refused: the scenario will be created once the unsaved
    // edits are dealt with, and leaving the dialog up invites a second one.
    const onCreate = vi.fn().mockResolvedValue("deferred");
    renderSwitcher({ onCreate });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Scenario name"), {
        target: { value: "IKZE quarterly" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(onCreate).toHaveBeenCalledWith("IKZE quarterly");
    expect(screen.queryByLabelText("Scenario name")).not.toBeInTheDocument();
  });

  it("warns that deleting takes the evaluation history with it", async () => {
    const { onDelete } = renderSwitcher();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    });
    expect(screen.getByText(/whole evaluation history/)).toBeInTheDocument();
    expect(screen.getByText(/GEM 12m/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen
          .getAllByRole("button", { name: "Delete scenario" })
          .at(-1) as HTMLElement,
      );
    });
    expect(onDelete).toHaveBeenCalledWith("strategy-1");
    expect(
      screen.queryByText(/whole evaluation history/),
    ).not.toBeInTheDocument();
  });

  it("keeps the delete confirmation open when the server refuses", async () => {
    const onDelete = vi.fn().mockResolvedValue("failed");
    renderSwitcher({ onDelete });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    });
    await act(async () => {
      fireEvent.click(confirmDelete());
    });

    expect(onDelete).toHaveBeenCalledWith("strategy-1");
    // Still on screen, with its context, so retry is one click.
    expect(screen.getByText(/whole evaluation history/)).toBeInTheDocument();
  });

  /**
   * Invariant: a confirmation deletes the scenario it was opened for, or
   * nothing.
   * Canonical adversarial input: a mutation response landing after the
   * selection changed -- here the selection changes because of the mutation.
   * Minimal mutation: keep the confirmation open on a deferred delete, and
   * read `currentId` at confirm time.
   * Test that fails under it: both of the two below.
   */
  it("closes the confirmation when the delete is deferred, not refused", async () => {
    // The parent holds the delete behind its unsaved-changes prompt. That is
    // not the server saying no, and leaving the confirmation up is how it
    // ends up aimed at the next scenario.
    const onDelete = vi.fn().mockResolvedValue("deferred");
    renderSwitcher({ onDelete });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    });
    await act(async () => {
      fireEvent.click(confirmDelete());
    });

    expect(onDelete).toHaveBeenCalledWith("strategy-1");
    expect(
      screen.queryByText(/whole evaluation history/),
    ).not.toBeInTheDocument();
  });

  it("never retargets an open confirmation at the scenario that replaced its subject", async () => {
    const onDelete = vi.fn().mockResolvedValue("failed");
    const { rerenderWith } = renderSwitcher({ onDelete });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));
    });
    expect(screen.getByText(/GEM 12m/)).toBeInTheDocument();

    // The subject is gone and GEM 6m is now current. Whatever the dialog was
    // asking about, it was not this.
    await act(async () => {
      rerenderWith({
        currentId: "strategy-2",
        currentName: "GEM 6m",
        scenarios: [twoScenarios[1], { id: "strategy-3", name: "GEM 3m" }],
      });
    });

    expect(
      screen.queryByText(/whole evaluation history/),
    ).not.toBeInTheDocument();
    // And no confirm survives to be clicked a second time.
    expect(
      screen.getAllByRole("button", { name: "Delete scenario" }),
    ).toHaveLength(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("never offers to delete the last scenario", () => {
    renderSwitcher({ scenarios: [twoScenarios[0]] });

    // Deleting it would leave nothing to report on; clearing it is the way out.
    expect(
      screen.queryByRole("button", { name: "Delete scenario" }),
    ).toBeNull();
  });

  it("locks the controls while a scenario call is in flight", () => {
    renderSwitcher({ busy: true });

    expect(screen.getByRole("button", { name: "New scenario" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete scenario" }),
    ).toBeDisabled();
  });
});
