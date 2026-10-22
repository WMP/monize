import { Test, TestingModule } from "@nestjs/testing";
import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";

import { ALLOW_DELEGATE_KEY } from "../delegation/decorators/delegate-access.decorator";
import { CreateWarrantyDto } from "./dto/create-warranty.dto";
import { WarrantiesController } from "./warranties.controller";
import { WarrantiesService } from "./warranties.service";

const USER = "11111111-1111-4111-8111-111111111111";
const W1 = "22222222-2222-4222-8222-222222222222";

describe("WarrantiesController", () => {
  let controller: WarrantiesController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: USER, realUserId: USER } };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      summary: jest.fn().mockResolvedValue({ total: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: W1 }),
      create: jest.fn().mockResolvedValue({ id: W1 }),
      update: jest.fn().mockResolvedValue({ id: W1 }),
      remove: jest.fn().mockResolvedValue(undefined),
      archive: jest.fn().mockResolvedValue({ id: W1 }),
      unarchive: jest.fn().mockResolvedValue({ id: W1 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WarrantiesController],
      providers: [{ provide: WarrantiesService, useValue: service }],
    }).compile();
    controller = module.get(WarrantiesController);
  });

  it("takes the user id from the JWT on every route, never from the request", async () => {
    const dto = Object.assign(new CreateWarrantyDto(), {
      name: "Laptop",
      purchaseDate: "2026-10-01",
      isLifetime: true,
    });
    await controller.findAll(req, { status: "expiring" });
    await controller.summary(req);
    await controller.findOne(req, W1);
    await controller.create(req, dto);
    await controller.update(req, W1, { name: "Renamed" });
    await controller.remove(req, W1);
    await controller.archive(req, W1);
    await controller.unarchive(req, W1);

    expect(service.findAll).toHaveBeenCalledWith(USER, { status: "expiring" });
    expect(service.summary).toHaveBeenCalledWith(USER);
    expect(service.findOne).toHaveBeenCalledWith(USER, W1);
    expect(service.create).toHaveBeenCalledWith(USER, dto);
    expect(service.update).toHaveBeenCalledWith(USER, W1, { name: "Renamed" });
    expect(service.remove).toHaveBeenCalledWith(USER, W1);
    expect(service.archive).toHaveBeenCalledWith(USER, W1);
    expect(service.unarchive).toHaveBeenCalledWith(USER, W1);
  });

  it("answers the service's view", async () => {
    await expect(controller.findOne(req, W1)).resolves.toEqual({ id: W1 });
  });

  it("deletes with 204 and archives with 200", () => {
    const proto = WarrantiesController.prototype;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.remove)).toBe(204);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.archive)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.unarchive)).toBe(200);
  });

  it("is guarded by the JWT and mounted at /warranties", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WarrantiesController),
    ).toHaveLength(1);
    expect(Reflect.getMetadata(PATH_METADATA, WarrantiesController)).toBe(
      "warranties",
    );
  });

  it("declares GET summary before GET :id, which would take it as an id", () => {
    const getRoutes = Object.getOwnPropertyNames(WarrantiesController.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => {
        const handler = (
          WarrantiesController.prototype as unknown as Record<string, object>
        )[name];
        return {
          method: Reflect.getMetadata(METHOD_METADATA, handler),
          path: Reflect.getMetadata(PATH_METADATA, handler),
        };
      })
      .filter((route) => route.method === RequestMethod.GET)
      .map((route) => route.path);
    expect(getRoutes.indexOf("summary")).toBeGreaterThanOrEqual(0);
    expect(getRoutes.indexOf("summary")).toBeLessThan(getRoutes.indexOf(":id"));
  });

  it("lets no delegate in until the warranties section exists (task B5)", () => {
    // Owner-only by the guard's default; B5 adds @AllowDelegate with the
    // section to the read routes only.
    expect(
      Reflect.getMetadata(ALLOW_DELEGATE_KEY, WarrantiesController),
    ).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(
      WarrantiesController.prototype,
    )) {
      const handler = (
        WarrantiesController.prototype as unknown as Record<string, object>
      )[name];
      expect([name, Reflect.getMetadata(ALLOW_DELEGATE_KEY, handler)]).toEqual([
        name,
        undefined,
      ]);
    }
  });
});
