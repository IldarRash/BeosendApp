import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@beosand/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  // Both the admin console and the Mini App are browser clients; merge their
  // allow-lists into one CORS origin set for production.
  const allowedOrigins = [...env.ADMIN_ALLOWED_ORIGINS, ...env.MINIAPP_ALLOWED_ORIGINS];
  const productionOrigins = allowedOrigins.length > 0 ? allowedOrigins : false;

  app.enableCors({ origin: env.NODE_ENV === "production" ? productionOrigins : true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`BeoSand API listening on :${env.PORT}`);
}

void bootstrap();
