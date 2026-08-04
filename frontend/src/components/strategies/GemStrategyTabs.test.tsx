import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/render";
import { GEM_TABS, GemStrategyTabs } from "./GemStrategyTabs";

describe("GemStrategyTabs", () => {
  it("renders every tab with one tab stop on the active one", () => {
    render(<GemStrategyTabs active="overview" onChange={vi.fn()} />);

    expect(
      screen.getByRole("tablist", { name: "GEM strategy sections" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(GEM_TABS.length);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Signals" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("selects a tab on click", () => {
    const onChange = vi.fn();
    render(<GemStrategyTabs active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Backtest" }));
    expect(onChange).toHaveBeenCalledWith("backtest");
  });

  it("moves selection with the arrow keys, wrapping at both ends", () => {
    const onChange = vi.fn();
    render(<GemStrategyTabs active="overview" onChange={onChange} />);
    const overview = screen.getByRole("tab", { name: "Overview" });

    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("signals");

    fireEvent.keyDown(overview, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("settings");
  });

  it("jumps to the first and last tab with Home and End", () => {
    const onChange = vi.fn();
    render(<GemStrategyTabs active="portfolio" onChange={onChange} />);
    const portfolio = screen.getByRole("tab", { name: "My portfolio" });

    fireEvent.keyDown(portfolio, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("settings");

    fireEvent.keyDown(portfolio, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("overview");
  });

  it("ignores unrelated keys", () => {
    const onChange = vi.fn();
    render(<GemStrategyTabs active="overview" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), {
      key: "a",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("points aria-controls only at the panel that exists", () => {
    // Only the selected tab's panel is rendered, and `aria-controls` must not
    // name an element that is not in the document -- a screen reader following
    // it lands nowhere. This is why the bar is the shared `ui/Tabs`: the
    // hand-rolled one set the attribute on all five.
    render(<GemStrategyTabs active="portfolio" onChange={vi.fn()} />);

    expect(
      screen.getByRole("tab", { name: "My portfolio" }),
    ).toHaveAttribute("aria-controls", "gem-panel-portfolio");
    for (const name of ["Overview", "Signals", "Backtest", "Settings"]) {
      expect(screen.getByRole("tab", { name })).not.toHaveAttribute(
        "aria-controls",
      );
    }
  });

  it("keeps the id convention the report's panels point back at", () => {
    render(<GemStrategyTabs active="overview" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "id",
      "gem-tab-overview",
    );
  });
});
