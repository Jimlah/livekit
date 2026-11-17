import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { type Participant, type Room, RoomEvent, type TranscriptionSegment } from "livekit-client";

export interface LiveKitChatTransportOptions {
  /** LiveKit data channel topic used for AI chat messages. Defaults to `"ai-chat"`. */
  topic?: string;
}

interface IncomingDataEvent {
  type: string;
  delta?: string;
  errorText?: string;
}

/**
 * Custom `ChatTransport` (`ai`) that routes `useChat` messages over a
 * LiveKit `Room` reliable data channel instead of HTTP `fetch`.
 */
export class LiveKitChatTransport implements ChatTransport<UIMessage> {
  private readonly topic: string;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private activeCleanups = new Set<() => void>();

  constructor(
    private readonly room: Room,
    options: LiveKitChatTransportOptions = {}
  ) {
    this.topic = options.topic ?? "ai-chat";
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastMessage = messages[messages.length - 1];

    await this.room.localParticipant.publishData(
      this.encoder.encode(
        JSON.stringify({ type: "user_message", message: lastMessage })
      ),
      { reliable: true, topic: this.topic }
    );

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const messageId = crypto.randomUUID();
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          this.room.off(RoomEvent.DataReceived, handleData);
          abortSignal?.removeEventListener("abort", handleAbort);
          this.activeCleanups.delete(cleanup);
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
        };

        const handleAbort = () => {
          cleanup();
        };

        const handleData = (
          payload: Uint8Array,
          _participant?: unknown,
          _kind?: unknown,
          topic?: string
        ) => {
          if (closed || topic !== this.topic) return;

          let event: IncomingDataEvent;
          try {
            event = JSON.parse(this.decoder.decode(payload)) as IncomingDataEvent;
          } catch {
            return;
          }

          if (event.type === "text-delta" && typeof event.delta === "string") {
            controller.enqueue({
              type: "text-delta",
              id: messageId,
              delta: event.delta,
            });
          } else if (event.type === "error") {
            controller.enqueue({
              type: "error",
              errorText: event.errorText ?? "LiveKit agent stream error",
            });
            cleanup();
          } else if (event.type === "done") {
            controller.enqueue({ type: "text-end", id: messageId });
            cleanup();
          }
        };

        if (abortSignal?.aborted) {
          cleanup();
          return;
        }

        controller.enqueue({ type: "text-start", id: messageId });
        this.activeCleanups.add(cleanup);
        this.room.on(RoomEvent.DataReceived, handleData);
        abortSignal?.addEventListener("abort", handleAbort, { once: true });
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  close(): void {
    for (const cleanup of Array.from(this.activeCleanups)) {
      cleanup();
    }
  }
}

/**
 * Subscribes to LiveKit `RoomEvent.TranscriptionReceived` and converts finalized
 * voice transcription segments into `UIMessage` objects.
 *
 * Returns an unsubscribe function to detach the listener.
 */
export function syncRoomTranscriptions(
  room: Room,
  onTranscript: (message: UIMessage) => void
): () => void {
  const handleTranscription = (
    segments: TranscriptionSegment[],
    participant?: Participant
  ) => {
    const finalSegments = segments.filter((s) => s.final);
    const finalText = finalSegments.map((s) => s.text).join(" ").trim();
    if (!finalText) return;

    const role: UIMessage["role"] =
      participant?.identity === room.localParticipant.identity
        ? "user"
        : "assistant";

    onTranscript({
      id: finalSegments[0]?.id ?? crypto.randomUUID(),
      role,
      parts: [{ type: "text", text: finalText }],
    });
  };

  room.on(RoomEvent.TranscriptionReceived, handleTranscription);
  return () => {
    room.off(RoomEvent.TranscriptionReceived, handleTranscription);
  };
}
