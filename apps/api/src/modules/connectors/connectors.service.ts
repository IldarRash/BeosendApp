import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  ConnectorStatus,
  NotificationChannelId,
  TestSendInput,
  TestSendResult
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { ChannelDispatcher } from "./channels/channel-dispatcher.service";
import { ConnectorRegistry } from "./connector-registry.service";
import type { OutboundMessage } from "./ports/channel.port";

/** Fixed body for the admin test-send (RU; v1 templates are RU-only). */
const TEST_SEND_TEXT = "BeoSand: тестовое сообщение. Канал работает.";

/**
 * Admin-facing connector operations: the status list for the settings screen and the
 * per-channel test-send. All reads/writes are admin-only (gated by the current admin
 * set, like ManagersService). The test-send routes a fixed message through one chosen
 * notification channel so an operator can verify provider creds end-to-end without a
 * real domain event; a provider failure surfaces as `ok:false` (never a 500), and
 * secrets are never logged or echoed.
 */
@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly dispatcher: ChannelDispatcher,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Admin-only: every connector's id + enabled/configured state. */
  status(actorTelegramId: number): ConnectorStatus[] {
    this.assertAdmin(actorTelegramId);
    return this.registry.status();
  }

  /**
   * Admin-only: send a fixed test message over `channel` to `to`. The target is placed
   * on the channel's matching field (telegramId/email/phone) so the same adapter path a
   * domain notification uses is exercised. Rejects an unregistered or disabled channel
   * up front; a real send failure is caught and returned as `ok:false`.
   */
  async testSend(actorTelegramId: number, input: TestSendInput): Promise<TestSendResult> {
    this.assertAdmin(actorTelegramId);
    const channel = this.dispatcher.channel(input.channel);
    if (!channel) {
      throw new BadRequestException(`Channel ${input.channel} is not registered`);
    }
    if (!channel.isEnabled()) {
      throw new BadRequestException(`Channel ${input.channel} is not configured`);
    }
    const message = this.buildTestMessage(input.channel, input.to);
    if (!channel.canReach(message)) {
      throw new BadRequestException(`Invalid target for channel ${input.channel}`);
    }
    try {
      await channel.send(message);
      return { ok: true, channel: input.channel };
    } catch (error) {
      // Never echo provider creds: log only the channel id and a short message.
      this.logger.error(
        `Test-send on ${input.channel} failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return { ok: false, channel: input.channel };
    }
  }

  /** Place `to` on the channel's matching target field. */
  private buildTestMessage(channel: NotificationChannelId, to: string): OutboundMessage {
    const base: OutboundMessage = {
      clientId: "test-send",
      subject: "BeoSand",
      text: TEST_SEND_TEXT,
      telegramId: null,
      email: null,
      phone: null
    };
    switch (channel) {
      case "telegram": {
        const telegramId = Number(to);
        if (!Number.isInteger(telegramId)) {
          throw new BadRequestException("Telegram target must be a numeric chat id");
        }
        return { ...base, telegramId };
      }
      case "email":
        return { ...base, email: to };
      case "sms":
        return { ...base, phone: to };
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
