import { readFileSync } from "fs";
import { join } from "path";
import { Test, TestingModule } from "@nestjs/testing";
import { I18nModule, I18nService } from "nestjs-i18n";
import { LOCALE_BASES, SUPPORTED_LOCALE_CODES } from "../i18n/config";
import { emailTranslator, englishEmailT } from "../i18n/email-translator";
import { i18nFormatter } from "../i18n/i18n-formatter";
import { NotificationType } from "../notification-center/entities/notification.entity";
import {
  notificationEmailCopy,
  composeLocalizedNotificationCopy,
} from "./notification-email-copy";
import { NOTIFICATION_EMAIL_MESSAGES } from "./notification-email-messages";
import { notificationImmediateTemplate } from "./email-templates";

// Producer-shaped facts, including zero and negative money. PACE_WARNING has
// no producer or payload contract; its explicit legacy fallback is tested below.
const examples = {
  OVER_BUDGET: {
    categoryName: "Food",
    amount: 120,
    limit: 100,
    percent: 120,
    currencyCode: "USD",
  },
  THRESHOLD_CRITICAL: {
    categoryName: "Food",
    amount: 95,
    limit: 100,
    percent: 95,
    currencyCode: "USD",
  },
  THRESHOLD_WARNING: {
    categoryName: "Food",
    amount: 80,
    limit: 100,
    percent: 80,
    currencyCode: "USD",
  },
  PROJECTED_OVERSPEND: {
    categoryName: "Food",
    projectedTotal: 140,
    budgeted: 100,
    currencyCode: "USD",
  },
  FLEX_GROUP_WARNING: {
    flexGroup: "Living",
    totalSpent: 950,
    totalBudgeted: 1000,
    percent: 95,
    currencyCode: "EUR",
  },
  INCOME_SHORTFALL: {
    actualIncome: 0,
    expectedIncome: 1000,
    ratio: 0,
    currencyCode: "PLN",
  },
  POSITIVE_MILESTONE: { periodProgress: 60, percentUsed: 25.5 },
  SEASONAL_SPIKE: {
    categoryName: "Heating",
    highMonth: 12,
    typicalIncrease: 1.7,
  },
  BILL_DUE: {
    payeeName: "Rent",
    amount: 500,
    amountComplete: true,
    currencyCode: "EUR",
    dueDate: "2026-09-07",
  },
  BACKUP_FAILED: {
    system: true,
    affectedUserEmail: "owner@example.com",
    error: "ENOSPC",
  },
  BACKUP_PARTIAL: {
    system: true,
    affectedUserId: "u1",
    reason: "attachments",
    missingAttachments: 0,
    inconsistentAttachments: 2,
    expectedAttachments: 5,
  },
  ENCRYPTION_KEY_MISSING: { system: true },
  SMTP_FAILURE: { system: true, lastError: "ECONNREFUSED" },
  PROVIDER_OUTAGE: { system: true, providerLabel: "Yahoo Finance" },
  PROVIDER_RECOVERED: { system: true, providerLabel: "Yahoo Finance" },
  SCHEDULED_POST_FAILED: {
    system: true,
    scheduledName: "Rent",
    dueDate: "2026-09-07",
    error: "FX unavailable",
  },
  BALANCE_BELOW_THRESHOLD: {
    accountName: "Current",
    balance: -25,
    threshold: 0,
    currencyCode: "PLN",
  },
  BALANCE_ABOVE_THRESHOLD: {
    accountName: "Savings",
    balance: 1234.567,
    threshold: 1000,
    currencyCode: "BHD",
  },
  PORTFOLIO_MOVEMENT: {
    direction: "down",
    changePercent: -3.25,
    movementValue: -325,
    currencyCode: "EUR",
  },
  GEM_SIGNAL_CHANGED: {
    strategyName: "GEM",
    kind: "risk",
    fromState: "RISK_ON",
    toState: "RISK_OFF",
  },
} satisfies Record<
  Exclude<NotificationType, NotificationType.PACE_WARNING>,
  Record<string, unknown>
>;

const now = new Date("2026-09-05T23:59:59Z");
const source = (
  type: NotificationType,
  data: Record<string, unknown> | null,
) => ({
  type,
  data,
  title: "Stored title",
  message: "Stored message",
});

