import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@/test/render";
import { GemStrategyReport } from "./GemStrategyReport";
import { TOUR_ANCHORS, tourAnchorSelector } from "@/lib/tours/anchors";
import { gemReport } from "@/test/gem-fixtures";

/**
 * Report-side anchors for the GEM release tour (`release-1.14.0/gem-strategy`).
 * The tour walks the Overview tab top to bottom and then opens Settings through
 * the header's Edit settings button, so each of those regions needs a stable
 * anchor and the walk must not write anything.
 */

vi.mock("recharts", async () =>
  (await import("@/test/recharts-mock")).rechartsMock(),
);

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockGetReport = vi.fn();
const mockMarkExecuted = vi.fn();
const mockUpdateConfig = vi.fn();
vi.mock("@/lib/gem-strategy", () => ({
  gemStrategyApi: {
    getReport: (...args: unknown[]) => mockGetReport(...args),
    markExecuted: (...args: unknown[]) => mockMarkExecuted(...args),
    createStrategy: vi.fn(),
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
    deleteStrategy: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockCreateSecurity = vi.fn();
vi.mock("@/lib/accounts", () => ({
  accountsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/lib/investments", () => ({
  investmentsApi: {
    getSecurities: vi.fn().mockResolvedValue([]),
    createSecurity: (...args: unknown[]) => mockCreateSecurity(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** The Overview-tab anchors, in the order the tour visits them. */
const OVERVIEW_ANCHORS = [
  TOUR_ANCHORS.gemStrategyHeader,
  TOUR_ANCHORS.gemStrategyOverviewCards,
  TOUR_ANCHORS.gemStrategyChartAndAction,
  TOUR_ANCHORS.gemStrategyReasoning,
  TOUR_ANCHORS.gemStrategyTabs,
  TOUR_ANCHORS.gemStrategyEditSettings,
] as const;

async function renderReport() {
  await act(async () => {
    render(<GemStrategyReport />);
  });
}

function anchor(id: string) {
  return document.querySelector(tourAnchorSelector(id as never));
}

describe("GemStrategyReport guided-tour anchors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReport.mockResolvedValue(gemReport());
  });

  it("exposes every Overview anchor the tour points at", async () => {
    await renderReport();
    for (const id of OVERVIEW_ANCHORS) {
      expect(anchor(id), id).toBeInTheDocument();
    }
  });

  it("anchors the chart-and-action step on the grid, not the action card", async () => {
    await renderReport();
    const grid = anchor(TOUR_ANCHORS.gemStrategyChartAndAction);
    // GemNextActionCard is rendered on the Portfolio tab too, so anchoring the
    // card itself would attach the id in two places and break uniqueness. The
    // grid exists only here, and holds both things the step describes.
    expect(grid).toBeInTheDocument();
    expect(grid).toContainElement(
      screen.getByRole("heading", { level: 2, name: /What should I do\?/ }),
    );
  });

  it("keeps the reasoning anchor when there is no signal to explain", async () => {
    // A strategy with no signal yet renders the reasoning card as an empty
    // state. The anchor rides the card, so the step still has something to point
    // at rather than being silently skipped.
    mockGetReport.mockResolvedValue(gemReport({ signal: null }));
    await renderReport();
    expect(anchor(TOUR_ANCHORS.gemStrategyReasoning)).toBeInTheDocument();
  });

  it("opens the Settings tab from the anchored Edit settings button", async () => {
    await renderReport();
    const button = anchor(TOUR_ANCHORS.gemStrategyEditSettings);
    expect(button).toBeInTheDocument();

    // The tour's `openSettings` step advances on a click of this button, so the
    // click has to land on the settings tab without navigating.
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });

    expect(
      screen.getByRole("tab", { name: "Settings", selected: true }),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reaches the settings anchors without writing anything", async () => {
    await renderReport();
    await act(async () => {
      fireEvent.click(
        anchor(TOUR_ANCHORS.gemStrategyEditSettings) as HTMLElement,
      );
    });

    // The remaining five steps live in the settings form, which is now mounted.
    expect(anchor(TOUR_ANCHORS.gemSettingsAccounts)).toBeInTheDocument();
    expect(anchor(TOUR_ANCHORS.gemSettingsAssets)).toBeInTheDocument();
    expect(anchor(TOUR_ANCHORS.gemSettingsSave)).toBeInTheDocument();

    // Walking the tour is read-only end to end.
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(mockMarkExecuted).not.toHaveBeenCalled();
    expect(mockCreateSecurity).not.toHaveBeenCalled();
  });
});
