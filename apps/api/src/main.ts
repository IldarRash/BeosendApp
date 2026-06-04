import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@beosand/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  const productionOrigins =
    env.ADMIN_ALLOWED_ORIGINS.length > 0 ? env.ADMIN_ALLOWED_ORIGINS : false;

  app.enableCors({ origin: env.NODE_ENV === "production" ? productionOrigins : true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`BeoSand API listening on :${env.PORT}`);
}

void bootstrap();