describe("notification email copy", () => {
  let module: TestingModule;
  let i18n: I18nService;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: "en",
          fallbacks: { ...LOCALE_BASES },
          formatter: i18nFormatter,
          loaderOptions: {
            path: join(__dirname, "../i18n/locales"),
            watch: false,
          },
        }),
      ],
    }).compile();
    await module.init();
    i18n = module.get(I18nService);
  });
  afterAll(async () => {
    await module.close();
  });

  it.each(Object.entries(examples))(
    "renders %s through real nestjs-i18n without an HTTP locale",
    (type, data) => {
      const row = source(type as NotificationType, data);
      const en = notificationEmailCopy(
        row,
        emailTranslator(i18n, "en"),
        "en",
        now,
      );
      const xx = notificationEmailCopy(
        row,
        emailTranslator(i18n, "xx"),
        "xx",
        now,
      );
      expect(en.title).not.toBe(row.title);
      expect(en.message).not.toBe(row.message);
      expect(en).toEqual(notificationEmailCopy(row, englishEmailT, "en", now));
      expect(xx.title).toContain("[XX-");
      expect(xx.message).toContain("[XX-");
      expect(JSON.stringify(xx)).not.toMatch(/\{\{|undefined|NaN/);
    },
  );

  it("keeps every English fallback and catalog key in agreement", () => {
    const catalog = JSON.parse(
      readFileSync(join(__dirname, "../i18n/locales/en/emails.json"), "utf8"),
    ).notificationCopy;
    const flatten = (
      value: Record<string, unknown>,
      prefix = "",
    ): Record<string, string> =>
      Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          typeof item === "string"
            ? [[prefix + key, item]]
            : Object.entries(
                flatten(item as Record<string, unknown>, `${prefix}${key}.`),
              ),
        ),
      );
    expect(flatten(catalog)).toEqual(NOTIFICATION_EMAIL_MESSAGES);
  });

  it.each(["en-US", "en-GB", "en-CA", "invalid_locale"])(
    "falls back per key for %s",
    (lang) => {
      const row = source(
        NotificationType.BALANCE_BELOW_THRESHOLD,
        examples.BALANCE_BELOW_THRESHOLD,
      );
      const copy = notificationEmailCopy(
        row,
        emailTranslator(i18n, lang),
        lang,
        now,
      );
      expect(copy.title).toBe("Current is below your threshold");
      expect(copy.message).toContain("Current dropped to");
      expect(copy.message).not.toContain("{{");
    },
  );

  it("formats money, percentages and calendar dates in the recipient's language", () => {
    expect(
      notificationEmailCopy(
        source(
          NotificationType.BALANCE_BELOW_THRESHOLD,
          examples.BALANCE_BELOW_THRESHOLD,
        ),
        englishEmailT,
        "pl",
      ).message,
    ).toContain("-25,00");
    expect(
      notificationEmailCopy(
        source(
          NotificationType.PORTFOLIO_MOVEMENT,
          examples.PORTFOLIO_MOVEMENT,
        ),
        englishEmailT,
        "pl",
      ).title,
    ).toContain("3,25%");
    expect(
      notificationEmailCopy(
        source(NotificationType.BILL_DUE, examples.BILL_DUE),
        englishEmailT,
        "pl",
        now,
      ).message,
    ).toContain("7 wrz 2026");
    expect(
      notificationEmailCopy(
        source(NotificationType.SEASONAL_SPIKE, examples.SEASONAL_SPIKE),
        englishEmailT,
        "pl",
      ).message,
    ).toContain("grudzień");
  });

  it.each([
    [-1, "overdue"],
    [0, "due today"],
    [1, "due tomorrow"],
    [2, "due in 2 days"],
  ])("recomputes a bill headline %s days from delivery", (offset, expected) => {
    const dueDate = `2026-09-${String(5 + Number(offset)).padStart(2, "0")}`;
    expect(
      notificationEmailCopy(
        source(NotificationType.BILL_DUE, { ...examples.BILL_DUE, dueDate }),
        englishEmailT,
        "en",
        now,
      ).title,
    ).toBe(`Rent ${expected}`);
  });

  it.each([{ amount: null }, { amount: 999, amountComplete: false }])(
    "withholds an unavailable bill amount: %j",
    (over) => {
      const copy = notificationEmailCopy(
        source(NotificationType.BILL_DUE, { ...examples.BILL_DUE, ...over }),
        englishEmailT,
        "en",
        now,
      );
      expect(copy.message).toContain("Amount unavailable");
      expect(copy.message).not.toContain("999");
    },
  );

  it.each(["promotion", "retention"])(
    "keeps the cause of a partial-backup %s failure",
    (reason) => {
      const copy = notificationEmailCopy(
        source(NotificationType.BACKUP_PARTIAL, {
          system: true,
          affectedUserId: "u1",
          reason,
          error: "EACCES",
        }),
      );
      expect(copy.message).toContain("EACCES");
      expect(copy.message).toContain("u1");
      expect(copy.message).not.toBe("Stored message");
    },
  );

  it.each([
    [{ toSymbol: "VWCE", toRole: "EX_US_EQUITY" }, "VWCE"],
    [{ toSymbol: null, toRole: "SAFE" }, "Safe asset"],
    [{ toSymbol: null, toRole: null }, "changed its target"],
  ])(
    "renders GEM allocation including unmapped or absent winners: %j",
    (target, expected) => {
      const copy = notificationEmailCopy(
        source(NotificationType.GEM_SIGNAL_CHANGED, {
          strategyName: "GEM",
          kind: "allocation",
          ...target,
        }),
      );
      expect(copy.message).toContain(expected);
    },
  );

  it("preserves untrusted text without re-interpolating it and escapes the final HTML once", () => {
    const row = source(NotificationType.BACKUP_FAILED, {
      ...examples.BACKUP_FAILED,
      error: "<script>x</script> & {{ user }}",
    });
    const copy = notificationEmailCopy(row, emailTranslator(i18n, "en"), "en");
    expect(copy.message).toContain("<script>x</script> & {{ user }}");
    const html = notificationImmediateTemplate({
      ...copy,
      severity: "critical",
      url: "https://example.com",
    });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; {{ user }}");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("&amp;lt;");
  });

  it.each([
    [
      NotificationType.OVER_BUDGET,
      { ...examples.OVER_BUDGET, currencyCode: undefined },
    ],
    [
      NotificationType.BALANCE_BELOW_THRESHOLD,
      { ...examples.BALANCE_BELOW_THRESHOLD, balance: NaN },
    ],
    [
      NotificationType.BALANCE_ABOVE_THRESHOLD,
      { ...examples.BALANCE_ABOVE_THRESHOLD, currencyCode: "bad-currency" },
    ],
    [
      NotificationType.PORTFOLIO_MOVEMENT,
      { direction: "unknown", changePercent: 5 },
    ],
    [
      NotificationType.PORTFOLIO_MOVEMENT,
      { direction: "down", changePercent: Infinity },
    ],
    [
      NotificationType.GEM_SIGNAL_CHANGED,
      { ...examples.GEM_SIGNAL_CHANGED, toState: "UNKNOWN" },
    ],
    [
      NotificationType.GEM_SIGNAL_CHANGED,
      { strategyName: "GEM", kind: "allocation", toRole: "__proto__" },
    ],
    [
      NotificationType.BACKUP_PARTIAL,
      { ...examples.BACKUP_PARTIAL, inconsistentAttachments: undefined },
    ],
    [
      NotificationType.BILL_DUE,
      { ...examples.BILL_DUE, dueDate: "2026-02-30" },
    ],
    [NotificationType.BILL_DUE, { ...examples.BILL_DUE, amount: undefined }],
    [
      NotificationType.SEASONAL_SPIKE,
      { ...examples.SEASONAL_SPIKE, highMonth: 13 },
    ],
  ])(
    "retains the entire stored copy for incomplete or malformed %s data",
    (type, data) => {
      const row = source(
        type as NotificationType,
        data as Record<string, unknown>,
      );
      expect(notificationEmailCopy(row)).toEqual({
        title: row.title,
        message: row.message,
      });
    },
  );

  it.each(Object.values(NotificationType))(
    "preserves legacy %s rows without data",
    (type) => {
      expect(
        composeLocalizedNotificationCopy(
          { type, data: null },
          englishEmailT,
          "en",
        ),
      ).toBeNull();
    },
  );

  it("retains the legacy PACE_WARNING and unknown future types", () => {
    for (const type of [
      NotificationType.PACE_WARNING,
      "FUTURE" as NotificationType,
    ]) {
      expect(notificationEmailCopy(source(type, {}))).toEqual({
        title: "Stored title",
        message: "Stored message",
      });
    }
  });

  it.each(SUPPORTED_LOCALE_CODES)(
    "all active types have translated titles and bodies in %s",
    (lang) => {
      for (const [type, data] of Object.entries(examples)) {
        const copy = notificationEmailCopy(
          source(type as NotificationType, data),
          emailTranslator(i18n, lang),
          lang,
          now,
        );
        expect(copy.title).not.toBe("Stored title");
        expect(copy.message).not.toBe("Stored message");
        expect(JSON.stringify(copy)).not.toMatch(/\{\{|undefined|NaN/);
        if (!lang.startsWith("en") && lang !== "xx") {
          const english = notificationEmailCopy(
            source(type as NotificationType, data),
            englishEmailT,
            lang,
            now,
          );
          expect(copy.title).not.toBe(english.title);
          expect(copy.message).not.toBe(english.message);
        }
      }
    },
  );
});
