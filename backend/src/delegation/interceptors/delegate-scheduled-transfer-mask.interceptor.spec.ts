import { of, lastValueFrom } from "rxjs";
import { DelegateScheduledTransferMaskInterceptor } from "./delegate-scheduled-transfer-mask.interceptor";

describe("DelegateScheduledTransferMaskInterceptor", () => {
  let interceptor: DelegateScheduledTransferMaskInterceptor;
  let delegationService: Record<string, jest.Mock>;

  const ctxFor = (user: unknown) =>
    ({
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;
  const handlerOf = (body: unknown) => ({ handle: () => of(body) }) as never;

  beforeEach(() => {
    delegationService = { readableAccountIds: jest.fn() };
    interceptor = new DelegateScheduledTransferMaskInterceptor(
      delegationService as never,
    );
  });

  it("passes through for a non-http context", async () => {
    const out = await lastValueFrom(
      interceptor.intercept({ getType: () => "ws" } as never, handlerOf("x")),
    );
    expect(out).toBe("x");
  });

  it("passes through for a non-delegate request", async () => {
    const body = [{ id: "s1", isTransfer: true }];
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor({ isActing: false }), handlerOf(body)),
    );
    expect(out).toBe(body);
    expect(delegationService.readableAccountIds).not.toHaveBeenCalled();
  });

  it("masks a scheduled transfer counterpart the delegate cannot READ", async () => {
    delegationService.readableAccountIds.mockResolvedValue(["a1"]);
    const body = {
      data: [
        {
          id: "s1",
          isTransfer: true,
          transferAccountId: "a2",
          transferAccount: { id: "a2", name: "Savings" },
          transferAccountName: "Savings",
          splits: [
            {
              isTransfer: true,
              transferAccountId: "a3",
              transferAccount: { id: "a3", name: "Brokerage" },
            },
          ],
        },
      ],
    };
    await lastValueFrom(
      interceptor.intercept(
        ctxFor({ isActing: true, delegationId: "g1" }),
        handlerOf(body),
      ),
    );
    expect(body.data[0].transferAccount).toEqual({
      id: "a2",
      name: "Hidden account",
    });
    expect(body.data[0].transferAccountName).toBe("Hidden account");
    expect(body.data[0].splits[0].transferAccount).toEqual({
      id: "a3",
      name: "Hidden account",
    });
  });

  it("leaves a readable counterpart untouched", async () => {
    delegationService.readableAccountIds.mockResolvedValue(["a1", "a2"]);
    const body = [
      {
        id: "s1",
        isTransfer: true,
        transferAccountId: "a2",
        transferAccount: { id: "a2", name: "Savings" },
      },
    ];
    await lastValueFrom(
      interceptor.intercept(
        ctxFor({ isActing: true, delegationId: "g1" }),
        handlerOf(body),
      ),
    );
    expect(body[0].transferAccount).toEqual({ id: "a2", name: "Savings" });
  });

  it("masks a single (non-array) scheduled object", async () => {
    delegationService.readableAccountIds.mockResolvedValue([]);
    const body = {
      id: "s1",
      isTransfer: true,
      transferAccountId: "a2",
      transferAccount: { id: "a2", name: "Savings" },
    };
    await lastValueFrom(
      interceptor.intercept(
        ctxFor({ isActing: true, delegationId: "g1" }),
        handlerOf(body),
      ),
    );
    expect(body.transferAccount).toEqual({
      id: "a2",
      name: "Hidden account",
    });
  });
});
