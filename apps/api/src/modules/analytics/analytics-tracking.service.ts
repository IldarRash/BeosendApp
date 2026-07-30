import { Injectable } from "@nestjs/common";
import type { AnalyticsEntryPoint } from "@beosand/types";
import { AnalyticsTrackingRepository } from "./analytics-tracking.repository";

const TRAINING_DESTINATIONS = new Set(["browse", "schedule", "calendar", "group", "individual"]);
const SAFE_TOKEN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Converts a verified Telegram start parameter into a bounded, non-identifying
 * attribution bucket. Supported campaign links use
 * `<destination>__<source>__<campaign>`; existing plain destination links remain
 * valid and are attributed to Telegram without a campaign.
 */
@Injectable()
export class AnalyticsTrackingService {
  constructor(private readonly repository: AnalyticsTrackingRepository) {}

  async recordLaunch(rawStartParam: string | undefined): Promise<string> {
    return this.repository.createSession(normalizeStartParam(rawStartParam));
  }
}

export function normalizeStartParam(
  rawStartParam: string | undefined
): {
  entryPoint: AnalyticsEntryPoint;
  source: string;
  campaign: string | null;
} {
  const raw = rawStartParam?.trim().toLowerCase();
  if (!raw) {
    return { entryPoint: "direct", source: "direct", campaign: null };
  }

  const [destinationRaw, sourceRaw, campaignRaw] = raw.split("__", 3);
  const destination = safeToken(destinationRaw) ?? "other";
  const entryPoint = classifyEntryPoint(destination);
  const source = safeToken(sourceRaw) ?? "telegram";
  const campaign = safeToken(campaignRaw);

  return { entryPoint, source, campaign };
}

function classifyEntryPoint(destination: string): AnalyticsEntryPoint {
  if (destination === "court") return "court";
  if (TRAINING_DESTINATIONS.has(destination)) return "training";
  if (destination === "home" || destination === "direct") return "direct";
  return "other";
}

function safeToken(value: string | undefined): string | null {
  return value && SAFE_TOKEN.test(value) ? value : null;
}
