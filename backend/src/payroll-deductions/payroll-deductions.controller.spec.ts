import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import {
  CreatePayrollDeductionRuleDto,
  CreatePayrollDeductionRulesDto,
} from "./dto/create-payroll-deduction-rule.dto";
import { PayrollDeductionsController } from "./payroll-deductions.controller";
import { PayrollDeductionsService } from "./payroll-deductions.service";

const USER = "11111111-1111-4111-8111-111111111111";
const RULE = "22222222-2222-4222-8222-222222222222";
const BILL = "33333333-3333-4333-8333-333333333333";
const CATEGORY = "44444444-4444-4444-8444-444444444444";

describe("PayrollDeductionsController", () => {
  let controller: PayrollDeductionsController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: USER } };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      history: jest.fn().mockResolvedValue([]),
      suggestExpected: jest.fn().mockResolvedValue({
        expectedPerPaycheque: 64,
        expectedSource: "line",
      }),
      create: jest.fn().mockResolvedValue({ id: RULE }),
      createMany: jest.fn().mockResolvedValue([{ id: RULE }]),
      update: jest.fn().mockResolvedValue({ id: RULE }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollDeductionsController],
      providers: [{ provide: PayrollDeductionsService, useValue: service }],
    }).compile();
    controller = module.get(PayrollDeductionsController);
  });

  it("takes the user id from the JWT on every route, never from the request", async () => {
    const dto = Object.assign(new CreatePayrollDeductionRuleDto(), {
      scheduledTransactionId: BILL,
      categoryId: CATEGORY,
      yearlyMaximum: 1077.48,
      resetDate: "2026-01-01",
    });
    await controller.findAll(req);
    await controller.history(req);
    await controller.suggest(req, BILL, CATEGORY);
    await controller.create(req, dto);
    const batch = Object.assign(new CreatePayrollDeductionRulesDto(), {
      scheduledTransactionId: BILL,
      resetDate: "2026-01-01",
      lines: [{ categoryId: CATEGORY, yearlyMaximum: 1077.48 }],
    });
    await controller.createMany(req, batch);
    await controller.update(req, RULE, { yearlyMaximum: 1100 });
    await controller.remove(req, RULE);

    expect(service.findAll).toHaveBeenCalledWith(USER);
    expect(service.history).toHaveBeenCalledWith(USER);
    expect(service.suggestExpected).toHaveBeenCalledWith(
      USER,
      BILL,
      CATEGORY,
      undefined,
    );
    await controller.suggest(req, BILL, CATEGORY, "2026-01-01");
    expect(service.suggestExpected).toHaveBeenLastCalledWith(
      USER,
      BILL,
      CATEGORY,
      "2026-01-01",
    );
    // Refused before the service is asked: the throw is synchronous.
    expect(() => controller.suggest(req, BILL, CATEGORY, "2026-02-30")).toThrow(
      BadRequestException,
    );
    expect(service.suggestExpected).toHaveBeenCalledTimes(2);
    expect(service.create).toHaveBeenCalledWith(USER, dto);
    expect(service.createMany).toHaveBeenCalledWith(USER, batch);
    expect(service.update).toHaveBeenCalledWith(USER, RULE, {
      yearlyMaximum: 1100,
    });
    expect(service.remove).toHaveBeenCalledWith(USER, RULE);
  });

  it("answers the service's view", async () => {
    await expect(
      controller.create(req, {} as CreatePayrollDeductionRuleDto),
    ).resolves.toEqual({ id: RULE });
    await expect(controller.suggest(req, BILL, CATEGORY)).resolves.toEqual({
      expectedPerPaycheque: 64,
      expectedSource: "line",
    });
  });

  it("deletes with 204, is guarded by the JWT and mounted at /payroll-deductions", () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        PayrollDeductionsController.prototype.remove,
      ),
    ).toBe(204);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PayrollDeductionsController),
    ).toHaveLength(1);
    expect(
      Reflect.getMetadata(PATH_METADATA, PayrollDeductionsController),
    ).toBe("payroll-deductions");
  });
});
