import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@/test/render";
import { SharedReviewBanner } from "./SharedReviewBanner";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { useAuthStore } from "@/store/authStore";
import { setAuthenticatedState } from "@/test/mocks/stores";
import type { SharedReviewSummary } from "@/types/shared-expense";

const location = vi.hoisted(() => ({ pathname: "/reports" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => location.pathname,
}));
vi.mock("@/lib/shared-expenses", () => ({
  sharedExpensesApi: { review: vi.fn() },
}));
const summary = (
  patch: Partial<SharedReviewSummary> = {},
): SharedReviewSummary => ({
  ledgerBasis: "ACCEPTED_SHARED_POSTINGS",
  pendingCount: 2,
  unavailableGroupCount: 0,
  groups: [],
  reviewUrl: "/shared-expenses/review",
  checkedAt: "2026-10-26T12:00:00Z",
  ...patch,
});

describe("Shared changes beside personal reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthenticatedState();
    useAuthStore.setState({ actingAsUserId: null });
    location.pathname = "/reports";
    vi.mocked(sharedExpensesApi.review).mockResolvedValue(summary());
  });
  it("shows the server count, accepted-booking basis and a repair link", async () => {
    await act(async () => {
      render(<SharedReviewBanner />);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Shared expenses awaiting your review: 2. Reports include your accepted bookings.",
    );
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/shared-expenses/review",
    );
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(sharedExpensesApi.review).toHaveBeenCalledTimes(2);
  });
  it("hides a known zero but explains a revoked group's unknown current state", async () => {
    vi.mocked(sharedExpensesApi.review).mockResolvedValue(
      summary({ pendingCount: 0 }),
    );
    const view = await act(async () => render(<SharedReviewBanner />));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    vi.mocked(sharedExpensesApi.review).mockResolvedValue(
      summary({ pendingCount: 0, unavailableGroupCount: 1 }),
    );
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Linked groups with access ended: 1.",
    );
    view.unmount();
  });
  it("does not prompt a connected group with no changes to accepted finances", async () => {
    vi.mocked(sharedExpensesApi.review).mockResolvedValue(
      summary({
        pendingCount: 0,
        groups: [
          {
            groupId: "group",
            accountId: "account",
            accountName: "Trip",
            pendingCount: 0,
            accessRevoked: false,
          },
        ],
      }),
    );
    await act(async () => render(<SharedReviewBanner />));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
  it("keeps a failed request distinct from zero, with retry", async () => {
    vi.mocked(sharedExpensesApi.review).mockRejectedValueOnce(
      new Error("network"),
    );
    await act(async () => {
      render(<SharedReviewBanner />);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be checked");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("review: 2");
  });
  it.each(["/settings", "/shared-expenses", "/login"])(
    "does not fetch on %s",
    async (pathname) => {
      location.pathname = pathname;
      await act(async () => {
        render(<SharedReviewBanner />);
      });
      expect(sharedExpensesApi.review).not.toHaveBeenCalled();
    },
  );
  it("never requests private review data in a delegate context or after sign-out", async () => {
    useAuthStore.setState({ actingAsUserId: "owner" });
    const view = await act(async () => render(<SharedReviewBanner />));
    await act(async () => {
      useAuthStore.setState({ actingAsUserId: null, isAuthenticated: false });
    });
    expect(sharedExpensesApi.review).not.toHaveBeenCalled();
    view.unmount();
  });
  it("cannot show a late old-user response after the active identity changes", async () => {
    let resolveOld!: (value: SharedReviewSummary) => void;
    vi.mocked(sharedExpensesApi.review)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(summary({ pendingCount: 0 }));
    await act(async () => {
      render(<SharedReviewBanner />);
    });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await act(async () => {
      const user = useAuthStore.getState().user!;
      useAuthStore.setState({ user: { ...user, id: "new-user" } });
    });
    await act(async () => {
      resolveOld(summary({ pendingCount: 9 }));
    });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(sharedExpensesApi.review).toHaveBeenCalledTimes(2);
  });
});
