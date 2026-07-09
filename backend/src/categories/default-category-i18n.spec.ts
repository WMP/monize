import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
} from "./default-categories";
import {
  categoryKeySegment,
  defaultCategoryNameKey,
  defaultSubcategoryNameKey,
} from "./default-category-i18n";

type Json = { [k: string]: Json } | string;

const catalog = JSON.parse(
  readFileSync(join(__dirname, "../i18n/locales/en/categories.json"), "utf8"),
) as {
  defaults: Record<string, { name: string; sub: Record<string, string> }>;
};

const ALL_CATEGORIES = [
  ...DEFAULT_INCOME_CATEGORIES,
  ...DEFAULT_EXPENSE_CATEGORIES,
];

function resolve(obj: Json, dotKey: string): string | undefined {
  // Keys are produced as `categories.defaults.<parent>...`; the `categories`
  // prefix is the filename namespace, so drop it before walking the object.
  const parts = dotKey.replace(/^categories\./, "").split(".");
  let node: Json = obj;
  for (const part of parts) {
    if (typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

describe("categoryKeySegment", () => {
  it.each([
    ["Car Payment", "carPayment"],
    ["US Dollars", "usDollars"],
    ["Water & Sewer", "waterSewer"],
    ["CPP/QPP Benefits", "cppQppBenefits"],
    ["Mother's Day", "mothersDay"],
    ["Homeowner/Renter", "homeownerRenter"],
    ["ATM", "atm"],
    ["Camera/Film", "cameraFilm"],
  ])("slugs %s -> %s", (input, expected) => {
    expect(categoryKeySegment(input)).toBe(expected);
  });
});

describe("default category catalog parity", () => {
  it("resolves every default parent name to the English catalog", () => {
    for (const cat of ALL_CATEGORIES) {
      const key = defaultCategoryNameKey(cat.name);
      expect(resolve(catalog, key)).toBe(cat.name);
    }
  });

  it("resolves every default subcategory name to the English catalog", () => {
    for (const cat of ALL_CATEGORIES) {
      for (const subName of cat.subcategories) {
        const key = defaultSubcategoryNameKey(cat.name, subName);
        expect(resolve(catalog, key)).toBe(subName);
      }
    }
  });

  it("has no catalog entries without a matching default category", () => {
    const expectedParentSlugs = new Set(
      ALL_CATEGORIES.map((c) => categoryKeySegment(c.name)),
    );
    for (const parentSlug of Object.keys(catalog.defaults)) {
      expect(expectedParentSlugs.has(parentSlug)).toBe(true);
    }

    for (const cat of ALL_CATEGORIES) {
      const parentSlug = categoryKeySegment(cat.name);
      const expectedSubSlugs = new Set(
        cat.subcategories.map((s) => categoryKeySegment(s)),
      );
      const catalogSubSlugs = Object.keys(catalog.defaults[parentSlug].sub);
      expect(catalogSubSlugs.length).toBe(expectedSubSlugs.size);
      for (const slug of catalogSubSlugs) {
        expect(expectedSubSlugs.has(slug)).toBe(true);
      }
    }
  });

  it("derives collision-free parent slugs", () => {
    const slugs = ALL_CATEGORIES.map((c) => categoryKeySegment(c.name));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("derives collision-free subcategory slugs within each parent", () => {
    for (const cat of ALL_CATEGORIES) {
      const slugs = cat.subcategories.map((s) => categoryKeySegment(s));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
