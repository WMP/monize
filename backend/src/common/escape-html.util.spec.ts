import { escapeHtml } from "./escape-html.util";

describe("escapeHtml", () => {
  it("escapes angle brackets and double quotes", () => {
    const out = escapeHtml(`<script>alert("xss")</script>`);
    expect(out).not.toMatch(/<script>/);
    expect(out).not.toMatch(/<\/script>/);
    expect(out).not.toMatch(/"xss"/);
    expect(out.toLowerCase()).toContain("lt");
    expect(out.toLowerCase()).toContain("gt");
  });

  it("escapes ampersand and single quote", () => {
    const out = escapeHtml("Tom & Jerry's");
    // Original & and ' must not appear as literal HTML
    expect(out).not.toMatch(/ & /);
    expect(out).not.toMatch(/Jerry's/);
    expect(out.toLowerCase()).toContain("amp");
    expect(out.toLowerCase()).toContain("apos");
  });

  it("encodes non-ASCII characters", () => {
    const out = escapeHtml("café");
    expect(out).not.toContain("é");
    expect(out).toMatch(/caf(&#xE9;|&eacute;)/);
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain ASCII unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});
