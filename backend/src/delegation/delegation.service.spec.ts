import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { DelegationService, DELEGATE_2FA_REQUIRED } from "./delegation.service";

describe("DelegationService", () => {
  let service: DelegationService;
  let delegatesRepo: Record<string, jest.Mock>;
  let grantsRepo: Record<string, jest.Mock>;
  let usersRepo: Record<string, jest.Mock>;
  let prefsRepo: Record<string, jest.Mock>;
  let refreshRepo: Record<string, jest.Mock>;
  let accountsRepo: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;
  let dataSource: Record<string, jest.Mock>;

  beforeEach(() => {
    delegatesRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    grantsRepo = { findOne: jest.fn(), find: jest.fn() };
    usersRepo = { findOne: jest.fn(), save: jest.fn() };
    prefsRepo = { findOne: jest.fn() };
    refreshRepo = { update: jest.fn() };
    accountsRepo = { find: jest.fn(), exists: jest.fn() };
    emailService = { getStatus: jest.fn(), sendMail: jest.fn() };
    configService = { get: jest.fn() };
    dataSource = { transaction: jest.fn() };

    service = new DelegationService(
      delegatesRepo as any,
      grantsRepo as any,
      usersRepo as any,
      prefsRepo as any,
      refreshRepo as any,
      accountsRepo as any,
      emailService as any,
      configService as any,
      dataSource as any,
    );
  });

  describe("validateActingContext", () => {
    const args = {
      delegateUserId: "d1",
      actingAsUserId: "o1",
      delegationId: "g1",
    };

    it("rejects when the delegation is missing", async () => {
      delegatesRepo.findOne.mockResolvedValue(null);
      await expect(service.validateActingContext(args)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects when the delegation is revoked", async () => {
      delegatesRepo.findOne.mockResolvedValue({
        id: "g1",
        status: "revoked",
        delegateUserId: "d1",
        ownerUserId: "o1",
      });
      await expect(service.validateActingContext(args)).rejects.toThrow(
        "Delegated access is no longer valid",
      );
    });

    it("rejects when the delegate id does not match the token", async () => {
      delegatesRepo.findOne.mockResolvedValue({
        id: "g1",
        status: "active",
        delegateUserId: "someone-else",
        ownerUserId: "o1",
      });
      await expect(service.validateActingContext(args)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects when the owner is inactive", async () => {
      delegatesRepo.findOne.mockResolvedValue({
        id: "g1",
        status: "active",
        delegateUserId: "d1",
        ownerUserId: "o1",
      });
      usersRepo.findOne.mockResolvedValue({ id: "o1", isActive: false });
      await expect(service.validateActingContext(args)).rejects.toThrow(
        "Delegated access is no longer valid",
      );
    });

    it("throws DELEGATE_2FA_REQUIRED when owner needs 2FA and delegate lacks it", async () => {
      delegatesRepo.findOne.mockResolvedValue({
        id: "g1",
        status: "active",
        delegateUserId: "d1",
        ownerUserId: "o1",
      });
      // owner active (validateActingContext call) then owner+pref for 2FA
      usersRepo.findOne.mockImplementation(({ where }: any) =>
        where.id === "o1"
          ? { id: "o1", isActive: true, twoFactorSecret: "secret" }
          : { id: "d1", twoFactorSecret: null },
      );
      prefsRepo.findOne.mockImplementation(({ where }: any) =>
        where.userId === "o1"
          ? { userId: "o1", twoFactorEnabled: true }
          : { userId: "d1", twoFactorEnabled: false },
      );

      await expect(service.validateActingContext(args)).rejects.toThrow(
        DELEGATE_2FA_REQUIRED,
      );
    });

    it("returns the delegation when everything checks out", async () => {
      const delegation = {
        id: "g1",
        status: "active",
        delegateUserId: "d1",
        ownerUserId: "o1",
      };
      delegatesRepo.findOne.mockResolvedValue(delegation);
      usersRepo.findOne.mockResolvedValue({
        id: "o1",
        isActive: true,
        twoFactorSecret: null,
      });
      prefsRepo.findOne.mockResolvedValue({ twoFactorEnabled: false });

      await expect(service.validateActingContext(args)).resolves.toBe(
        delegation,
      );
    });
  });

  describe("hasReadAccess", () => {
    it("is true only when a can_read grant exists", async () => {
      grantsRepo.findOne.mockResolvedValue({ id: "x" });
      await expect(service.hasReadAccess("g1", "a1")).resolves.toBe(true);
      grantsRepo.findOne.mockResolvedValue(null);
      await expect(service.hasReadAccess("g1", "a1")).resolves.toBe(false);
    });
  });

  describe("resolveSwitchTarget", () => {
    it("returns null for the delegate's own id (self)", async () => {
      await expect(service.resolveSwitchTarget("d1", "d1")).resolves.toBeNull();
    });

    it("throws when there is no active delegation for the target", async () => {
      delegatesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resolveSwitchTarget("d1", "o1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("setGrants", () => {
    it("rejects accounts that do not belong to the owner", async () => {
      delegatesRepo.findOne.mockResolvedValue({ id: "g1", ownerUserId: "o1" });
      accountsRepo.find.mockResolvedValue([{ id: "a1" }]); // only 1 of 2 owned
      await expect(
        service.setGrants("o1", "g1", ["a1", "a2"]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("throws when the delegation is not owned by the caller", async () => {
      delegatesRepo.findOne.mockResolvedValue(null);
      await expect(service.setGrants("o1", "g1", [])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("replaces grants atomically for owned accounts", async () => {
      delegatesRepo.findOne.mockResolvedValue({ id: "g1", ownerUserId: "o1" });
      accountsRepo.find.mockResolvedValue([{ id: "a1" }]);
      const manager = {
        delete: jest.fn(),
        create: jest.fn((_e, v) => v),
        save: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await service.setGrants("o1", "g1", ["a1"]);

      expect(manager.delete).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
    });
  });
});
