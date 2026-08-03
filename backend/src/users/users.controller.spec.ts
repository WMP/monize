import { Test, TestingModule } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import {
  fullyPopulatedUser,
  nonProfileUserFields,
} from "./user-profile.test-util";

const EXCLUDED_USER_FIELDS = nonProfileUserFields();
const populatedOwner = () => fullyPopulatedUser();

describe("UsersController", () => {
  let controller: UsersController;
  let mockUsersService: Record<string, jest.Mock>;
  const mockReq = { user: { id: "user-1", realUserId: "user-1" } };

  beforeEach(async () => {
    mockUsersService = {
      findById: jest.fn(),
      updateProfile: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
      changePassword: jest.fn(),
      deleteAccount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe("getProfile()", () => {
    it("returns sanitized user profile with hasPassword field", async () => {
      mockUsersService.findById.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        firstName: "John",
        lastName: "Doe",
        passwordHash: "$2b$10$hashedsecret",
        resetToken: "some-token",
        resetTokenExpiry: new Date(),
        twoFactorSecret: "secret123",
      });

      const result = await controller.getProfile(mockReq);

      expect(result).toEqual({
        id: "user-1",
        email: "test@example.com",
        firstName: "John",
        lastName: "Doe",
        hasPassword: true,
      });
      expect(result).not.toHaveProperty("passwordHash");
      expect(result).not.toHaveProperty("resetToken");
      expect(result).not.toHaveProperty("resetTokenExpiry");
      expect(result).not.toHaveProperty("twoFactorSecret");
      expect(mockUsersService.findById).toHaveBeenCalledWith("user-1");
    });

    it("sets hasPassword to false when passwordHash is null", async () => {
      mockUsersService.findById.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        passwordHash: null,
        resetToken: null,
        resetTokenExpiry: null,
        twoFactorSecret: null,
      });

      const result = await controller.getProfile(mockReq);

      expect(result).toMatchObject({ hasPassword: false });
    });

    // P2-003: the route is @AllowDelegate() and resolves req.user.id, which is
    // the OWNER while acting. The previous implementation spread the entity and
    // removed four fields by name, so every other @Exclude() column -- the ones
    // added after that list was written -- reached the delegate.
    it("withholds every excluded security column from an acting delegate", async () => {
      mockUsersService.findById.mockResolvedValue({
        ...populatedOwner(),
      });

      const result = (await controller.getProfile({
        user: { id: "owner-1", realUserId: "delegate-2", isActing: true },
      })) as Record<string, unknown>;

      for (const field of EXCLUDED_USER_FIELDS) {
        expect(result).not.toHaveProperty(field);
      }
      // Identification survives so the UI can say whose finances are on screen.
      expect(result).toMatchObject({
        id: "owner-1",
        email: "owner@example.com",
      });
      // The owner's credential state does not: a delegate's own password/2FA
      // controls read GET /auth/me-self, which resolves the real user.
      expect(result).not.toHaveProperty("hasPassword");
      expect(result).not.toHaveProperty("mustChangePassword");
      expect(result).not.toHaveProperty("backupEncryptionEnabled");
    });

    it("withholds every excluded security column from the account holder too", async () => {
      mockUsersService.findById.mockResolvedValue({ ...populatedOwner() });

      const result = (await controller.getProfile({
        user: { id: "owner-1", realUserId: "owner-1", isActing: false },
      })) as Record<string, unknown>;

      for (const field of EXCLUDED_USER_FIELDS) {
        expect(result).not.toHaveProperty(field);
      }
      expect(result).toMatchObject({ hasPassword: true });
    });

    it("returns null when user is not found", async () => {
      mockUsersService.findById.mockResolvedValue(null);

      const result = await controller.getProfile(mockReq);

      expect(result).toBeNull();
    });
  });

  describe("updateProfile()", () => {
    it("delegates to usersService.updateProfile with userId and dto", async () => {
      const dto = { firstName: "Jane", lastName: "Smith" };
      const expected = {
        id: "user-1",
        firstName: "Jane",
        lastName: "Smith",
      };
      mockUsersService.updateProfile.mockResolvedValue(expected);

      const result = await controller.updateProfile(mockReq, dto as any);

      expect(result).toEqual(expected);
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
    });
  });

  describe("getPreferences()", () => {
    it("delegates to usersService.getPreferences with userId", async () => {
      const expected = { currency: "USD", dateFormat: "MM/DD/YYYY" };
      mockUsersService.getPreferences.mockResolvedValue(expected);

      const result = await controller.getPreferences(mockReq);

      expect(result).toEqual(expected);
      expect(mockUsersService.getPreferences).toHaveBeenCalledWith("user-1");
    });
  });

  describe("updatePreferences()", () => {
    it("delegates to usersService.updatePreferences with userId and dto", async () => {
      const dto = { currency: "EUR" };
      const expected = { currency: "EUR", dateFormat: "MM/DD/YYYY" };
      mockUsersService.updatePreferences.mockResolvedValue(expected);

      const result = await controller.updatePreferences(mockReq, dto as any);

      expect(result).toEqual(expected);
      expect(mockUsersService.updatePreferences).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
    });
  });

  describe("changePassword()", () => {
    it("delegates to usersService.changePassword and returns success message", async () => {
      const dto = { currentPassword: "old123", newPassword: "new456" };
      mockUsersService.changePassword.mockResolvedValue(undefined);

      const result = await controller.changePassword(mockReq, dto as any);

      expect(result).toEqual({ message: "Password changed successfully" });
      expect(mockUsersService.changePassword).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
    });

    it("targets the real (delegate) user id, never the owner, when acting", async () => {
      const dto = { currentPassword: "old123", newPassword: "new456" };
      mockUsersService.changePassword.mockResolvedValue(undefined);
      const actingReq = {
        user: { id: "owner-1", realUserId: "delegate-1", isActing: true },
      };

      await controller.changePassword(actingReq as any, dto as any);

      expect(mockUsersService.changePassword).toHaveBeenCalledWith(
        "delegate-1",
        dto,
      );
    });
  });

  describe("deleteAccount()", () => {
    it("delegates to usersService.deleteAccount and returns success message", async () => {
      mockUsersService.deleteAccount.mockResolvedValue({ downgraded: false });
      const dto = { password: "mypass" };

      const result = await controller.deleteAccount(mockReq, dto);

      expect(result).toEqual({
        message: "Account deleted successfully",
        downgraded: false,
      });
      expect(mockUsersService.deleteAccount).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
    });

    it("returns a downgrade-aware message when the account is demoted to a delegate", async () => {
      mockUsersService.deleteAccount.mockResolvedValue({ downgraded: true });
      const dto = { password: "mypass" };

      const result = await controller.deleteAccount(mockReq, dto);

      expect(result).toEqual({
        message:
          "Your own data was removed. Your login and any shared access others granted you remain.",
        downgraded: true,
      });
    });
  });

  describe("deleteData()", () => {
    it("delegates to usersService.deleteData and returns result", async () => {
      const deleted = { transactions: 50, securities: 10 };
      mockUsersService.deleteData = jest.fn().mockResolvedValue({ deleted });
      const dto = { password: "mypass", deleteAccounts: true };

      const result = await controller.deleteData(mockReq, dto);

      expect(result).toEqual({ deleted });
      expect(mockUsersService.deleteData).toHaveBeenCalledWith("user-1", dto);
    });
  });
});
