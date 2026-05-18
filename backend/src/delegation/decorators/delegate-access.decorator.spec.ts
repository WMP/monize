import { Reflector } from "@nestjs/core";
import {
  AllowDelegate,
  DelegatedAccountParam,
  ALLOW_DELEGATE_KEY,
  DELEGATED_ACCOUNT_PARAM_KEY,
} from "./delegate-access.decorator";

describe("delegate-access decorators", () => {
  const reflector = new Reflector();

  it("AllowDelegate sets the allow-delegate metadata", () => {
    class C {
      @AllowDelegate()
      handler() {}
    }
    expect(reflector.get(ALLOW_DELEGATE_KEY, C.prototype.handler)).toBe(true);
  });

  it("DelegatedAccountParam defaults to 'id'", () => {
    class C {
      @DelegatedAccountParam()
      handler() {}
    }
    expect(
      reflector.get(DELEGATED_ACCOUNT_PARAM_KEY, C.prototype.handler),
    ).toBe("id");
  });

  it("DelegatedAccountParam accepts a custom key", () => {
    class C {
      @DelegatedAccountParam("accountId")
      handler() {}
    }
    expect(
      reflector.get(DELEGATED_ACCOUNT_PARAM_KEY, C.prototype.handler),
    ).toBe("accountId");
  });
});
