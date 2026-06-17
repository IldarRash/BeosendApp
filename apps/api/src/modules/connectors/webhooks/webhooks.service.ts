import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  CreatedWebhookEndpoint,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookEndpoint
} from "@beosand/types";
import { ENV } from "../../../config/config.module";
import {
  type EndpointWithSecret,
  WebhookEndpointsRepository
} from "./webhook-endpoints.repository";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

/**
 * Admin-only webhook CRUD + delivery operations (connectors §6/§7). Every method is
 * gated by the current admin set (like ManagersService). The generated endpoint secret
 * is returned EXACTLY ONCE from `create`; list/get map to the `secret`-less entity so a
 * read response can never leak it. The repository keeps the secret for signing only.
 */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly endpoints: WebhookEndpointsRepository,
    private readonly deliveries: WebhookDeliveriesRepository,
    private readonly dispatcher: WebhookDispatcher
  ) {}

  /** Admin-only: create an endpoint; the returned secret is shown to the admin once. */
  async create(
    actorTelegramId: number,
    input: CreateWebhookEndpointInput
  ): Promise<CreatedWebhookEndpoint> {
    this.assertAdmin(actorTelegramId);
    const created = await this.endpoints.create({
      url: input.url,
      events: input.events,
      createdBy: actorTelegramId
    });
    // The ONE place the secret crosses the API boundary (creation response only).
    return { ...toEntity(created), secret: created.secret };
  }

  /** Admin-only: every endpoint, secret omitted. */
  async list(actorTelegramId: number): Promise<WebhookEndpoint[]> {
    this.assertAdmin(actorTelegramId);
    const rows = await this.endpoints.findAll();
    return rows.map(toEntity);
  }

  /** Admin-only: one endpoint, secret omitted. */
  async get(actorTelegramId: number, id: string): Promise<WebhookEndpoint> {
    this.assertAdmin(actorTelegramId);
    const row = await this.endpoints.findById(id);
    if (!row) {
      throw new NotFoundException("Webhook endpoint not found");
    }
    return toEntity(row);
  }

  /** Admin-only: patch events/status; secret omitted from the response. */
  async update(
    actorTelegramId: number,
    id: string,
    patch: UpdateWebhookEndpointInput
  ): Promise<WebhookEndpoint> {
    this.assertAdmin(actorTelegramId);
    const row = await this.endpoints.updateById(id, patch);
    if (!row) {
      throw new NotFoundException("Webhook endpoint not found");
    }
    return toEntity(row);
  }

  /** Admin-only: the per-endpoint delivery log (newest first). */
  async listDeliveries(actorTelegramId: number, endpointId: string): Promise<WebhookDelivery[]> {
    this.assertAdmin(actorTelegramId);
    // Surface a 404 for an unknown endpoint rather than an empty list for a typo'd id.
    const endpoint = await this.endpoints.findById(endpointId);
    if (!endpoint) {
      throw new NotFoundException("Webhook endpoint not found");
    }
    return this.deliveries.findByEndpoint(endpointId);
  }

  /**
   * Admin-only: force an immediate re-POST of one delivery (regardless of its
   * scheduled `nextAttemptAt`). Loads the delivery + its endpoint and runs the shared
   * dispatcher attempt; returns the refreshed delivery row.
   */
  async retryDelivery(actorTelegramId: number, deliveryId: string): Promise<WebhookDelivery> {
    this.assertAdmin(actorTelegramId);
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException("Webhook delivery not found");
    }
    const endpoint = await this.endpoints.findById(delivery.endpointId);
    if (!endpoint) {
      throw new NotFoundException("Webhook endpoint not found");
    }
    await this.dispatcher.attempt(endpoint, delivery);
    const refreshed = await this.deliveries.findById(deliveryId);
    if (!refreshed) {
      throw new NotFoundException("Webhook delivery not found");
    }
    return refreshed;
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** Map the secret-bearing repo row to the `secret`-less entity contract. */
function toEntity(row: EndpointWithSecret): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    status: row.status,
    createdAt: row.createdAt,
    createdBy: row.createdBy
  };
}
