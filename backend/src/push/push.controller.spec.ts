import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Test, TestingModule } from "@nestjs/testing";
import { DEMO_RESTRICTED_KEY } from "../common/guards/demo-mode.guard";
import { PushController } from "./push.controller";
import { PushConfigService } from "./push-config.service";
import { PushSubscriptionService } from "./push-subscription.service";

const CALLER = { user: { id: "user-1" } };

/**
 * TEST DRIVE BUILD: this file is the real branch's spec with the
 * AdminNotificationsController block removed -- that controller configures the
 * instance's stored push identity, which is exactly the part this build replaces
 * with process memory and does not expose a page for.
 */
describe("PushController", () => {
  let controller: PushController;
  let pushConfig: Partial<Record<keyof PushConfigService, jest.Mock>>;
  let subscriptions: Partial<Record<keyof PushSubscriptionService, jest.Mock>>;

  beforeEach(async () => {
    pushConfig = { getPublicConfig: jest.fn() };
    subscriptions = {
      listForUser: jest.fn(),
      subscribe: jest.fn(),
      remove: jest.fn(),
      sendTest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [
        { provide: PushConfigService, useValue: pushConfig },
        { provide: PushSubscriptionService, useValue: subscriptions },
      ],
    }).compile();

    controller = module.get(PushController);
  });

  // The acceptance criterion this pins (discussion #1291): a subscription
  // belongs to the authenticated caller. Every route below reads req.user.id,
  // and no route takes a user id from anywhere else.
  it.each([
    ["list", () => controller.list(CALLER), "listForUser"],
    ["test", () => controller.test(CALLER), "sendTest"],
  ] as const)(
    "derives the tenant from the JWT on %s",
    (_name, call, method) => {
      call();
      expect(subscriptions[method]).toHaveBeenCalledWith("user-1");
    },
  );

  it("passes the caller, the payload and the browser's user agent to subscribe", () => {
    const dto = { endpoint: "https://x", p256dh: "a", auth: "b" } as never;

    controller.subscribe(CALLER, dto, "Mozilla/5.0");

    expect(subscriptions.subscribe).toHaveBeenCalledWith(
      "user-1",
      dto,
      "Mozilla/5.0",
    );
  });

  it("passes a null user agent rather than undefined when the header is absent", () => {
    const dto = { endpoint: "https://x", p256dh: "a", auth: "b" } as never;

    controller.subscribe(CALLER, dto);

    expect(subscriptions.subscribe).toHaveBeenCalledWith("user-1", dto, null);
  });

  it("scopes a device removal to the caller", () => {
    controller.remove(CALLER, "device-1");

    expect(subscriptions.remove).toHaveBeenCalledWith("user-1", "device-1");
  });

  it("guards every route with the JWT strategy", () => {
    const guards = new Reflector().get("__guards__", PushController) ?? [];
    const names = guards.map((g: unknown) => (g as { name?: string })?.name);

    expect(guards).toHaveLength(1);
    expect(names[0]).toBe(AuthGuard("jwt").name);
  });

  // Every demo visitor shares one account, so a subscription registered by one
  // visitor would receive the test notification another visitor triggered -- and
  // `remove` is on this list because it is a WRITE, not because it is expensive:
  // it was grouped with the reads and called "read-only", which a DELETE is not.
  // On one shared account a removal is a stranger deleting the row somebody else
  // is looking at.
  it.each(["subscribe", "test", "remove"] as const)(
    "restricts %s in demo mode",
    (method) => {
      expect(
        new Reflector().get(
          DEMO_RESTRICTED_KEY,
          PushController.prototype[method],
        ),
      ).toBe(true);
    },
  );

  it.each(["list", "getConfig"] as const)(
    "leaves the read-only route %s available in demo mode",
    (method) => {
      expect(
        new Reflector().get(
          DEMO_RESTRICTED_KEY,
          PushController.prototype[method],
        ),
      ).toBeUndefined();
    },
  );
});
