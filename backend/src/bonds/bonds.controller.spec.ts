import {
  BadRequestException,
  NotFoundException,
  ParseUUIDPipe,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { BondCatalogService } from "./bond-catalog.service";
import {
  BondDataInconsistentError,
  BondDataNotFoundError,
} from "./bond-errors";
import { BondPriceService } from "./bond-price.service";
import { BondValuationService } from "./bond-valuation.service";
import { BondsController } from "./bonds.controller";
import { BondEngineError } from "./engine/bond-engine";

const USER = "11111111-1111-4111-8111-111111111111";
const SECURITY = "22222222-2222-4222-8222-222222222222";
const req = { user: { id: USER } };

describe("BondsController", () => {
  let controller: BondsController;
  let catalog: { listInstruments: jest.Mock };
  let valuation: { valueSecurity: jest.Mock };
  let prices: { recomputeSecurity: jest.Mock };

  beforeEach(async () => {
    catalog = { listInstruments: jest.fn().mockResolvedValue([]) };
    valuation = { valueSecurity: jest.fn().mockResolvedValue({ lots: [] }) };
    prices = {
      recomputeSecurity: jest
        .fn()
        .mockResolvedValue({ written: 2, deleted: 1 }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [BondsController],
      providers: [
        { provide: BondCatalogService, useValue: catalog },
        { provide: BondValuationService, useValue: valuation },
        { provide: BondPriceService, useValue: prices },
      ],
    }).compile();
    controller = moduleRef.get(BondsController);
  });

  it("guards every route with the JWT strategy", () => {
    const guards = new Reflector().get("__guards__", BondsController) ?? [];
    expect(guards).toHaveLength(1);
    expect(guards[0].name).toBe(AuthGuard("jwt").name);
  });

  describe("GET /bonds/instruments", () => {
    it("returns the catalog", async () => {
      const list = [
        {
          id: "i1",
          issuerCountryCode: "PL",
          issuerCode: "PL_MF",
          programCode: "TOS",
          seriesCode: "TOS1029",
          currencyCode: "PLN",
        },
      ];
      catalog.listInstruments.mockResolvedValue(list);
      await expect(controller.listInstruments()).resolves.toEqual(list);
    });
  });

  describe("GET /bonds/securities/:securityId/valuation", () => {
    it("values for the JWT's user, never one the request names, on the asked day", async () => {
      await controller.valuationOf(
        { user: { id: USER }, body: { userId: "attacker" } },
        SECURITY,
        "2027-04-15",
      );
      expect(valuation.valueSecurity).toHaveBeenCalledWith(
        USER,
        SECURITY,
        "2027-04-15",
      );
    });

    it("defaults asOf to today", async () => {
      await controller.valuationOf(req, SECURITY, undefined);
      const [, , asOf] = valuation.valueSecurity.mock.calls[0];
      expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("lets the 404 of another user's or an unlinked security through", async () => {
      valuation.valueSecurity.mockRejectedValue(new NotFoundException("no"));
      await expect(
        controller.valuationOf(req, SECURITY, "2027-04-15"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      [
        new BondDataNotFoundError("No terms version stored"),
        NotFoundException,
        /not available.*No terms version stored/,
      ],
      [
        new BondDataInconsistentError("TOS1030 vs TOS1029"),
        UnprocessableEntityException,
        /contradicts itself.*TOS1030/,
      ],
      [
        new BondEngineError("Quantity must be a positive integer"),
        BadRequestException,
        /not valid.*Quantity/,
      ],
    ])(
      "maps %p to an HTTP error carrying the reason",
      async (error, type, message) => {
        valuation.valueSecurity.mockRejectedValue(error);
        const failure = controller.valuationOf(req, SECURITY, "2027-04-15");
        await expect(failure).rejects.toBeInstanceOf(type);
        await expect(failure).rejects.toThrow(message);
      },
    );

    it("does not swallow an unexpected failure as a bond error", async () => {
      valuation.valueSecurity.mockRejectedValue(new Error("connection reset"));
      await expect(
        controller.valuationOf(req, SECURITY, "2027-04-15"),
      ).rejects.toThrow("connection reset");
    });
  });

  describe("POST /bonds/securities/:securityId/recompute", () => {
    it("recomputes for the JWT's user and returns the counts", async () => {
      await expect(controller.recompute(req, SECURITY)).resolves.toEqual({
        written: 2,
        deleted: 1,
      });
      expect(prices.recomputeSecurity).toHaveBeenCalledWith(USER, SECURITY);
    });

    it("maps the data errors the same way", async () => {
      prices.recomputeSecurity.mockRejectedValue(
        new BondDataNotFoundError("No instrument"),
      );
      await expect(controller.recompute(req, SECURITY)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("route parameters", () => {
    it("takes the security id through ParseUUIDPipe and asOf through the calendar-date pipe", () => {
      const pipesOf = (method: keyof BondsController) => {
        const args = Reflect.getMetadata(
          "__routeArguments__",
          BondsController,
          method as string,
        ) as Record<string, { data: string; pipes: unknown[] }>;
        return Object.values(args).map((a) => [
          a.data,
          a.pipes.map((p) =>
            typeof p === "function" ? p.name : (p as object).constructor.name,
          ),
        ]);
      };
      expect(pipesOf("valuationOf")).toEqual(
        expect.arrayContaining([
          ["securityId", [ParseUUIDPipe.name]],
          ["asOf", ["ParseOptionalCalendarDatePipe"]],
        ]),
      );
      expect(pipesOf("recompute")).toEqual(
        expect.arrayContaining([["securityId", [ParseUUIDPipe.name]]]),
      );
    });
  });
});
