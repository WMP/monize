import { test, expect } from "../fixtures";
import {
  createAccount,
  createCategory,
  createPayee,
} from "../helpers/factories";
import {
  createSharedGroup,
  type SharedGroupFixture,
} from "../helpers/shared-expenses";
import { dismissNotificationPrompt } from "../readme/session";
import { VIDEO_VIEWPORT } from "../readme/settings";

test.use({ viewport: VIDEO_VIEWPORT });

test("saves a payment in Transactions and continues into one shared expense", async ({
  authedPage: page,
  api,
}, info) => {
  const group = await createSharedGroup(api, "Dinner with friends");
  const bank = await createAccount(api, {
    name: "Everyday card",
    currencyCode: "USD",
    openingBalance: 1000,
  });
  const category = await createCategory(api, { name: "Meals with friends" });
  const payee = await createPayee(api, {
    name: "Harbour restaurant",
    defaultCategoryId: category.id,
  });
  await dismissNotificationPrompt(page);
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: "+ New Transaction", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByRole("heading", { name: "New Transaction", exact: true }),
  ).toBeVisible();
  await form.getByLabel("Account", { exact: true }).selectOption(bank.id);
  await form
    .getByRole("textbox", { name: "Select or type payee name...", exact: true })
    .click();
  await page.getByText(payee.name, { exact: true }).click();
  await form.getByLabel("Amount", { exact: true }).fill("-120");
  await form
    .getByRole("button", { name: "Choose what happens after creating" })
    .click();
  await page.getByRole("menuitemradio", { name: /Save & Share/ }).click();
  await page.screenshot({
    path: info.outputPath("save-and-share.png"),
    animations: "disabled",
  });
  await form.getByRole("button", { name: "Save & Share", exact: true }).click();
  await page.waitForURL("**/shared-expenses/from-transaction/*");
  const sourceId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(
    (await api.get<SharedGroupFixture>(`/shared-expenses/groups/${group.id}`))
      .entries,
  ).toHaveLength(0);
  await page.getByLabel("Group", { exact: true }).selectOption(group.id);
  await expect(
    page.getByRole("button", { name: "Set Up My Finances", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create A Shared Expense", exact: true })
    .click();
  const entry = page.getByRole("dialog", { name: "Add Expense", exact: true });
  await expect(entry.getByLabel("What was it for?")).toHaveValue(payee.name);
  await expect(entry.getByLabel("Amount", { exact: true })).toHaveValue(
    "120.00",
  );
  await expect(entry.getByText("Your cost", { exact: false })).toContainText(
    "40.00",
  );
  await page.screenshot({
    path: info.outputPath("shared-dinner-preview.png"),
    animations: "disabled",
  });
  await entry
    .getByRole("button", { name: "Review My Finances", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Set Up My Finances", exact: true })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  const booking = page.getByRole("dialog", {
    name: "Add to My Finances",
    exact: true,
  });
  await expect(
    booking.getByText(payee.name, { exact: true }).first(),
  ).toBeVisible();
  await booking
    .getByRole("button", { name: "Preview Changes", exact: true })
    .click();
  await expect(
    booking.getByRole("button", { name: "Save to My Finances", exact: true }),
  ).toBeVisible();
  await booking
    .getByRole("heading", { name: "Current proposal", exact: true })
    .locator("..")
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("personal-dinner-preview.png"),
    animations: "disabled",
  });
  await booking
    .getByRole("button", { name: "Save to My Finances", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Saved", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.waitForURL(`**/shared-expenses/${group.id}`);
  await page.reload();
  const saved = await api.get<SharedGroupFixture>(
    `/shared-expenses/groups/${group.id}`,
  );
  expect(saved.entries).toHaveLength(1);
  expect(saved.balances.totalExpenses).toBe("120.0000");
  expect(
    saved.balances.positions.find(
      (person) => person.participantId === group.myParticipantId,
    )?.balance,
  ).toBe("80.0000");
  const original = await api.get<{
    id: string;
    amount: number | string;
    sharedExpensePostingId: string | null;
  }>(`/transactions/${sourceId}`);
  expect(original.id).toBe(sourceId);
  expect(Number(original.amount)).toBe(-120);
  expect(original.sharedExpensePostingId).toBeTruthy();
  const finances = await api.get<{
    entries: {
      posting: {
        snapshot: { effect: { personal: string; position: string } };
      } | null;
    }[];
  }>(`/shared-expenses/groups/${group.id}/finances`);
  expect(finances.entries).toHaveLength(1);
  expect(finances.entries[0].posting?.snapshot.effect).toMatchObject({
    personal: "-40.0000",
    position: "80.0000",
  });
  expect(
    Number(
      (
        await api.get<{ currentBalance: number | string }>(
          `/accounts/${bank.id}`,
        )
      ).currentBalance,
    ),
  ).toBe(880);
  await expect(
    page.getByRole("main").getByText(payee.name, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("shared-dinner-saved.png"),
    animations: "disabled",
  });
});
