import { Injectable, Logger, Optional } from "@nestjs/common";
import { EmailChannel } from "./email.channel";
import { SmsChannel } from "./sms.channel";
import { TelegramChannel } from "./telegram.channel";
import type { NotificationChannel, OutboundMessage } from "../ports/channel.port";

/** What one channel attempt resulted in (for the caller's idempotency logging). */
export interface ChannelDispatchResult {
  channelId: NotificationChannel["id"];
  /** True when the channel sent successfully; false when it threw (tolerated). */
  delivered: boolean;
}

/**
 * Fans one OutboundMessage out to every ENABLED channel the recipient can be reached
 * on (connectors §3.3). Channel fan-out policy (§10.5): a message goes to telegram +
 * email + sms whenever each target is present — so a walk-in with only a phone still
 * gets reached. A disabled channel (absent provider config) is skipped silently; one
 * channel throwing is logged and tolerated so it never blocks the others or the
 * committed domain op (mirrors the existing notifier tolerance). Never logs a token
 * or secret — only the channel id and a short status.
 *
 * Slice B registers EmailChannel + SmsChannel alongside TelegramChannel, so a
 * recipient is reached on every channel its targets cover (telegram id → telegram,
 * email → email, phone → sms). Each adapter is config-gated and individually
 * skipped when disabled; the telegram path is unchanged when email/sms are absent.
 * Email/sms are optional constructor args so existing tests can build a
 * telegram-only dispatcher; DI supplies all three.
 */
@Injectable()
export class ChannelDispatcher {
  private readonly logger = new Logger(ChannelDispatcher.name);
  private readonly channels: NotificationChannel[];

  constructor(
    telegram: TelegramChannel,
    @Optional() email?: EmailChannel,
    @Optional() sms?: SmsChannel
  ) {
    // The channel registry: every configured channel a recipient can be reached on.
    // email/sms are optional so existing tests can build a telegram-only dispatcher;
    // DI (Slice B) supplies all three.
    const candidates: (NotificationChannel | undefined)[] = [telegram, email, sms];
    this.channels = candidates.filter(
      (channel): channel is NotificationChannel => channel !== undefined
    );
  }

  /**
   * Deliver `msg` to each enabled, reachable channel. Returns a per-channel result so
   * the caller (NotificationsService) can record the send in its idempotency log.
   * `skip` lists channels already logged for this (client, training, type) so a
   * resend never re-delivers a channel that already succeeded (per-channel
   * idempotency). Never throws: a per-adapter failure is caught, logged, and
   * reported as `delivered: false`.
   */
  async dispatch(
    msg: OutboundMessage,
    skip: ReadonlySet<NotificationChannel["id"]> = new Set()
  ): Promise<ChannelDispatchResult[]> {
    const results: ChannelDispatchResult[] = [];
    for (const channel of this.channels) {
      if (skip.has(channel.id)) {
        continue;
      }
      if (!channel.isEnabled()) {
        this.logger.debug(`Channel ${channel.id} disabled; skipping (client ${msg.clientId})`);
        continue;
      }
      if (!channel.canReach(msg)) {
        continue;
      }
      try {
        await channel.send(msg);
        results.push({ channelId: channel.id, delivered: true });
      } catch (error) {
        // One channel failing must never stop the others or undo the committed op.
        this.logger.error(
          `Channel ${channel.id} send to client ${msg.clientId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
        results.push({ channelId: channel.id, delivered: false });
      }
    }
    return results;
  }

  /** The registered channel ids (for the registry status / boot log). */
  channelIds(): NotificationChannel["id"][] {
    return this.channels.map((channel) => channel.id);
  }

  /** Look up one registered channel by id (for the admin test-send, Slice B). */
  channel(id: NotificationChannel["id"]): NotificationChannel | undefined {
    return this.channels.find((channel) => channel.id === id);
  }
}
