import type { MyBookingItem, WaitlistAdminItem } from "@beosand/types";

/**
 * One monthly-subscription group on the Upcoming tab: the booked dates AND the
 * waitlisted dates that share a `groupSubscriptionId`, so a subscription renders as a
 * single card showing both. The Mini App does no date/queue math — it only buckets the
 * rows the server returned by their server-assigned subscription id.
 */
export interface SubscriptionGroup {
  groupSubscriptionId: string;
  bookings: MyBookingItem[];
  waitlisted: WaitlistAdminItem[];
}

/**
 * The Upcoming list, partitioned for rendering. `subscriptions` are the monthly
 * batches (booked + waitlisted dates sharing a `groupSubscriptionId`); `standalone`
 * are single bookings with a null subscription id; `standaloneWaitlist` are queue
 * entries not tied to any subscription (the booking-race single-training path).
 *
 * Pure presentation grouping with no domain math: the server owns the queue position,
 * status, and which dates exist; this only buckets the returned rows. Booking order is
 * preserved (the API's sort); subscription groups appear in first-seen order.
 */
export interface UpcomingPartition {
  subscriptions: SubscriptionGroup[];
  standalone: MyBookingItem[];
  standaloneWaitlist: WaitlistAdminItem[];
}

export function partitionUpcoming(
  bookings: ReadonlyArray<MyBookingItem>,
  waitlist: ReadonlyArray<WaitlistAdminItem>
): UpcomingPartition {
  const groups = new Map<string, SubscriptionGroup>();
  const order: string[] = [];
  const standalone: MyBookingItem[] = [];

  const ensureGroup = (id: string): SubscriptionGroup => {
    const existing = groups.get(id);
    if (existing) {
      return existing;
    }
    const created: SubscriptionGroup = { groupSubscriptionId: id, bookings: [], waitlisted: [] };
    groups.set(id, created);
    order.push(id);
    return created;
  };

  for (const booking of bookings) {
    if (booking.groupSubscriptionId == null) {
      standalone.push(booking);
    } else {
      ensureGroup(booking.groupSubscriptionId).bookings.push(booking);
    }
  }

  const standaloneWaitlist: WaitlistAdminItem[] = [];
  for (const entry of waitlist) {
    if (entry.groupSubscriptionId == null) {
      standaloneWaitlist.push(entry);
    } else {
      // A subscription's waitlisted date attaches to its group even if no booked
      // sibling is in this scope yet (every full date queued at purchase).
      ensureGroup(entry.groupSubscriptionId).waitlisted.push(entry);
    }
  }

  return {
    subscriptions: order.map((id) => groups.get(id)!),
    standalone,
    standaloneWaitlist
  };
}
