import { executeCalculation, CalculateInput } from "./calculate-tool";

describe("executeCalculation", () => {
  describe("percentage", () => {
    it("computes percentage correctly", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [300, 5000],
      });

      expect(result).toEqual({
        result: 6,
        formattedResult: "6%",
        operation: "percentage",
      });
    });

    it("rounds to 2 decimal places", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [1, 3],
      });

      expect(result).toEqual({
        result: 33.33,
        formattedResult: "33.33%",
        operation: "percentage",
      });
    });

    it("returns error when divisor is zero", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [100, 0],
      });

      expect(result).toEqual({
        error: "Cannot calculate percentage: divisor is zero.",
      });
    });

    it("returns error with fewer than 2 values", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [100],
      });

      expect(result).toEqual({
        error: "Percentage requires exactly 2 values: [part, whole].",
      });
    });

    it("handles negative values", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [-200, 1000],
      });

      expect(result).toEqual({
        result: -20,
        formattedResult: "-20%",
        operation: "percentage",
      });
    });
  });

  describe("difference", () => {
    it("computes difference correctly", () => {
      const result = executeCalculation({
        operation: "difference",
        values: [1500, 1200],
      });

      expect(result).toEqual({
        result: 300,
        formattedResult: "300.00",
        operation: "difference",
      });
    });

    it("handles negative result", () => {
      const result = executeCalculation({
        operation: "difference",
        values: [500, 800],
      });

      expect(result).toEqual({
        result: -300,
        formattedResult: "-300.00",
        operation: "difference",
      });
    });

    it("returns error with fewer than 2 values", () => {
      const result = executeCalculation({
        operation: "difference",
        values: [100],
      });

      expect(result).toEqual({
        error: "Difference requires exactly 2 values: [a, b].",
      });
    });
  });

  describe("ratio", () => {
    it("computes ratio correctly", () => {
      const result = executeCalculation({
        operation: "ratio",
        values: [5000, 3000],
      });

      expect(result).toEqual({
        result: 1.67,
        formattedResult: "1.67:1",
        operation: "ratio",
      });
    });

    it("returns error when divisor is zero", () => {
      const result = executeCalculation({
        operation: "ratio",
        values: [100, 0],
      });

      expect(result).toEqual({
        error: "Cannot calculate ratio: divisor is zero.",
      });
    });

    it("returns error with fewer than 2 values", () => {
      const result = executeCalculation({
        operation: "ratio",
        values: [100],
      });

      expect(result).toEqual({
        error: "Ratio requires exactly 2 values: [a, b].",
      });
    });
  });

  describe("sum", () => {
    it("computes sum correctly", () => {
      const result = executeCalculation({
        operation: "sum",
        values: [100, 200, 300],
      });

      expect(result).toEqual({
        result: 600,
        formattedResult: "600.00",
        operation: "sum",
      });
    });

    it("avoids floating-point drift", () => {
      // 0.1 + 0.2 would be 0.30000000000000004 with naive addition
      const result = executeCalculation({
        operation: "sum",
        values: [0.1, 0.2],
      });

      expect(result).toEqual({
        result: 0.3,
        formattedResult: "0.30",
        operation: "sum",
      });
    });

    it("handles many values with potential drift", () => {
      // Ten values of 0.1 should sum to exactly 1.0
      const result = executeCalculation({
        operation: "sum",
        values: Array(10).fill(0.1),
      });

      expect(result).toEqual({
        result: 1,
        formattedResult: "1.00",
        operation: "sum",
      });
    });

    it("handles large values", () => {
      const result = executeCalculation({
        operation: "sum",
        values: [999999999.99, 0.01],
      });

      expect(result).toEqual({
        result: 1000000000,
        formattedResult: "1000000000.00",
        operation: "sum",
      });
    });
  });

  describe("average", () => {
    it("computes average correctly", () => {
      const result = executeCalculation({
        operation: "average",
        values: [100, 200, 300],
      });

      expect(result).toEqual({
        result: 200,
        formattedResult: "200.00",
        operation: "average",
      });
    });

    it("rounds to 2 decimal places", () => {
      const result = executeCalculation({
        operation: "average",
        values: [1, 2],
      });

      expect(result).toEqual({
        result: 1.5,
        formattedResult: "1.50",
        operation: "average",
      });
    });
  });

  describe("label", () => {
    it("includes label when provided", () => {
      const result = executeCalculation({
        operation: "percentage",
        values: [500, 5000],
        label: "savings rate",
      });

      expect(result).toEqual({
        result: 10,
        formattedResult: "10%",
        operation: "percentage",
        label: "savings rate",
      });
    });

    it("omits label when not provided", () => {
      const result = executeCalculation({
        operation: "sum",
        values: [100, 200],
      });

      expect(result).not.toHaveProperty("label");
    });

    it("omits label when empty string (falsy)", () => {
      const result = executeCalculation({
        operation: "sum",
        values: [1, 2],
        label: "",
      });
      expect(result).not.toHaveProperty("label");
    });
  });

  describe("edge cases", () => {
    it("returns error for empty values array", () => {
      const result = executeCalculation({
        operation: "sum",
        values: [],
      });

      expect(result).toEqual({
        error: "At least one value is required.",
      });
    });

    it("returns error for unknown operation", () => {
      const result = executeCalculation({
        operation: "modulo" as CalculateInput["operation"],
        values: [10, 3],
      });

      expect(result).toEqual({
        error: "Unknown operation: modulo",
      });
    });
  });
});
