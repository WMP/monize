import {
  allocateLoanPayment,
  bookLoanAllocation,
} from "./loan-payment-waterfall.util";

describe("allocateLoanPayment", () => {
  it("passes an ordinary installment through unchanged", () => {
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 300,
      interest: 200,
      principal: 500,
      currentBalance: 100000,
    });
    expect(result).toEqual({
      principal: 500,
      interest: 200,
      extraPrincipal: 300,
      total: 1000,
    });
  });

  it("applies the payment interest-first across the whole installment, extra included", () => {
    // 1,000 payment with 300 extra against 800 of accrued interest: the extra
    // instruction has no principal to reduce until the interest is met
    // (recheck DR3-01).
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 300,
      interest: 800,
      principal: 0,
      currentBalance: 100000,
    });
    expect(result.interest).toBe(800);
    expect(result.principal).toBe(0);
    expect(result.extraPrincipal).toBe(200);
    expect(result.total).toBe(1000);
  });

  it("bounds interest by the whole installment so a child cannot exceed the parent", () => {
    // 5,000 accrued against a 1,000 payment previously wrote an interest child
    // of -5,000 under a parent of -1,000 (recheck RR2-006).
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 0,
      interest: 5000,
      principal: 0,
      currentBalance: 100000,
    });
    expect(result).toEqual({
      principal: 0,
      interest: 1000,
      extraPrincipal: 0,
      total: 1000,
    });
  });

  it("clamps regular and extra principal together against the balance (FR-009)", () => {
    // 500 remaining against 400 amortized principal plus a 300 standing extra:
    // the extra absorbs the shortfall, so 400 + 100 retires the debt exactly.
    const result = allocateLoanPayment({
      paymentAmount: 700,
      extraPrincipal: 300,
      interest: 10,
      principal: 400,
      currentBalance: 500,
    });
    expect(result.principal).toBe(400);
    expect(result.extraPrincipal).toBe(100);
    expect(result.total).toBe(510);
  });

  it("shrinks the final installment with the debt (audit P5-008)", () => {
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 0,
      interest: 1,
      principal: 999,
      currentBalance: 50,
    });
    expect(result.principal).toBe(50);
    expect(result.interest).toBe(1);
    expect(result.total).toBe(51);
  });

  it("does not clamp interest by the balance", () => {
    // Interest accrued on the debt and is owed independently of how much
    // principal is left to retire.
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 0,
      interest: 80,
      principal: 920,
      currentBalance: 30,
    });
    expect(result.interest).toBe(80);
    expect(result.principal).toBe(30);
    expect(result.total).toBe(110);
  });

  it("applies no balance clamp when the balance is unknown", () => {
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: 200,
      interest: 100,
      principal: 700,
      currentBalance: null,
    });
    expect(result).toEqual({
      principal: 700,
      interest: 100,
      extraPrincipal: 200,
      total: 1000,
    });
  });

  it("treats negative inputs as zero rather than crediting the borrower", () => {
    const result = allocateLoanPayment({
      paymentAmount: 1000,
      extraPrincipal: -5,
      interest: -10,
      principal: -20,
      currentBalance: 100000,
    });
    expect(result).toEqual({
      principal: 0,
      interest: 0,
      extraPrincipal: 0,
      total: 0,
    });
  });

  it("rounds each part and the total to 4dp", () => {
    const result = allocateLoanPayment({
      paymentAmount: 100.00005,
      extraPrincipal: 0,
      interest: 33.33333,
      principal: 66.66667,
      currentBalance: 1000,
    });
    expect(result.interest).toBe(33.3333);
    expect(result.principal).toBe(66.6667);
    expect(result.total).toBe(100);
  });
});

describe("bookLoanAllocation", () => {
  it("rounds total and interest to the unit and lets principal take the rest (issue #1581)", () => {
    expect(
      bookLoanAllocation(
        {
          principal: 864.5833,
          interest: 306.0625,
          extraPrincipal: 0,
          total: 1170.6458,
        },
        2,
      ),
    ).toEqual({
      principal: 864.59,
      interest: 306.06,
      extraPrincipal: 0,
      total: 1170.65,
    });
  });

  it("books whole units for a zero-decimal currency", () => {
    expect(
      bookLoanAllocation(
        {
          principal: 1000.4,
          interest: 500.4,
          extraPrincipal: 0,
          total: 1500.8,
        },
        0,
      ),
    ).toEqual({
      principal: 1001,
      interest: 500,
      extraPrincipal: 0,
      total: 1501,
    });
  });

  it("lets the extra take the rounding when principal is zero, so no line turns negative", () => {
    // Interest-only with a standing extra: 100.01 + 50.01 rounded is 150.02
    // against a 150.01 bill; principal cannot give up the cent it does not have.
    expect(
      bookLoanAllocation(
        {
          principal: 0,
          interest: 100.005,
          extraPrincipal: 50.005,
          total: 150.01,
        },
        2,
      ),
    ).toEqual({
      principal: 0,
      interest: 100.01,
      extraPrincipal: 50,
      total: 150.01,
    });
  });

  it("leaves an installment already in cents unchanged", () => {
    const allocation = {
      principal: 507.5,
      interest: 992.5,
      extraPrincipal: 100,
      total: 1600,
    };
    expect(bookLoanAllocation(allocation, 2)).toEqual(allocation);
  });
});
