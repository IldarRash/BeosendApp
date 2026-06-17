import type { DomainEventType, NotificationChannelId } from "@beosand/types";

/**
 * A message to deliver to one recipient over the channels they can be reached on.
 * Built by the domain services / NotificationsService and fanned out by the
 * ChannelDispatcher. Channel targets are all optional: a recipient is reachable on
 * a channel only when its target is present (telegram for a Telegram client, email
 * for an email, sms for a phone). `text` is the rendered, RU body; `subject` is used
 * by channels that have one (email). `eventType` is informational (logging/idempotency).
 */
export interface OutboundMessage {
  /** The client this message is for (for the delivery log / idempotency key). */
  clientId: string;
  /** Telegram chat id, when the recipient has a Telegram account. */
  telegramId?: number | null;
  /** Email address, when the recipient has one (walk-ins may). */
  email?: string | null;
  /** Phone number, when the recipient has one (walk-ins may). */
  phone?: string | null;
  /** Optional subject line (used by channels that support one, e.g. email). */
  subject?: string;
  /** Rendered message body (RU). Channels send this verbatim. */
  text: string;
  /** The domain event that produced this message; informational. */
  eventType?: DomainEventType;
}

/**
 * A notification channel adapter (telegram / email / sms). Config-gated: a channel
 * with absent provider creds reports `isEnabled() === false` and is skipped silently
 * at dispatch. `send` throws on failure — the dispatcher tolerates per-adapter
 * failures so one unreachable channel never blocks the others or the committed op.
 */
export interface NotificationChannel {
  /** Stable channel id; matches the recipient target it reads from. */
  readonly id: NotificationChannelId;
  /** True when the channel's required config is present (else disabled, skipped). */
  isEnabled(): boolean;
  /**
   * True when this recipient can be reached on this channel (the matching target is
   * present on the message). Lets the dispatcher fan out only to viable channels.
   */
  canReach(msg: OutboundMessage): boolean;
  /** Deliver the message; throws on failure (dispatcher logs and tolerates). */
  send(msg: OutboundMessage): Promise<void>;
}
