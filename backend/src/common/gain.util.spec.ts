import { gainAgainstBasis } from "./gain.util";

describe("gainAgainstBasis", () => {
  it("computes gain and percentage from known inputs", () => {
    expect(gainAgainstBasis(1350, 1000)).toEqual({
      gainLoss: 350,
      gainLossPercent: 35,
    });
  });

  it("computes a loss", () => {
    expect(gainAgainstBasis(800, 1000)).toEqual({
      gainLoss: -200,
      gainLossPercent: -20,
    });
  });

  it("reports both unknown when the market value is unknown", () => {
    expect(gainAgainstBasis(null, 1000)).toEqual({
      gainLoss: null,
      gainLossPercent: null,
    });
  });

  it("reports both unknown when the basis is unknown", () => {
    expect(gainAgainstBasis(1350, null)).toEqual({
      gainLoss: null,
      gainLossPercent: null,
    });
  });

  it("does not compute a gain from a basis of zero standing in for unknown", () => {
    // The distinction that matters: an unknown basis must not be read as a
    // free acquisition, which would report the entire market value as gain.
    expect(gainAgainstBasis(1350, null).gainLoss).toBeNull();
    expect(gainAgainstBasis(1350, 0).gainLoss).toBe(1350);
  });

  it("reports a settled zero for an empty position", () => {
    expect(gainAgainstBasis(0, 0)).toEqual({
      gainLoss: 0,
      gainLossPercent: 0,
    });
  });

  it("reports an unknown percentage, not 0%, for a gain on a zero basis", () => {
    // Shares received at no cost and now worth 500: the gain is real and known,
    // the percentage return is undefined. Reporting 0% claimed no gain.
    expect(gainAgainstBasis(500, 0)).toEqual({
      gainLoss: 500,
      gainLossPercent: null,
    });
  });

  it("keeps the percentage sign meaningful for a negative basis", () => {
    // A gain stays a positive percentage even when the basis is negative.
    expect(gainAgainstBasis(50, -100)).toEqual({
      gainLoss: 150,
      gainLossPercent: 150,
    });
  });
});
