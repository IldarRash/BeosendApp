import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@beosand/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  // Let the admin SPA (and future web clients) call the API from the browser.
  // Dev: open. Production origin allowlisting + auth ships with the admin-auth feature;
  // until then we fail closed (no browser origin allowed in production).
  app.enableCors({ origin: env.NODE_ENV === "production" ? false : true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`BeoSand API listening on :${env.PORT}`);
}

void bootstrap();
