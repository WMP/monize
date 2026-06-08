import { Module } from "@nestjs/common";
import * as path from "path";
import {
  I18nModule as NestjsI18nModule,
  AcceptLanguageResolver,
  CookieResolver,
  HeaderResolver,
  QueryResolver,
} from "nestjs-i18n";
import { DEFAULT_LOCALE } from "./config";

/**
 * Centralised translation catalogues for backend strings (exception messages,
 * email subjects/bodies, MCP-irrelevant prompts). Add a new locale by creating
 * a sibling folder under `src/i18n/locales/` and copying the JSON files.
 *
 * Resolution order (first match wins):
 *   1. `?lang=<code>` query parameter (developer override)
 *   2. `x-locale` request header (set by the frontend proxy)
 *   3. `NEXT_LOCALE` cookie (the shared frontend/backend locale cookie)
 *   4. `Accept-Language` header
 *   5. Fallback to DEFAULT_LOCALE
 *
 * The path is computed relative to this file so it resolves correctly under
 * both ts-node (dev) and the compiled `dist/` build (production).
 */
@Module({
  imports: [
    NestjsI18nModule.forRoot({
      fallbackLanguage: DEFAULT_LOCALE,
      loaderOptions: {
        path: path.join(__dirname, "locales"),
        watch: process.env.NODE_ENV !== "production",
      },
      resolvers: [
        { use: QueryResolver, options: ["lang"] },
        new HeaderResolver(["x-locale"]),
        new CookieResolver(["NEXT_LOCALE"]),
        AcceptLanguageResolver,
      ],
      typesOutputPath: undefined,
    }),
  ],
  exports: [NestjsI18nModule],
})
export class I18nModule {}
