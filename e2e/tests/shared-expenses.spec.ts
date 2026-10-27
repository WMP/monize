import { test, expect } from "../fixtures";
import {
  createAccount,
  createCategory,
  createTransaction,
} from "../helpers/factories";
import {
  createSharedExpense,
  createSharedGroup,
  type SharedGroupFixture,
} from "../helpers/shared-expenses";
import { syntheticDocumentPng } from "../helpers/document-fixture";
import { dismissNotificationPrompt } from "../readme/session";
import { VIDEO_VIEWPORT } from "../readme/settings";

test.describe("Shared expenses", () => {
  test.use({ viewport: VIDEO_VIEWPORT });

  test.beforeEach(async ({ authedPage }) => {
    await dismissNotificationPrompt(authedPage);
  });

  test("records an unequal split for people without accounts and keeps a partial repayment after reload", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api);
    await page.goto(`/shared-expenses/${group.id}`);
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .first()
      .click();
    const editor = page.getByRole("dialog", {
      name: "Add expense",
      exact: true,
    });
    await editor.getByLabel("What was it for?").fill("Dinner after the hike");
    await editor.getByLabel("Amount", { exact: true }).fill("300");
    await editor
      .getByRole("button", { name: "Change split", exact: true })
      .click();
    const split = page.getByRole("dialog", {
      name: "How to split",
      exact: true,
    });
    await split
      .getByRole("button", { name: "Exact amounts", exact: true })
      .click();
    await split.getByLabel("Share for Robert").fill("80");
    await split.getByLabel("Share for Anna").fill("110");
    await split.getByLabel("Share for Bartek").fill("110");
    await expect(
      split.getByRole("button", { name: "Apply split" }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath("unequal-split-desktop.png"),
      fullPage: false,
      animations: "disabled",
    });
    await split.getByRole("button", { name: "Apply split" }).click();
    await editor.getByRole("button", { name: "Review split" }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const saved = page.getByRole("dialog", { name: "Saved", exact: true });
    await saved
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.reload();
    await expect(
      page
        .getByRole("main")
        .getByText("Dinner after the hike", { exact: true }),
    ).toBeVisible();
    const detail = await api.get<SharedGroupFixture>(
      `/shared-expenses/groups/${group.id}`,
    );
    expect(
      detail.balances.positions.find(
        (person) => person.participantId === group.myParticipantId,
      )?.balance,
    ).toBe("220.0000");
    await page.screenshot({
      path: info.outputPath("group-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Balances", exact: true }).click();
    await page
      .getByRole("button", { name: "Record repayment", exact: true })
      .first()
      .click();
    const repayment = page.getByRole("dialog", {
      name: "Record repayment",
      exact: true,
    });
    await repayment.getByLabel("Amount", { exact: true }).fill("50");
    await repayment.getByRole("button", { name: "Review split" }).click();
    await repayment
      .getByRole("button", { name: "Record repayment", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Saved", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.reload();
    const after = await api.get<SharedGroupFixture>(
      `/shared-expenses/groups/${group.id}`,
    );
    expect(
      after.balances.positions.find(
        (person) => person.participantId === group.myParticipantId,
      )?.balance,
    ).toBe("170.0000");
    expect(after.balances.totalExpenses).toBe("300.0000");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Balances", exact: true }).click();
    await expect(
      page.getByRole("main").getByText("Anna", { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("balances-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  test("keeps a standalone group file when entry creation is cancelled, then attaches it without duplicating it", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api, "Summer apartment");
    await page.goto(`/shared-expenses/${group.id}`);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByLabel("Add attachment").setInputFiles({
      name: "Apartment booking.png",
      mimeType: "image/png",
      buffer: syntheticDocumentPng(),
    });
    await page
      .getByRole("button", { name: "Upload files", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Create expense from this file",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Create expense from this file",
        exact: true,
      })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Add expense",
      exact: true,
    });
    await expect(editor.getByLabel("What was it for?")).toHaveValue(
      "Apartment booking",
    );
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Create expense from this file",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Create expense from this file",
        exact: true,
      })
      .click();
    await editor.getByLabel("Amount", { exact: true }).fill("240");
    await editor.getByRole("button", { name: "Review split" }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Saved", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.reload();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open related entry", exact: true }),
    ).toBeVisible();
    const documents = await api.get<{
      items: { filename: string; sharedEntryId: string | null }[];
    }>(`/shared-expenses/groups/${group.id}/documents`);
    expect(documents.items).toHaveLength(1);
    expect(documents.items[0].sharedEntryId).toBeTruthy();
    await expect(
      page.getByRole("main").getByText("No attachments yet", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("files-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Open related entry", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Apartment booking", { exact: true })
        .first(),
    ).toBeVisible();
  });

  test("matches one imported bank debit and previews the personal cost without adding another debit", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api);
    await createSharedExpense(api, group);
    const bank = await createAccount(api, {
      name: "Travel card",
      currencyCode: "USD",
      openingBalance: 1000,
    });
    const category = await createCategory(api, { name: "Travel meals" });
    const imported = await createTransaction(api, {
      accountId: bank.id,
      amount: -300,
      payeeName: "Mountain market",
      categoryId: category.id,
    });
    await page.goto(`/shared-expenses/${group.id}`);
    await page
      .getByRole("button", { name: "My finances", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connect my finances", exact: true })
      .click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const booking = page.getByRole("dialog", {
      name: "Connect to my ledger",
      exact: true,
    });
    await booking
      .getByLabel("Payment account", { exact: true })
      .selectOption(bank.id);
    await booking.getByRole("button", { name: /Mountain market/ }).click();
    await booking
      .getByRole("textbox", { name: "My category", exact: true })
      .click();
    await page.getByText("Travel meals", { exact: true }).click();
    await booking
      .getByRole("button", { name: "Preview my ledger", exact: true })
      .click();
    await expect(
      booking.getByRole("button", { name: "Accept booking", exact: true }),
    ).toBeVisible();
    await booking
      .getByRole("heading", { name: "Current proposal", exact: true })
      .locator("..")
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("bank-preview-desktop.png"),
      fullPage: false,
      animations: "disabled",
    });
    await booking
      .getByRole("button", { name: "Accept booking", exact: true })
      .click();
    await expect(booking).toHaveCount(0);
    await page.reload();
    const unchangedBank = await api.get<{ currentBalance: number | string }>(
      `/accounts/${bank.id}`,
    );
    expect(Number(unchangedBank.currentBalance)).toBe(700);
    const row = await api.get<{
      id: string;
      sharedExpensePostingId: string | null;
      amount: number | string;
    }>(`/transactions/${imported.id}`);
    expect(row.id).toBe(imported.id);
    expect(Number(row.amount)).toBe(-300);
    expect(row.sharedExpensePostingId).toBeTruthy();
  });
  test("starts from a mixed bank receipt and saves the shared entry and personal booking together", async ({
    authedPage: page,
    api,
  }, info) => {
    const group = await createSharedGroup(api, "City break");
    const bank = await createAccount(api, {
      name: "Main card",
      currencyCode: "USD",
      openingBalance: 1000,
    });
    const category = await createCategory(api, { name: "Shared meals" });
    const imported = await createTransaction(api, {
      accountId: bank.id,
      amount: -350,
      payeeName: "City restaurant",
      categoryId: category.id,
    });
    await page.goto(`/shared-expenses/from-transaction/${imported.id}`);
    await page.getByLabel("Group", { exact: true }).selectOption(group.id);
    await page
      .getByRole("button", { name: "Create a shared expense", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Add expense",
      exact: true,
    });
    await expect(editor.getByLabel("What was it for?")).toHaveValue(
      "City restaurant",
    );
    await editor.getByLabel("Amount", { exact: true }).fill("300");
    await editor
      .getByRole("button", { name: "Review split", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Review my finances", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Connect my finances", exact: true })
      .getByRole("button", { name: "Connect my finances", exact: true })
      .click();
    const booking = page.getByRole("dialog", {
      name: "Connect to my ledger",
      exact: true,
    });
    await booking
      .getByLabel("Shared part of this bank transaction", { exact: true })
      .fill("300");
    await booking
      .getByRole("button", { name: "Preview my ledger", exact: true })
      .click();
    await expect(
      booking.getByRole("button", { name: "Accept booking", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await booking
      .getByRole("heading", { name: "Current proposal", exact: true })
      .locator("..")
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("combined-bank-mobile.png"),
      fullPage: false,
      animations: "disabled",
    });
    await booking
      .getByRole("button", { name: "Accept booking", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Saved", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.reload();
    const after = await api.get<SharedGroupFixture>(
      `/shared-expenses/groups/${group.id}`,
    );
    expect(after.balances.totalExpenses).toBe("300.0000");
    const overview = await api.get<{
      entries: {
        posting: {
          snapshot: { effect: { personal: string; position: string } };
        } | null;
      }[];
    }>(`/shared-expenses/groups/${group.id}/finances`);
    expect(overview.entries).toHaveLength(1);
    expect(overview.entries[0].posting?.snapshot.effect).toMatchObject({
      personal: "-100.0000",
      position: "200.0000",
    });
    const unchanged = await api.get<{ currentBalance: number | string }>(
      `/accounts/${bank.id}`,
    );
    expect(Number(unchanged.currentBalance)).toBe(650);
  });
});
