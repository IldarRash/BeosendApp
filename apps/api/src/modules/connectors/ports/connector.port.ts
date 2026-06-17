import type { ConnectorId } from "@beosand/types";

/**
 * A non-channel outbound connector (webhooks, calendar push, sheets/csv export).
 * Config-gated like NotificationChannel: an absent provider means `isEnabled()`
 * false (disabled, not an error). The ConnectorRegistry reports each one's status
 * for the admin settings screen. Concrete adapters land in Slices A/B/C.
 */
export interface OutboundConnector {
  /** Stable connector id surfaced in the registry status list. */
  readonly id: ConnectorId;
  /** True when the connector's required config is present. */
  isEnabled(): boolean;
}
