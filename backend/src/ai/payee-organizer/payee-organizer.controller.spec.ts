import { Test, TestingModule } from "@nestjs/testing";
import { PayeeOrganizerController } from "./payee-organizer.controller";
import { PayeeOrganizerService } from "./payee-organizer.service";

describe("PayeeOrganizerController", () => {
  let controller: PayeeOrganizerController;
  let service: Partial<Record<keyof PayeeOrganizerService, jest.Mock>>;

  const req = { user: { id: "user-1" } };

  beforeEach(async () => {
    service = {
      suggest: jest.fn(),
      apply: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayeeOrganizerController],
      providers: [{ provide: PayeeOrganizerService, useValue: service }],
    }).compile();

    controller = module.get<PayeeOrganizerController>(PayeeOrganizerController);
  });

  it("delegates suggest with the JWT userId", async () => {
    const expected = {
      categorySuggestions: [],
      mergeGroups: [],
      model: "m",
    };
    (service.suggest as jest.Mock).mockResolvedValue(expected);

    const result = await controller.suggest(req, { allowNewCategories: true });

    expect(service.suggest).toHaveBeenCalledWith("user-1", {
      allowNewCategories: true,
    });
    expect(result).toBe(expected);
  });

  it("delegates apply with the JWT userId", async () => {
    const dto = {
      categoryAssignments: [{ payeeId: "p1", categoryId: "c1" }],
      merges: [{ targetPayeeId: "t1", sourcePayeeIds: ["s1"] }],
    };
    const expected = {
      categoriesCreated: 1,
      payeesCategorized: 1,
      payeesMerged: 1,
      mergeRejectionsSaved: 0,
    };
    (service.apply as jest.Mock).mockResolvedValue(expected);

    const result = await controller.apply(req, dto);

    expect(service.apply).toHaveBeenCalledWith("user-1", dto);
    expect(result).toBe(expected);
  });
});
