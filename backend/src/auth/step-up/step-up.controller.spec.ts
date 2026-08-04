import { Test, TestingModule } from "@nestjs/testing";
import { StepUpAuthController } from "./step-up.controller";
import { StepUpAuthService } from "./step-up.service";
import { OidcReauthService } from "../oidc/oidc-reauth.service";

describe("StepUpAuthController", () => {
  let controller: StepUpAuthController;
  let service: Record<string, jest.Mock>;
  let oidcReauth: Record<string, jest.Mock>;
  const req = { user: { id: "user-1" } } as never;
  const res = { clearCookie: jest.fn() } as never;

  beforeEach(async () => {
    service = {
      verifyAndIssue: jest.fn().mockResolvedValue({
        stepUpToken: "tok",
        expiresAt: "2026-05-21T00:05:00.000Z",
        expiresInSeconds: 300,
      }),
    };
    oidcReauth = {
      verify: jest.fn().mockReturnValue(false),
      consume: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StepUpAuthController],
      providers: [
        { provide: StepUpAuthService, useValue: service },
        { provide: OidcReauthService, useValue: oidcReauth },
      ],
    }).compile();
    controller = module.get(StepUpAuthController);
  });

  it("forwards purpose, password and totpCode to the service", async () => {
    const result = await controller.verify(
      req,
      {
        purpose: "emergency-access",
        password: "hunter2",
        totpCode: "123456",
      },
      res,
    );
    expect(service.verifyAndIssue).toHaveBeenCalledWith(
      "user-1",
      "emergency-access",
      { password: "hunter2", totpCode: "123456", oidcReauthProven: false },
    );
    expect(result.stepUpToken).toBe("tok");
  });

  // The client used to assert its own re-authentication with an `oidcConfirmed`
  // flag in the body. The proof now comes from the HttpOnly cookie the OIDC
  // callback set, verified against the caller's own user id.
  it("takes the OIDC proof from the verified cookie, not the request body", async () => {
    oidcReauth.verify.mockReturnValue(true);

    await controller.verify(req, { purpose: "emergency-access" }, res);

    // The proof is checked against the purpose being requested, so a step-up
    // started for a restore cannot mint an emergency-access token.
    expect(oidcReauth.verify).toHaveBeenCalledWith(
      req,
      "user-1",
      "emergency-access",
    );
    expect(service.verifyAndIssue).toHaveBeenCalledWith(
      "user-1",
      "emergency-access",
      { password: undefined, totpCode: undefined, oidcReauthProven: true },
    );
  });

  it("spends the proof so one redirect buys one token", async () => {
    oidcReauth.verify.mockReturnValue(true);
    await controller.verify(req, { purpose: "emergency-access" }, res);
    expect(oidcReauth.consume).toHaveBeenCalledWith(res);
  });

  it("leaves nothing to consume when no proof was present", async () => {
    await controller.verify(req, { purpose: "emergency-access" }, res);
    expect(oidcReauth.consume).not.toHaveBeenCalled();
  });
});
