import { randomUUID } from "node:crypto";
import { test, expect } from "../fixtures";
import { dismissNotificationPrompt } from "../readme/session";
import { VIDEO_VIEWPORT } from "../readme/settings";
import {
  createAccount,
  createCategory,
  createTransaction,
} from "../helpers/factories";
import {
  createSharedExpense,
  createSharedGroup,
  createSharedSplitSource,
  type SharedGroupFixture,
} from "../helpers/shared-expenses";

test.describe("Shared expense personal review", () => {
  test.use({ viewport: VIDEO_VIEWPORT });

  test.beforeEach(async ({ authedPage }) => {
    await dismissNotificationPrompt(authedPage);
  });

  test("selects category portions, reopens the original split and restores it when unlinked", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api, "Split purchases");
    await createSharedExpense(api, group);
    const bank = await createAccount(api, {
      name: "Shopping card",
      currencyCode: "USD",
      openingBalance: 1000,
    });
    const meal = await createCategory(api, { name: "Shared food" });
    const supplies = await createCategory(api, { name: "Private supplies" });
    const source = await createSharedSplitSource(
      api,
      bank.id,
      meal.id,
      supplies.id,
    );
    const original = await api.get<{
      splits: {
        id: string;
        categoryId: string;
        amount: number | string;
        memo: string;
      }[];
    }>(`/transactions/${source.id}`);
    await page.goto(`/shared-expenses/${group.id}?view=myFinances`);
    await page
      .getByRole("button", { name: "Set Up My Finances", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add to My Finances", exact: true })
      .click();
    const booking = page.getByRole("dialog", {
      name: /^(Add to My Finances|Review My Finances)$/,
      exact: true,
    });
    await booking
      .getByLabel("Payment account", { exact: true })
      .selectOption(bank.id);
    await booking.getByRole("button", { name: /Split market/ }).click();
    await booking
      .getByLabel("Shared part of Meal purchases", { exact: true })
      .fill("200");
    await booking
      .getByLabel("Shared part of Supplies", { exact: true })
      .fill("100");
    await booking
      .getByRole("textbox", { name: "My category", exact: true })
      .click();
    await page.getByText("Shared food", { exact: true }).click();
    await booking
      .getByLabel("Shared part of Meal purchases", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("category-portions-desktop.png"),
      fullPage: false,
      animations: "disabled",
    });
    await booking
      .getByRole("button", { name: "Preview Changes", exact: true })
      .click();
    await expect(
      booking.getByRole("button", { name: "Save to My Finances", exact: true }),
    ).toBeVisible();
    await booking
      .getByRole("button", { name: "Save to My Finances", exact: true })
      .click();
    await expect(booking).toHaveCount(0);
    await page.reload();
    expect(
      Number(
        (await api.get<{ currentBalance: number }>(`/accounts/${bank.id}`))
          .currentBalance,
      ),
    ).toBe(650);
    const changed = await api.get<{
      splits: {
        amount: number | string;
        memo: string;
        categoryId: string;
        transferAccountId: string | null;
      }[];
    }>(`/transactions/${source.id}`);
    expect(changed.splits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: supplies.id, memo: "Supplies" }),
      ]),
    );
    expect(
      Number(changed.splits.find((row) => row.memo === "Supplies")?.amount),
    ).toBe(-50);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(
      booking.getByLabel("Shared part of Meal purchases", { exact: true }),
    ).toHaveValue("200.0000");
    await expect(
      booking.getByLabel("Shared part of Supplies", { exact: true }),
    ).toHaveValue("100.0000");
    await booking
      .getByRole("button", { name: "Remove from My Finances", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Remove from My Finances",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(booking).toHaveCount(0);
    await page.reload();
    const restored = await api.get<typeof original>(
      `/transactions/${source.id}`,
    );
    const comparable = (rows: typeof original.splits) =>
      rows
        .map(({ id, categoryId, amount, memo }) => ({
          id,
          categoryId,
          amount: Number(amount),
          memo,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(comparable(restored.splits)).toEqual(comparable(original.splits));
    expect(
      Number(
        (await api.get<{ currentBalance: number }>(`/accounts/${bank.id}`))
          .currentBalance,
      ),
    ).toBe(650);
  });

  test("shows pending group changes beside reports and applies them only after private review", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api, "Review weekend");
    const entry = await createSharedExpense(api, group, "Shared dinner");
    const bank = await createAccount(api, {
      name: "Review card",
      currencyCode: "USD",
      openingBalance: 1000,
    });
    const category = await createCategory(api, { name: "Review meals" });
    const payment = await createTransaction(api, {
      accountId: bank.id,
      amount: -300,
      categoryId: category.id,
    });
    const latest = await api.get<SharedGroupFixture>(
      `/shared-expenses/groups/${group.id}`,
    );
    await api.post(`/shared-expenses/groups/${group.id}/finances/enable`, {
      operationId: randomUUID(),
      expectedRevision: latest.revision,
      accountName: "Weekend settlements",
    });
    const input = {
      operationId: randomUUID(),
      expectedRevision: 1,
      bankTransactionId: payment.id,
      categoryId: category.id,
    };
    const preview = await api.post<{ fingerprint: string }>(
      `/shared-expenses/groups/${group.id}/finances/entries/${entry.id}/preview`,
      input,
    );
    await api.post(
      `/shared-expenses/groups/${group.id}/finances/entries/${entry.id}/book`,
      { ...input, previewFingerprint: preview.fingerprint },
    );
    // A journal change elsewhere in the group must not silently change this
    // person's already accepted ledger. The browser performs the review below.
    await api.patch(`/shared-expenses/groups/${group.id}/entries/${entry.id}`, {
      operationId: randomUUID(),
      expectedRevision: 1,
      type: "EXPENSE",
      title: "Shared dinner",
      amount: "300",
      currencyCode: "USD",
      date: new Date().toISOString().slice(0, 10),
      splitMode: "EXACT",
      shares: group.participants.map((person) => ({
        participantId: person.id,
        value: person.id === group.myParticipantId ? "80" : "110",
      })),
      contributions: [{ participantId: group.myParticipantId, value: "300" }],
    });
    const before = await api.get<{
      integration: { accountId: string; currentBalance: string };
      pendingCount: number;
    }>(`/shared-expenses/groups/${group.id}/finances`);
    expect(before.pendingCount).toBe(1);
    expect(Number(before.integration.currentBalance)).toBe(200);
    await page.goto("/reports");
    const notice = page.getByRole("complementary", {
      name: "Shared expenses",
      exact: true,
    });
    await expect(notice).toContainText("awaiting your review: 1");
    await notice.getByRole("link", { name: "Review", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Review shared expenses",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("personal-review-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("main")
      .getByRole("link", { name: "Review", exact: true })
      .click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const booking = page.getByRole("dialog", {
      name: "Review My Finances",
      exact: true,
    });
    await booking
      .getByRole("button", { name: "Preview Changes", exact: true })
      .click();
    await booking
      .getByRole("button", { name: "Save to My Finances", exact: true })
      .click();
    await expect(booking).toHaveCount(0);
    await page.goto("/reports");
    await page.reload();
    await expect(notice).toHaveCount(0);
    const after = await api.get<typeof before>(
      `/shared-expenses/groups/${group.id}/finances`,
    );
    expect(after.pendingCount).toBe(0);
    expect(Number(after.integration.currentBalance)).toBe(220);
    expect(
      Number(
        (await api.get<{ currentBalance: number }>(`/accounts/${bank.id}`))
          .currentBalance,
      ),
    ).toBe(700);
  });
});
