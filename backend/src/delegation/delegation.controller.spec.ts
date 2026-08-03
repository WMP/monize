import { Test, TestingModule } from "@nestjs/testing";
import { DelegationController } from "./delegation.controller";
import { DelegationService } from "./delegation.service";
import { JointAccountsService } from "./joint-accounts.service";

describe("DelegationController", () => {
  let controller: DelegationController;
  let service: Record<string, jest.Mock>;
  let jointAccounts: Record<string, jest.Mock>;
  const req = { user: { id: "owner-1" } };

  beforeEach(async () => {
    service = {
      listDelegates: jest.fn().mockResolvedValue(["d"]),
      createDelegate: jest.fn().mockResolvedValue({ id: "g1" }),
      delegateEmailExists: jest.fn().mockResolvedValue(true),
      revokeDelegate: jest.fn().mockResolvedValue(undefined),
      setGrants: jest.fn().mockResolvedValue(undefined),
      setCapabilities: jest.fn().mockResolvedValue(undefined),
      setSectionGrants: jest.fn().mockResolvedValue(undefined),
      resetDelegatePassword: jest
        .fn()
        .mockResolvedValue({ temporaryPassword: "x" }),
    };

    jointAccounts = {
      jointReferenceData: jest.fn().mockResolvedValue({
        categories: [],
        payees: [],
        payeesCanCreate: false,
        categoriesCanCreate: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DelegationController],
      providers: [
        { provide: DelegationService, useValue: service },
        { provide: JointAccountsService, useValue: jointAccounts },
      ],
    }).compile();

    controller = module.get<DelegationController>(DelegationController);
  });

  it("serves joint reference data keyed by the real user", async () => {
    await controller.getJointReferenceData(
      { user: { id: "u1", realUserId: "u1" } },
      "acc-1",
    );
    expect(jointAccounts.jointReferenceData).toHaveBeenCalledWith(
      "u1",
      "acc-1",
    );
  });

  it("lists delegates for the current owner", async () => {
    await expect(controller.listDelegates(req)).resolves.toEqual(["d"]);
    expect(service.listDelegates).toHaveBeenCalledWith("owner-1");
  });

  it("looks up whether an email already exists", async () => {
    await expect(
      controller.lookupDelegate({ email: "a@b.c" } as never),
    ).resolves.toEqual({ exists: true });
    expect(service.delegateEmailExists).toHaveBeenCalledWith("a@b.c");
  });

  /**
   * The lookup answers "does this address have a Monize login", which makes it an
   * enumeration oracle. Elevating the probe (P2-007) is what made it answer
   * correctly under enforcement -- and therefore reliable enough to enumerate with
   * -- so it carries a throttle far below the global 100/minute. This repo already
   * takes enumeration seriously: forgot-password always reports success.
   */
  it("throttles the email-existence lookup well below the global limit", () => {
    // @Throttle writes one metadata key per named limiter, suffixed with the
    // limiter's name -- reading them by name rather than a single options object.
    const handler = DelegationController.prototype.lookupDelegate;
    const limit = Reflect.getMetadata("THROTTLER:LIMITdefault", handler);
    const ttl = Reflect.getMetadata("THROTTLER:TTLdefault", handler);

    expect(typeof limit).toBe("number");
    expect(typeof ttl).toBe("number");
    // At most a few dozen an hour, against 6000 at the global default.
    expect((limit / ttl) * 3_600_000).toBeLessThanOrEqual(60);
  });

  it("creates a delegate", async () => {
    const dto = { email: "a@b.c" } as never;
    await controller.createDelegate(req, dto);
    expect(service.createDelegate).toHaveBeenCalledWith("owner-1", dto);
  });

  it("revokes a delegate", async () => {
    await controller.revokeDelegate(req, "g1");
    expect(service.revokeDelegate).toHaveBeenCalledWith("owner-1", "g1");
  });

  it("sets grants", async () => {
    const grants = [{ accountId: "a1", canRead: true, canCreate: true }];
    await controller.setGrants(req, "g1", { grants } as never);
    expect(service.setGrants).toHaveBeenCalledWith("owner-1", "g1", grants);
  });

  it("sets capabilities", async () => {
    const dto = { canManagePayees: true };
    await controller.setCapabilities(req, "g1", dto as never);
    expect(service.setCapabilities).toHaveBeenCalledWith("owner-1", "g1", dto);
  });

  it("sets section grants", async () => {
    const dto = { billsCanRead: true };
    await controller.setSectionGrants(req, "g1", dto as never);
    expect(service.setSectionGrants).toHaveBeenCalledWith("owner-1", "g1", dto);
  });

  it("resets a delegate password", async () => {
    await expect(controller.resetPassword(req, "g1")).resolves.toEqual({
      temporaryPassword: "x",
    });
    expect(service.resetDelegatePassword).toHaveBeenCalledWith("owner-1", "g1");
  });
});
