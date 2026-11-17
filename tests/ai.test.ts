import type { UIMessage, UIMessageChunk } from "ai";
import { type Room, RoomEvent } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { LiveKitChatTransport, syncRoomTranscriptions } from "../src/ai.js";

class FakeRoom {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  localParticipant = {
    identity: "patient-1",
    publishData: vi.fn(async () => undefined),
  };

  on(event: string, fn: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

async function readAllChunks(
  stream: ReadableStream<UIMessageChunk>
): Promise<UIMessageChunk[]> {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe("LiveKitChatTransport", () => {
  it("publishes user messages and streams agent text chunks", async () => {
    const fakeRoom = new FakeRoom();
    const transport = new LiveKitChatTransport(fakeRoom as unknown as Room);
    const encoder = new TextEncoder();

    const messages: UIMessage[] = [
      {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Hello doctor agent" }],
      },
    ];

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages,
      abortSignal: undefined,
    });

    expect(fakeRoom.localParticipant.publishData).toHaveBeenCalledTimes(1);

    // Emit unrelated topic (should be ignored)
    fakeRoom.emit(
      RoomEvent.DataReceived,
      encoder.encode(JSON.stringify({ type: "text-delta", delta: "ignored" })),
      undefined,
      undefined,
      "other-topic"
    );

    // Emit valid deltas and done
    fakeRoom.emit(
      RoomEvent.DataReceived,
      encoder.encode(JSON.stringify({ type: "text-delta", delta: "Hello " })),
      undefined,
      undefined,
      "ai-chat"
    );
    fakeRoom.emit(
      RoomEvent.DataReceived,
      encoder.encode(JSON.stringify({ type: "text-delta", delta: "world!" })),
      undefined,
      undefined,
      "ai-chat"
    );
    fakeRoom.emit(
      RoomEvent.DataReceived,
      encoder.encode(JSON.stringify({ type: "done" })),
      undefined,
      undefined,
      "ai-chat"
    );

    const chunks = await readAllChunks(stream);
    expect(chunks.map((c) => c.type)).toEqual([
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
    ]);
    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => (c as { delta: string }).delta)
        .join("")
    ).toBe("Hello world!");

    expect(await transport.reconnectToStream()).toBeNull();
  });

  it("closes stream and removes listener on abort", async () => {
    const fakeRoom = new FakeRoom();
    const transport = new LiveKitChatTransport(fakeRoom as unknown as Room);
    const abortController = new AbortController();

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-2",
      messageId: undefined,
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] },
      ],
      abortSignal: abortController.signal,
    });

    expect(fakeRoom.listenerCount(RoomEvent.DataReceived)).toBe(1);
    abortController.abort();
    expect(fakeRoom.listenerCount(RoomEvent.DataReceived)).toBe(0);

    const chunks = await readAllChunks(stream);
    expect(chunks[0]?.type).toBe("text-start");
  });
});

describe("syncRoomTranscriptions", () => {
  it("converts final transcription segments into UIMessages and unsubscribes", () => {
    const fakeRoom = new FakeRoom();
    const received: UIMessage[] = [];

    const unsubscribe = syncRoomTranscriptions(
      fakeRoom as unknown as Room,
      (msg) => received.push(msg)
    );

    // Interim segment should be ignored
    fakeRoom.emit(
      RoomEvent.TranscriptionReceived,
      [{ id: "s1", text: "Hel", final: false }],
      { identity: "patient-1" }
    );
    expect(received).toHaveLength(0);

    // Final local user segment
    fakeRoom.emit(
      RoomEvent.TranscriptionReceived,
      [{ id: "s2", text: "Hello there", final: true }],
      { identity: "patient-1" }
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      id: "s2",
      role: "user",
      parts: [{ type: "text", text: "Hello there" }],
    });

    // Final remote agent segment
    fakeRoom.emit(
      RoomEvent.TranscriptionReceived,
      [{ id: "s3", text: "How can I help?", final: true }],
      { identity: "ai-agent" }
    );
    expect(received).toHaveLength(2);
    expect(received[1].role).toBe("assistant");

    unsubscribe();
    expect(fakeRoom.listenerCount(RoomEvent.TranscriptionReceived)).toBe(0);
  });
});
