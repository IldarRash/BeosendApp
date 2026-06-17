import { describe, expect, it, vi } from "vitest";
import { ChannelDispatcher } from "./channel-dispatcher.service";
import type { EmailChannel } from "./email.channel";
import type { SmsChannel } from "./sms.channel";
import type { TelegramChannel } from "./telegram.channel";
import type { OutboundMessage } from "../ports/channel.port";

/** A stub TelegramChannel with controllable enabled/reach/send behavior. */
function makeTelegram(over: {
  enabled?: boolean;
  send?: ReturnType<typeof vi.fn>;
}): TelegramChannel {
  return {
    id: "telegram",
    isEnabled: () => over.enabled ?? true,
    canReach: (msg: OutboundMessage) => typeof msg.telegramId === "number",
    send: over.send ?? vi.fn().mockResolvedValue(undefined)
  } as unknown as TelegramChannel;
}

/** A stub EmailChannel reaching any message with an email. */
function makeEmail(over: { enabled?: boolean; send?: ReturnType<typeof vi.fn> }): EmailChannel {
  return {
    id: "email",
    isEnabled: () => over.enabled ?? true,
    canReach: (msg: OutboundMessage) => typeof msg.email === "string" && msg.email.length > 0,
    send: over.send ?? vi.fn().mockResolvedValue(undefined)
  } as unknown as EmailChannel;
}

/** A stub SmsChannel reaching any message with a phone. */
function makeSms(over: { enabled?: boolean; send?: ReturnType<typeof vi.fn> }): SmsChannel {
  return {
    id: "sms",
    isEnabled: () => over.enabled ?? true,
    canReach: (msg: OutboundMessage) => typeof msg.phone === "string" && msg.phone.length > 0,
    send: over.send ?? vi.fn().mockResolvedValue(undefined)
  } as unknown as SmsChannel;
}

const baseMsg: OutboundMessage = { clientId: "c1", telegramId: 555, text: "hi" };

describe("ChannelDispatcher", () => {
  it("delivers to the enabled, reachable telegram channel and reports delivered", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ChannelDispatcher(makeTelegram({ send }));

    const results = await dispatcher.dispatch(baseMsg);

    expect(send).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ channelId: "telegram", delivered: true }]);
  });

  it("skips a disabled channel silently (no send, no result, no throw)", async () => {
    const send = vi.fn();
    const dispatcher = new ChannelDispatcher(makeTelegram({ enabled: false, send }));

    const results = await dispatcher.dispatch(baseMsg);

    expect(send).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("skips a recipient the channel cannot reach (no telegram id)", async () => {
    const send = vi.fn();
    const dispatcher = new ChannelDispatcher(makeTelegram({ send }));

    const results = await dispatcher.dispatch({ clientId: "c1", telegramId: null, text: "hi" });

    expect(send).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("tolerates a send failure: reports delivered:false and never throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("telegram down"));
    const dispatcher = new ChannelDispatcher(makeTelegram({ send }));

    await expect(dispatcher.dispatch(baseMsg)).resolves.toEqual([
      { channelId: "telegram", delivered: false }
    ]);
  });

  it("fans out to telegram + email + sms when all three targets are present (Slice B)", async () => {
    const telegram = vi.fn().mockResolvedValue(undefined);
    const email = vi.fn().mockResolvedValue(undefined);
    const sms = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ChannelDispatcher(
      makeTelegram({ send: telegram }),
      makeEmail({ send: email }),
      makeSms({ send: sms })
    );

    const results = await dispatcher.dispatch({
      clientId: "c1",
      telegramId: 555,
      email: "a@example.com",
      phone: "+381600000000",
      text: "hi"
    });

    expect(telegram).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { channelId: "telegram", delivered: true },
      { channelId: "email", delivered: true },
      { channelId: "sms", delivered: true }
    ]);
  });

  it("a walk-in with only a phone is reached on SMS only", async () => {
    const telegram = vi.fn();
    const email = vi.fn();
    const sms = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ChannelDispatcher(
      makeTelegram({ send: telegram }),
      makeEmail({ send: email }),
      makeSms({ send: sms })
    );

    const results = await dispatcher.dispatch({ clientId: "c1", phone: "+381600000000", text: "hi" });

    expect(telegram).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
    expect(sms).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ channelId: "sms", delivered: true }]);
  });

  it("skips a disabled email channel but still delivers the others", async () => {
    const telegram = vi.fn().mockResolvedValue(undefined);
    const email = vi.fn();
    const dispatcher = new ChannelDispatcher(
      makeTelegram({ send: telegram }),
      makeEmail({ enabled: false, send: email }),
      makeSms({})
    );

    const results = await dispatcher.dispatch({
      clientId: "c1",
      telegramId: 555,
      email: "a@example.com",
      text: "hi"
    });

    expect(email).not.toHaveBeenCalled();
    expect(results).toEqual([{ channelId: "telegram", delivered: true }]);
  });

  it("one adapter throwing never blocks the others (logged, tolerated)", async () => {
    const telegram = vi.fn().mockRejectedValue(new Error("telegram down"));
    const email = vi.fn().mockResolvedValue(undefined);
    const sms = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ChannelDispatcher(
      makeTelegram({ send: telegram }),
      makeEmail({ send: email }),
      makeSms({ send: sms })
    );

    const results = await dispatcher.dispatch({
      clientId: "c1",
      telegramId: 555,
      email: "a@example.com",
      phone: "+381600000000",
      text: "hi"
    });

    expect(email).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { channelId: "telegram", delivered: false },
      { channelId: "email", delivered: true },
      { channelId: "sms", delivered: true }
    ]);
  });

  it("skips channels listed in the skip set (per-channel idempotency)", async () => {
    const telegram = vi.fn().mockResolvedValue(undefined);
    const email = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ChannelDispatcher(
      makeTelegram({ send: telegram }),
      makeEmail({ send: email })
    );

    const results = await dispatcher.dispatch(
      { clientId: "c1", telegramId: 555, email: "a@example.com", text: "hi" },
      new Set(["telegram"])
    );

    expect(telegram).not.toHaveBeenCalled();
    expect(email).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ channelId: "email", delivered: true }]);
  });
});
