import {
  getRequestContext,
  getRequestTimezone,
  requestContextStorage,
} from "./request-context";

describe("request-context", () => {
  describe("when no context is active", () => {
    it("getRequestContext returns undefined", () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it("getRequestTimezone returns undefined", () => {
      expect(getRequestTimezone()).toBeUndefined();
    });
  });

  describe("inside a context store", () => {
    it("getRequestContext returns the active store", () => {
      requestContextStorage.run(
        { userId: "u-1", timezone: "America/Toronto" },
        () => {
          expect(getRequestContext()).toEqual({
            userId: "u-1",
            timezone: "America/Toronto",
          });
        },
      );
    });

    it("getRequestTimezone returns the timezone when set", () => {
      requestContextStorage.run({ timezone: "Europe/London" }, () => {
        expect(getRequestTimezone()).toBe("Europe/London");
      });
    });

    it("getRequestTimezone returns undefined when timezone is not set", () => {
      requestContextStorage.run({ userId: "u-2" }, () => {
        expect(getRequestTimezone()).toBeUndefined();
      });
    });
  });
});
