import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ExchangeRateService } from "./exchange-rate.service";
import { ExchangeRateHistoryService } from "./exchange-rate-history.service";
import { CurrenciesService } from "./currencies.service";
import { CurrenciesController } from "./currencies.controller";
import { SecuritiesModule } from "../securities/securities.module";
import { ProviderHealthModule } from "../provider-health/provider-health.module";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { FxProviderChain } from "./providers/fx-provider-chain";
import { resolveFxProviders } from "./providers/fx-provider.config";
import {
  FxProviderName,
  FxRateProvider,
} from "./providers/fx-provider.interface";
import { YahooFxProvider } from "./providers/yahoo-fx.provider";
import {
  FrankfurterFxProvider,
  resolveFrankfurterBaseUrl,
} from "./providers/frankfurter-fx.provider";

/**
 * Currencies and exchange rates. Rates come from an ordered chain of providers
 * built once here from `FX_PROVIDERS` (default `yahoo`): the factory resolves
 * the names, maps each to its adapter and hands the ordered list to
 * `FxProviderChain`, the one door every provider question goes through
 * (INV-FX-005). An unknown name throws `FxProviderConfigError` and the
 * application does not start, naming the valid names, rather than running on a
 * list the operator did not write (`docs/specs/exchange-rate-providers.md`,
 * decision 11). The `Record` is typed over `FxProviderName`, so a name added to
 * `FX_PROVIDER_NAMES` without an adapter here fails to compile.
 *
 * The Frankfurter adapter is built here too, from `FX_FRANKFURTER_BASE_URL`
 * and the breaker (`ProviderHealthModule`); nothing calls it until an operator
 * lists `frankfurter` in `FX_PROVIDERS`.
 */
@Module({
  imports: [
    ConfigModule,
    ProviderHealthModule,
    forwardRef(() => SecuritiesModule),
  ],
  providers: [
    ExchangeRateService,
    ExchangeRateHistoryService,
    CurrenciesService,
    YahooFxProvider,
    {
      provide: FrankfurterFxProvider,
      useFactory: (
        configService: ConfigService,
        health: ProviderHealthService,
      ) =>
        new FrankfurterFxProvider(
          health,
          resolveFrankfurterBaseUrl(
            configService.get<string>("FX_FRANKFURTER_BASE_URL"),
          ),
        ),
      inject: [ConfigService, ProviderHealthService],
    },
    {
      provide: FxProviderChain,
      useFactory: (
        configService: ConfigService,
        yahoo: YahooFxProvider,
        frankfurter: FrankfurterFxProvider,
      ) => {
        const byName: Record<FxProviderName, FxRateProvider> = {
          frankfurter,
          yahoo,
        };
        const names = resolveFxProviders(
          configService.get<string>("FX_PROVIDERS"),
        );
        return new FxProviderChain(names.map((name) => byName[name]));
      },
      inject: [ConfigService, YahooFxProvider, FrankfurterFxProvider],
    },
  ],
  controllers: [CurrenciesController],
  exports: [
    ExchangeRateService,
    ExchangeRateHistoryService,
    CurrenciesService,
    FxProviderChain,
  ],
})
export class CurrenciesModule {}
