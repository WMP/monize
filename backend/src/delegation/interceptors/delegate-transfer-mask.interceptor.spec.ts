import { of, lastValueFrom } from "rxjs";
import { DelegateTransferMaskInterceptor } from "./delegate-transfer-mask.interceptor";

describe("DelegateTransferMaskInterceptor", () => {
  let interceptor: DelegateTransferMaskInterceptor;
  let crossOwnerAccess: Record<string, jest.Mock>;

  const ctxFor = (user: any) =>
    ({
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;
  const handlerOf = (body: unknown) => ({ handle: () => of(body) }) as any;

  const actingUser = {
    id: "owner-1",
    realUserId: "delegate-1",
    isActing: true,
    delegationId: "g1",
  };
  const normalUser = { id: "user-1", realUserId: "user-1", isActing: false };

  beforeEach(() => {
    crossOwnerAccess = { readableAccountIdSetFor: jest.fn() };
    interceptor = new DelegateTransferMaskInterceptor(crossOwnerAccess as any);
  });

  it("fast path: a non-acting user with no cross-owner rows never hits the grants query", async () => {
    const body = {
      data: [
        { id: "t1", isTransfer: false },
        {
          id: "t2",
          userId: "user-1",
          isTransfer: true,
          linkedTransaction: { userId: "user-1", accountId: "a2" },
        },
      ],
    };
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(normalUser), handlerOf(body)),
    );
    expect(out).toBe(body);
    expect(crossOwnerAccess.readableAccountIdSetFor).not.toHaveBeenCalled();
  });

  it("passes through for an unauthenticated request", async () => {
    const body = [{ id: "t1", isTransfer: true }];
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(undefined), handlerOf(body)),
    );
    expect(out).toBe(body);
    expect(crossOwnerAccess.readableAccountIdSetFor).not.toHaveBeenCalled();
  });

  it("masks a post-unshare findOne for a NON-acting user: account name, balance and auto payee", async () => {
    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(new Set(["a1"]));
    const body = {
      id: "t1",
      userId: "user-1",
      isTransfer: true,
      payeeName: "Transfer to Owner Savings",
      linkedTransaction: {
        userId: "owner-2",
        accountId: "a2",
        account: { id: "a2", name: "Owner Savings", currentBalance: 12345.67 },
      },
    };
    const out: any = await lastValueFrom(
      interceptor.intercept(ctxFor(normalUser), handlerOf(body)),
    );
    expect(crossOwnerAccess.readableAccountIdSetFor).toHaveBeenCalledWith(
      "user-1",
    );
    // The full Account load (balance included) is replaced by the stub.
    expect(out.linkedTransaction.account).toEqual({
      id: "a2",
      name: "Hidden account",
    });
    expect(out.payeeName).toBe("Transfer to Hidden account");
  });

  it("keeps a readable cross-owner counterpart unmasked (connected pair)", async () => {
    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(
      new Set(["a1", "a2"]),
    );
    const body = [
      {
        id: "t1",
        userId: "user-1",
        isTransfer: true,
        payeeName: "Transfer to Owner Savings",
        linkedTransaction: {
          userId: "owner-2",
          accountId: "a2",
          account: { id: "a2", name: "Owner Savings" },
        },
      },
    ];
    const out: any = await lastValueFrom(
      interceptor.intercept(ctxFor(normalUser), handlerOf(body)),
    );
    expect(out[0].linkedTransaction.account.name).toBe("Owner Savings");
    expect(out[0].payeeName).toBe("Transfer to Owner Savings");
  });

  it("joint revoke transition: the same payload masks once the readable set loses the account", async () => {
    // A joint grant implies can_read, so a connected joint counterpart is in
    // the readable set and stays unmasked; revoking the grant shrinks the set
    // and the identical payload comes back masked -- no code path in between.
    const bodyFor = () => ({
      id: "t1",
      userId: "user-1",
      isTransfer: true,
      payeeName: "Transfer to Household",
      linkedTransaction: {
        userId: "owner-2",
        accountId: "joint-1",
        account: { id: "joint-1", name: "Household", currentBalance: 500 },
      },
    });

    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(
      new Set(["a1", "joint-1"]),
    );
    const connected: any = await lastValueFrom(
      interceptor.intercept(ctxFor(normalUser), handlerOf(bodyFor())),
    );
    expect(connected.linkedTransaction.account.name).toBe("Household");

    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(new Set(["a1"]));
    const revoked: any = await lastValueFrom(
      interceptor.intercept(ctxFor(normalUser), handlerOf(bodyFor())),
    );
    expect(revoked.linkedTransaction.account).toEqual({
      id: "joint-1",
      name: "Hidden account",
    });
    expect(revoked.payeeName).toBe("Transfer to Hidden account");
  });

  it("masks a transfer counterpart the acting delegate cannot READ (unchanged behavior)", async () => {
    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(new Set(["a1"]));
    const body = {
      data: [
        {
          id: "t1",
          isTransfer: true,
          payeeName: "Transfer to Savings",
          linkedTransaction: {
            accountId: "a2",
            account: { id: "a2", name: "Savings" },
          },
        },
      ],
    };
    const out: any = await lastValueFrom(
      interceptor.intercept(ctxFor(actingUser), handlerOf(body)),
    );
    expect(crossOwnerAccess.readableAccountIdSetFor).toHaveBeenCalledWith(
      "delegate-1",
    );
    expect(out.data[0].linkedTransaction.account).toEqual({
      id: "a2",
      name: "Hidden account",
    });
    expect(out.data[0].payeeName).toBe("Transfer to Hidden account");
  });

  it("does not mask when the counterpart is readable while acting", async () => {
    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(
      new Set(["a1", "a2"]),
    );
    const body = [
      {
        id: "t1",
        isTransfer: true,
        payeeName: "Transfer to Savings",
        linkedTransaction: {
          accountId: "a2",
          account: { id: "a2", name: "Savings" },
        },
      },
    ];
    const out: any = await lastValueFrom(
      interceptor.intercept(ctxFor(actingUser), handlerOf(body)),
    );
    expect(out[0].linkedTransaction.account.name).toBe("Savings");
    expect(out[0].payeeName).toBe("Transfer to Savings");
  });

  it("masks a single transaction object and ignores non-transfers", async () => {
    crossOwnerAccess.readableAccountIdSetFor.mockResolvedValue(new Set());
    const body = {
      id: "t1",
      isTransfer: true,
      payeeName: "Transfer from Chequing",
      linkedTransaction: {
        accountId: "a9",
        account: { id: "a9", name: "Chequing" },
      },
    };
    const out: any = await lastValueFrom(
      interceptor.intercept(ctxFor(actingUser), handlerOf(body)),
    );
    expect(out.linkedTransaction.account.name).toBe("Hidden account");
    expect(out.payeeName).toBe("Transfer from Hidden account");
  });
});
