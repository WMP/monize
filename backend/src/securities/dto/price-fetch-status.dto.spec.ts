import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateSecurityDto } from "./create-security.dto";
import { UpdateSecurityDto } from "./update-security.dto";

/**
 * `auto_disabled` is a conclusion the system reaches after a run of provider
 * "no such symbol" answers, never an instruction a client may send. The DTO
 * admits only the two user-settable states; widening it would let a client
 * park a security in a state that is then re-probed and silently re-enabled.
 */
function create(partial: Record<string, unknown> = {}): CreateSecurityDto {
  return plainToInstance(CreateSecurityDto, {
    symbol: "AAPL",
    name: "Apple Inc.",
    currencyCode: "USD",
    ...partial,
  });
}

async function failures(instance: object): Promise<string[]> {
  const errors = await validate(instance);
  return errors.map((error) => error.property).sort();
}

describe("priceFetchStatus on the security DTOs", () => {
  it.each([["active"], ["disabled"]])(
    "accepts the user-settable state %s",
    async (status) => {
      expect(await failures(create({ priceFetchStatus: status }))).toEqual([]);
      expect(
        await failures(
          plainToInstance(UpdateSecurityDto, { priceFetchStatus: status }),
        ),
      ).toEqual([]);
    },
  );

  it("rejects auto_disabled, which only the system may set", async () => {
    expect(
      await failures(create({ priceFetchStatus: "auto_disabled" })),
    ).toEqual(["priceFetchStatus"]);
    expect(
      await failures(
        plainToInstance(UpdateSecurityDto, {
          priceFetchStatus: "auto_disabled",
        }),
      ),
    ).toEqual(["priceFetchStatus"]);
  });

  it("rejects an unknown state", async () => {
    expect(await failures(create({ priceFetchStatus: "paused" }))).toEqual([
      "priceFetchStatus",
    ]);
  });

  it("is optional", async () => {
    expect(await failures(create())).toEqual([]);
  });
});
