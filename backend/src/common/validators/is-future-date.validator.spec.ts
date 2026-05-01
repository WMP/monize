import { validate } from "class-validator";
import {
  IsFutureDate,
  IsFutureDateConstraint,
} from "./is-future-date.validator";

class TestDto {
  @IsFutureDate()
  expiresAt?: string;
}

class TestDtoWithMessage {
  @IsFutureDate({ message: "custom message" })
  expiresAt?: string;
}

describe("IsFutureDateConstraint", () => {
  let constraint: IsFutureDateConstraint;

  beforeEach(() => {
    constraint = new IsFutureDateConstraint();
  });

  describe("validate()", () => {
    it("returns true for empty value (handled by IsOptional)", () => {
      expect(constraint.validate("", {} as any)).toBe(true);
    });

    it("returns true for null value", () => {
      expect(constraint.validate(null as any, {} as any)).toBe(true);
    });

    it("returns true for undefined value", () => {
      expect(constraint.validate(undefined as any, {} as any)).toBe(true);
    });

    it("returns false for invalid date string", () => {
      expect(constraint.validate("not-a-date", {} as any)).toBe(false);
    });

    it("returns false for past date", () => {
      expect(constraint.validate("2000-01-01", {} as any)).toBe(false);
    });

    it("returns true for future date", () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(constraint.validate(future.toISOString(), {} as any)).toBe(true);
    });

    it("returns true for today (boundary)", () => {
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      expect(constraint.validate(today.toISOString(), {} as any)).toBe(true);
    });
  });

  describe("defaultMessage()", () => {
    it("returns the standard error message", () => {
      expect(constraint.defaultMessage({} as any)).toBe(
        "Expiration date must be in the future",
      );
    });
  });
});

describe("@IsFutureDate decorator", () => {
  it("validates future date as valid", async () => {
    const dto = new TestDto();
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    dto.expiresAt = future.toISOString();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("validates past date as invalid", async () => {
    const dto = new TestDto();
    dto.expiresAt = "2000-01-01";

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isFutureDate).toBe(
      "Expiration date must be in the future",
    );
  });

  it("validates invalid date as invalid", async () => {
    const dto = new TestDto();
    dto.expiresAt = "not-a-date";

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });

  it("supports custom error message via options", async () => {
    const dto = new TestDtoWithMessage();
    dto.expiresAt = "1990-01-01";

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isFutureDate).toBe("custom message");
  });
});
