import { Global, Module } from "@nestjs/common";
import { loadEnv } from "@beosand/config";

/** DI token for the validated environment contract. */
export const ENV = "ENV";

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV]
})
export class ConfigModule {}
