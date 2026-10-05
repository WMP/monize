// Jest `moduleNameMapper` stand-in for `@nestjs/typeorm/dist/common/typeorm-compat.js`.
// @nestjs/typeorm 12 is pure ESM and that one file builds a `require` from
// `import.meta.url`, which ts-jest cannot compile to CommonJS, so every spec
// that loads the package failed to run. The original resolves the two legacy
// TypeORM 0.3 exports lazily so the package also works on TypeORM 1; this
// project is on 0.3, where both exist, so re-exporting them is equivalent.
export { Connection, AbstractRepository } from "typeorm";
