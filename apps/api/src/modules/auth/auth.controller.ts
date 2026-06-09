import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  type AdminMe,
  type AdminSession,
  type MiniappSession,
  miniappAuthSchema,
  telegramLoginPayloadSchema
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { AuthService } from "./auth.service";

/** Thin: parse + Zod-validate the boundary, call one service method. */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Exchange a verified Telegram Login Widget payload for an admin session. */
  @Post("telegram")
  loginWithTelegram(@Body() body: unknown): Promise<AdminSession> {
    const payload = validate(telegramLoginPayloadSchema, body ?? {});
    return this.auth.loginWithTelegram(payload);
  }

  /** Exchange a verified Telegram Mini App initData string for a client session. */
  @Post("miniapp")
  loginWithMiniapp(@Body() body: unknown): Promise<MiniappSession> {
    const { initData } = validate(miniappAuthSchema, body ?? {});
    return this.auth.loginWithMiniapp(initData);
  }

  /** Return the admin identity for the bearer session ("logged in as"). */
  @Get("me")
  me(@Headers("authorization") authorization: string | undefined): AdminMe {
    return this.auth.resolveSession(extractBearerToken(authorization));
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new UnauthorizedException("Malformed Authorization header");
  }
  return token;
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
