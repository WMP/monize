import { Test, TestingModule } from "@nestjs/testing";
import { BrokerImportController } from "./broker-import.controller";
import { BrokerImportService } from "./broker-import.service";

describe("BrokerImportController", () => {
  let controller: BrokerImportController;
  let service: Partial<Record<keyof BrokerImportService, jest.Mock>>;

  const req = { user: { id: "user-1" } };

  beforeEach(async () => {
    service = {
      parse: jest.fn(),
      apply: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrokerImportController],
      providers: [{ provide: BrokerImportService, useValue: service }],
    }).compile();

    controller = module.get<BrokerImportController>(BrokerImportController);
  });

  it("delegates parse with the JWT userId", async () => {
    const dto = { html: "<table></table>" };
    const expected = { orders: [], model: "m", warnings: [] };
    (service.parse as jest.Mock).mockResolvedValue(expected);

    const result = await controller.parse(req, dto);

    expect(service.parse).toHaveBeenCalledWith("user-1", dto);
    expect(result).toBe(expected);
  });

  it("delegates apply with the JWT userId", async () => {
    const dto = {
      accountId: "acct-1",
      orders: [
        {
          securityId: "sec-1",
          side: "BUY" as const,
          quantity: 1,
          price: 1,
          commission: 0,
          currency: "EUR",
          tradeDate: "2026-06-05",
        },
      ],
    };
    const expected = {
      created: 1,
      securitiesCreated: 0,
      skipped: 0,
      errors: [],
    };
    (service.apply as jest.Mock).mockResolvedValue(expected);

    const result = await controller.apply(req, dto);

    expect(service.apply).toHaveBeenCalledWith("user-1", dto);
    expect(result).toBe(expected);
  });
});
