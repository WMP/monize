import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@/test/render";
import { GemInstrumentSelect } from "./GemInstrumentSelect";
import { Security } from "@/types/investment";
import { GemSuggestedSecurity } from "@/lib/gem-suggested-securities";

/**
 * The picker had no keyboard behaviour at all: its entries were reachable only
 * by Tab, one stop each, with no arrow keys, no Home/End and no typeahead --
 * everything the shared `Combobox` carries and this control cannot borrow,
 * because it needs region-grouped sections and two actions per row. So it is
 * asserted here instead.
 */
const security = (id: string, symbol: string, name: string): Security =>
  ({ id, symbol, name, currencyCode: "USD" }) as Security;

const securities = [
  security("sec-vti", "VTI", "Total US Market"),
  security("sec-iemg", "IEMG", "Emerging Markets"),
  security("sec-ief", "IEF", "7-10 Year Treasury"),
];

const suggestion: GemSuggestedSecurity = {
  symbol: "SPY",
  name: "SPDR S&P 500",
  region: "AMERICAS",
  exchange: "NYSEARCA",
  currencyCode: "USD",
} as GemSuggestedSecurity;

function setup(props: Partial<Parameters<typeof GemInstrumentSelect>[0]> = {}) {
  const onChange = vi.fn();
  const onPickSuggestion = vi.fn();
  render(
    <GemInstrumentSelect
      role="US_EQUITY"
      label="US equities"
      value=""
      securities={securities}
      ownedBySymbol={new Map()}
      suggestions={[suggestion]}
      onChange={onChange}
      onPickSuggestion={onPickSuggestion}
      {...props}
    />,
  );
  return { onChange, onPickSuggestion };
}

const trigger = () => screen.getByRole("button", { name: "US equities" });

/** The entry the browser considers focused, by its accessible text. */
const focusedOption = () => document.activeElement?.textContent?.trim() ?? "";

describe("GemInstrumentSelect", () => {
  it("opens on ArrowDown with the first entry focused", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(focusedOption()).toContain("SPY");
  });

  it("opens on ArrowUp with the last entry focused", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    });

    expect(focusedOption()).toContain("IEF");
  });

  it("moves through the entries with the arrow keys, wrapping at both ends", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });

    // SPY (suggestion) -> No instrument -> VTI
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    });
    expect(focusedOption()).toBe("No instrument");
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    });
    expect(focusedOption()).toContain("VTI");

    // ...and back off the top onto the last entry.
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Home" });
    });
    expect(focusedOption()).toContain("SPY");
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    });
    expect(focusedOption()).toContain("IEF");
  });

  it("jumps to the end and back with End and Home", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "End" });
    });
    expect(focusedOption()).toContain("IEF");
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Home" });
    });
    expect(focusedOption()).toContain("SPY");
  });

  it("finds an entry by typing its symbol", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });

    // A single letter matches both IEMG and IEF; two letters still do, and the
    // buffer is what makes `IEM` land on the one the user meant.
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "i" });
    });
    expect(focusedOption()).toContain("IEMG");
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "e" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "f" });
    });
    expect(focusedOption()).toContain("IEF");
  });

  it("cycles through the entries sharing a first letter", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "i" });
    });
    expect(focusedOption()).toContain("IEMG");
    // The same letter again moves on to the next match rather than sticking
    // where it is -- a repeated character is a cycle, not a search for "ii".
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "i" });
    });
    expect(focusedOption()).toContain("IEF");
  });

  it("selects the focused entry with Enter", async () => {
    const { onChange } = setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "End" });
    });
    // Enter on a native button is a click; the entries stay buttons so this is
    // the browser's own activation rather than a second implementation of it.
    await act(async () => {
      fireEvent.click(document.activeElement!);
    });

    expect(onChange).toHaveBeenCalledWith("sec-ief");
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when Tab leaves the popup", async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps the entries out of the tab sequence", () => {
    // One popup, one tab stop. Otherwise Tab walks every instrument the
    // portfolio holds before reaching the next field.
    setup();
    fireEvent.click(trigger());
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
  });

  it("names the popup it controls only while the popup exists", () => {
    setup();
    expect(trigger()).not.toHaveAttribute("aria-controls");
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute(
      "aria-controls",
      "gem-instrument-list-US_EQUITY",
    );
  });

  it("opens the create form for a suggestion the portfolio does not hold", async () => {
    const { onPickSuggestion, onChange } = setup();
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.click(document.activeElement!);
    });

    expect(onPickSuggestion).toHaveBeenCalledWith(suggestion);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects the instrument when the suggestion is already owned", async () => {
    const owned = security("sec-spy", "SPY", "SPDR S&P 500 ETF");
    const { onPickSuggestion, onChange } = setup({
      securities: [owned, ...securities],
      ownedBySymbol: new Map([["SPY", owned]]),
    });
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.click(document.activeElement!);
    });

    expect(onChange).toHaveBeenCalledWith("sec-spy");
    expect(onPickSuggestion).not.toHaveBeenCalled();
  });
});
