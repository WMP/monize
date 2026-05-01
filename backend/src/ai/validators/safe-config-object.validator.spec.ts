import "reflect-metadata";
import { validate } from "class-validator";
import {
  IsSafeConfigObject,
  IsSafeConfigObjectConstraint,
} from "./safe-config-object.validator";

class TestDto {
  @IsSafeConfigObject()
  config?: unknown;
}

async function expectValid(value: unknown) {
  const dto = new TestDto();
  dto.config = value;
  const errors = await validate(dto);
  expect(errors).toHaveLength(0);
}

async function expectInvalid(value: unknown) {
  const dto = new TestDto();
  dto.config = value;
  const errors = await validate(dto);
  expect(errors).toHaveLength(1);
  expect(errors[0].property).toBe("config");
}

describe("IsSafeConfigObjectConstraint", () => {
  let constraint: IsSafeConfigObjectConstraint;

  beforeEach(() => {
    constraint = new IsSafeConfigObjectConstraint();
  });

  it("accepts undefined and null (handled by IsOptional)", () => {
    expect(constraint.validate(undefined)).toBe(true);
    expect(constraint.validate(null)).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(constraint.validate("string")).toBe(false);
    expect(constraint.validate(42)).toBe(false);
  });

  it("rejects arrays at the top level", () => {
    expect(constraint.validate([1, 2, 3])).toBe(false);
  });

  it("rejects when too many keys (>20)", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 21; i++) obj[`k${i}`] = i;
    expect(constraint.validate(obj)).toBe(false);
  });

  it("rejects dangerous keys (__proto__, constructor, prototype)", () => {
    // Object literal with __proto__ sets prototype, so build it explicitly
    const protoKey: any = {};
    Object.defineProperty(protoKey, "__proto__", {
      value: "x",
      enumerable: true,
      configurable: true,
    });
    expect(constraint.validate(protoKey)).toBe(false);

    const ctor: any = {};
    Object.defineProperty(ctor, "constructor", {
      value: "danger",
      enumerable: true,
    });
    expect(constraint.validate(ctor)).toBe(false);

    expect(constraint.validate({ prototype: "x" })).toBe(false);
  });

  it("accepts string, number, boolean values", () => {
    expect(constraint.validate({ a: "x", b: 1, c: true, d: false })).toBe(true);
  });

  it("ignores null/undefined values inside the object", () => {
    expect(constraint.validate({ a: null, b: undefined })).toBe(true);
  });

  it("rejects nested objects", () => {
    expect(constraint.validate({ nested: { foo: 1 } })).toBe(false);
  });

  it("rejects strings longer than 1000 chars", () => {
    expect(constraint.validate({ s: "x".repeat(1001) })).toBe(false);
  });

  it("accepts arrays of primitives", () => {
    expect(constraint.validate({ a: [1, 2, "three", true] })).toBe(true);
  });

  it("rejects arrays with more than 100 items", () => {
    const big = Array.from({ length: 101 }, (_, i) => i);
    expect(constraint.validate({ a: big })).toBe(false);
  });

  it("rejects arrays containing non-primitive items", () => {
    expect(constraint.validate({ a: [{ nested: 1 }] })).toBe(false);
  });

  it("rejects array strings longer than 1000 chars", () => {
    expect(constraint.validate({ a: ["x".repeat(1001)] })).toBe(false);
  });

  it("returns a descriptive default message", () => {
    expect(constraint.defaultMessage()).toContain("flat object");
  });
});

describe("@IsSafeConfigObject decorator", () => {
  it("validates a safe object", async () => {
    await expectValid({ rate: 0.5, label: "ok", flags: [true, false] });
  });

  it("rejects nested config objects", async () => {
    await expectInvalid({ nested: { foo: 1 } });
  });

  it("rejects arrays at top level", async () => {
    await expectInvalid([1, 2, 3]);
  });

  it("treats undefined as valid (IsOptional integration)", async () => {
    await expectValid(undefined);
  });
});
