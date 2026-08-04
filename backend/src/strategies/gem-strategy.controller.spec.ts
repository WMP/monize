import { ArgumentMetadata, ParseUUIDPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { GemStrategyController } from "./gem-strategy.controller";
import { GemStrategyService } from "./gem-strategy.service";
import { GemStrategyReportView } from "./gem-report.types";

describe("GemStrategyController", () => {
  let controller: GemStrategyController;
  let service: Record<string, jest.Mock>;

  const req = { user: { id: "user-1" } };
  const report = { warnings: [] } as unknown as GemStrategyReportView;

  beforeEach(async () => {
    service = {
      getReport: jest.fn().mockResolvedValue(report),
      updateConfig: jest.fn().mockResolvedValue(report),
      createStrategy: jest.fn().mockResolvedValue(report),
      removeStrategy: jest.fn().mockResolvedValue(report),
      markExecuted: jest.fn().mockResolvedValue(report),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GemStrategyController],
      providers: [{ provide: GemStrategyService, useValue: service }],
    }).compile();

    controller = module.get<GemStrategyController>(GemStrategyController);
  });

  it("reads the report for the authenticated user", async () => {
    await expect(controller.getReport(req, { range: "3Y" })).resolves.toBe(
      report,
    );
    expect(service.getReport).toHaveBeenCalledWith("user-1", "3Y", undefined);
  });

  it("defaults the chart range to one year", async () => {
    await controller.getReport(req, {});
    expect(service.getReport).toHaveBeenCalledWith("user-1", "1Y", undefined);
  });

  it("updates the configuration for the authenticated user", async () => {
    const dto = { cadence: "QUARTERLY" as const };
    await controller.updateConfig(req, dto, {});
    expect(service.updateConfig).toHaveBeenCalledWith(
      "user-1",
      dto,
      "1Y",
      undefined,
    );
  });

  it("marks a signal executed and passes the range on", async () => {
    await controller.markExecuted(req, "sig-1", { range: "6M" });
    expect(service.markExecuted).toHaveBeenCalledWith(
      "user-1",
      "sig-1",
      "6M",
      undefined,
    );
  });

  it("creates a scenario from the posted name", async () => {
    await expect(
      controller.createStrategy(req, { name: "Aggressive" }, { range: "6M" }),
    ).resolves.toBe(report);
    // The name comes from the body, the user from the token, and the range
    // decides which performance series the new scenario's report carries.
    expect(service.createStrategy).toHaveBeenCalledWith(
      "user-1",
      "Aggressive",
      "6M",
    );
  });

  it("defaults the new scenario's range to one year", async () => {
    await controller.createStrategy(req, { name: "Aggressive" }, {});
    expect(service.createStrategy).toHaveBeenCalledWith(
      "user-1",
      "Aggressive",
      "1Y",
    );
  });

  it("deletes the scenario named in the path", async () => {
    await expect(
      controller.removeStrategy(req, "strategy-1", { range: "MAX" }),
    ).resolves.toBe(report);
    expect(service.removeStrategy).toHaveBeenCalledWith(
      "user-1",
      "strategy-1",
      "MAX",
    );
  });

  it("defaults the range after a delete to one year", async () => {
    await controller.removeStrategy(req, "strategy-1", {});
    expect(service.removeStrategy).toHaveBeenCalledWith(
      "user-1",
      "strategy-1",
      "1Y",
    );
  });

  describe("the deleted scenario's id has to be a uuid", () => {
    /**
     * The pipe is declared on the parameter, so calling the method directly
     * never runs it -- `removeStrategy(req, "not-a-uuid", {})` above reaches the
     * service happily. The wiring is asserted through the pipe itself, against
     * the metadata Nest would hand it.
     */
    const pipe = new ParseUUIDPipe();
    const metadata: ArgumentMetadata = {
      type: "param",
      data: "id",
      metatype: String,
    };

    it("passes a uuid through", async () => {
      const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
      await expect(pipe.transform(id, metadata)).resolves.toBe(id);
    });

    it("refuses anything else", async () => {
      await expect(pipe.transform("strategy-1", metadata)).rejects.toThrow();
    });

    it("is the pipe the route declares", () => {
      const parameterPipes = Reflect.getMetadata(
        "__routeArguments__",
        GemStrategyController,
        "removeStrategy",
      ) as Record<string, { pipes?: unknown[] }> | undefined;
      const declared = Object.values(parameterPipes ?? {}).flatMap(
        (argument) => argument.pipes ?? [],
      );
      expect(
        declared.some(
          (declaredPipe) =>
            declaredPipe === ParseUUIDPipe ||
            declaredPipe instanceof ParseUUIDPipe,
        ),
      ).toBe(true);
    });
  });

  it("never takes the user id from the request payload", async () => {
    await controller.getReport({ user: { id: "user-2" } }, {});
    expect(service.getReport).toHaveBeenCalledWith("user-2", "1Y", undefined);
  });
});
