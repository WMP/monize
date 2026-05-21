import { Test, TestingModule } from "@nestjs/testing";
import { EmergencyAccessController } from "./emergency-access.controller";
import { EmergencyAccessService } from "./emergency-access.service";
import { StepUpGuard } from "../auth/step-up/step-up.guard";

describe("EmergencyAccessController", () => {
  let controller: EmergencyAccessController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: "user-1" } };

  beforeEach(async () => {
    service = {
      getView: jest.fn().mockResolvedValue({ enabled: false }),
      getMessage: jest.fn().mockResolvedValue({ message: "secret" }),
      updateMessage: jest
        .fn()
        .mockResolvedValue({ hasMessage: true, charCount: 6, updatedAt: null }),
      upsertSettings: jest.fn().mockResolvedValue({ enabled: true }),
      addContact: jest.fn().mockResolvedValue({ id: "c1" }),
      updateContact: jest.fn().mockResolvedValue({ id: "c1" }),
      removeContact: jest.fn().mockResolvedValue(undefined),
      resetGrantedState: jest.fn().mockResolvedValue({ enabled: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyAccessController],
      providers: [{ provide: EmergencyAccessService, useValue: service }],
    })
      .overrideGuard(StepUpGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(EmergencyAccessController);
  });

  it("delegates GET / to getView with the JWT user id", async () => {
    await controller.get(req);
    expect(service.getView).toHaveBeenCalledWith("user-1");
  });

  it("delegates GET /message to getMessage", async () => {
    await expect(controller.getMessage(req)).resolves.toEqual({
      message: "secret",
    });
    expect(service.getMessage).toHaveBeenCalledWith("user-1");
  });

  it("delegates PUT /message to updateMessage", async () => {
    const dto = { message: "hello" };
    await controller.putMessage(req, dto);
    expect(service.updateMessage).toHaveBeenCalledWith("user-1", "hello");
  });

  it("delegates PUT /settings to upsertSettings (no message field)", async () => {
    const dto = {
      enabled: true,
      grantAfterDays: 14,
      reminderAfterDays: 7,
    };
    await controller.putSettings(req, dto);
    expect(service.upsertSettings).toHaveBeenCalledWith("user-1", dto);
  });

  it("delegates POST /contacts to addContact", async () => {
    await controller.addContact(req, { firstName: "A", email: "a@x.com" });
    expect(service.addContact).toHaveBeenCalledWith("user-1", {
      firstName: "A",
      email: "a@x.com",
    });
  });

  it("delegates PATCH /contacts/:id to updateContact", async () => {
    await controller.updateContact(req, "c1", {
      firstName: "B",
      email: "b@x.com",
    });
    expect(service.updateContact).toHaveBeenCalledWith("user-1", "c1", {
      firstName: "B",
      email: "b@x.com",
    });
  });

  it("delegates DELETE /contacts/:id to removeContact", async () => {
    const result = await controller.removeContact(req, "c1");
    expect(service.removeContact).toHaveBeenCalledWith("user-1", "c1");
    expect(result).toEqual({ ok: true });
  });

  it("delegates POST /reset to resetGrantedState", async () => {
    await controller.reset(req);
    expect(service.resetGrantedState).toHaveBeenCalledWith("user-1");
  });
});
