import { Response } from "express";
import { AiRelayController } from "./ai-relay.controller";
import { AiRelayService } from "./ai-relay.service";

function makeRes() {
  const events: Array<Record<string, unknown>> = [];
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    on: jest.fn(),
    writableEnded: false,
    end: jest.fn(),
    write: jest.fn((chunk: string) => {
      const line = chunk.toString();
      if (line.startsWith("data: ")) {
        events.push(JSON.parse(line.slice(6)));
      }
      return true;
    }),
  };
  return { res: res as unknown as Response, events };
}

describe("AiRelayController", () => {
  const req = { user: { id: "user-1" } };

  function build(relay: Partial<AiRelayService>) {
    return new AiRelayController(relay as AiRelayService);
  }

  it("streams the agent answer as a content event (not assistant_text) then done", async () => {
    const controller = build({
      enqueuePrompt: jest.fn().mockResolvedValue({ text: "buy index funds" }),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(req, { query: "what should I buy?" }, res);

    // The chat store only renders `content` -- assistant_text is ephemeral.
    expect(events).toEqual([
      { type: "content", text: "buy index funds" },
      { type: "done" },
    ]);
    expect(events.some((e) => e.type === "assistant_text")).toBe(false);
  });

  it("emits an error event when the relay times out", async () => {
    const controller = build({
      enqueuePrompt: jest.fn().mockRejectedValue(new Error("timed out")),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(req, { query: "hi" }, res);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(typeof events[0].message).toBe("string");
  });

  it("returns the relay tunnel status", () => {
    const getStatus = jest
      .fn()
      .mockReturnValue({ state: "listening", queued: 0 });
    const controller = build({ getStatus });
    expect(controller.status(req)).toEqual({ state: "listening", queued: 0 });
    expect(getStatus).toHaveBeenCalledWith("user-1");
  });
});
