# `smarthealth-livekit`

A headless, framework-agnostic LiveKit teleconferencing and multimodal AI package built on [`@ui-sdk/core`](https://ui-sdk.dev), [`@ui-sdk/react`](https://ui-sdk.dev), [`livekit-client`](https://www.npmjs.com/package/livekit-client), and [`ai`](https://ai-sdk.dev).

It provides three composable layers:

1. **Headless `conference` Primitive (`smarthealth-livekit`)** — Wraps LiveKit's `Room` lifecycle, adaptive streaming, dynacast, active speaker detection, screen-share spotlighting, and echo-safe track attachment into 11 typed `@ui-sdk/core` slots.
2. **Imperative Controller (`callController` / `createConferenceController`)** — Decouples the LiveKit room runtime from any React component tree so calls can be started, muted, or ended from anywhere in plain JS/TS (button handlers, keyboard shortcuts, router guards, WebSocket events).
3. **Compound React Components (`smarthealth-livekit/react`) & AI Chat Transport (`smarthealth-livekit/ai`)** — Declarative `<Conference.*>` compound components, `<ConferenceControllerRoot>` for global call overlays, and `LiveKitChatTransport` + `syncRoomTranscriptions` for `@ai-sdk/react`'s `useChat`.

---

## Installation

```bash
npm install smarthealth-livekit livekit-client @ui-sdk/core
```

Depending on which entrypoints you use, install the optional peer dependencies:

```bash
# For React compound components & global call overlay (smarthealth-livekit/react)
npm install react @ui-sdk/react

# For AI chat & voice transcription sync (smarthealth-livekit/ai)
npm install ai @ai-sdk/react
```

### Entrypoints

| Import Path | Contents |
| :--- | :--- |
| `smarthealth-livekit` | `conference` primitive, `callController`, `createConferenceController`, and TypeScript types |
| `smarthealth-livekit/react` | `Conference` compound components, `ConferenceControllerRoot`, `useConferenceController` |
| `smarthealth-livekit/ai` | `LiveKitChatTransport`, `syncRoomTranscriptions` |

---

## 1. Compound Component Usage (React)

Use `Conference` from `smarthealth-livekit/react` for declarative teleconferencing UIs with zero `useEffect` or LiveKit event listeners in your components:

```tsx
import { Track } from "livekit-client";
import { Conference } from "smarthealth-livekit/react";

export function VideoCallRoom({
  serverUrl,
  token,
}: {
  serverUrl: string;
  token: string;
}) {
  return (
    <Conference.Root
      serverUrl={serverUrl}
      token={token}
      autoConnect
      autoEnableMedia
      onDisconnected={() => console.log("Call ended")}
      className="flex flex-col h-screen bg-zinc-950 text-white"
    >
      {({ connectionState }) => (
        <>
          {connectionState !== "connected" && (
            <div className="p-4 text-center text-sm bg-zinc-900">
              Status: {connectionState}...
            </div>
          )}

          <div className="flex-1 flex gap-4 p-4 overflow-hidden">
            {/* Spotlight Stage: automatically hidden when no one is sharing */}
            <Conference.Stage className="flex-1 bg-black rounded-xl overflow-hidden" />

            {/* Participant Grid */}
            <Conference.Grid className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4" />
          </div>

          {/* Bottom Control Bar */}
          <Conference.Controls className="flex items-center justify-center gap-3 p-4 bg-zinc-900 border-t border-zinc-800">
            <Conference.MicTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=false]:bg-red-600">
              {({ enabled }) => (enabled ? "Mute" : "Unmute")}
            </Conference.MicTrigger>

            <Conference.CameraTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=false]:bg-red-600">
              {({ enabled }) => (enabled ? "Stop Video" : "Start Video")}
            </Conference.CameraTrigger>

            <Conference.ScreenShareTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=true]:bg-emerald-600">
              {({ enabled }) => (enabled ? "Stop Sharing" : "Share Screen")}
            </Conference.ScreenShareTrigger>

            <Conference.LeaveTrigger className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700">
              Leave Call
            </Conference.LeaveTrigger>
          </Conference.Controls>
        </>
      )}
    </Conference.Root>
  );
}
```

### Rendering Participant Tiles

Inside `<Conference.Grid>`, map over participants (from `useConferenceController` or your room state) and render `<Conference.Participant>`, `<Conference.Video>`, and `<Conference.Audio>`:

```tsx
<Conference.Participant
  key={participant.identity}
  participant={participant}
  className="relative rounded-xl overflow-hidden bg-zinc-900 border-2 border-transparent data-[speaking=true]:border-emerald-500"
>
  {({ isLocal, isMicMuted, isCameraMuted }) => (
    <>
      <Conference.Video
        participant={participant}
        className={`w-full h-full object-cover ${isCameraMuted ? "hidden" : ""}`}
      />
      {/* Automatically skips local participant to prevent audio feedback */}
      <Conference.Audio participant={participant} />

      {isCameraMuted && (
        <div className="flex items-center justify-center h-full text-zinc-400">
          {participant.name || participant.identity}
        </div>
      )}

      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-black/60 text-xs flex items-center gap-2">
        <span>
          {participant.identity} {isLocal && "(You)"}
        </span>
        {isMicMuted && <span className="text-red-400">Muted</span>}
      </div>
    </>
  )}
</Conference.Participant>
```

---

## 2. Imperative Controller Pattern (`callController`)

When you want to trigger or control a call from outside the UI tree—inside an event handler, router guard, WebSocket message, or global keyboard shortcut—use `callController` (or create an isolated controller with `createConferenceController()`).

### Configure Once & Trigger From Anywhere in JS/TS

```ts
// lib/call-client.ts
import { callController } from "smarthealth-livekit";

callController.configure({
  serverUrl: import.meta.env.VITE_LIVEKIT_URL,
  autoEnableMedia: true,
});
```

```ts
// features/appointment/start-consultation.ts
import { callController } from "smarthealth-livekit";

export async function handleJoinConsultation(appointmentId: string) {
  const res = await fetch(`/api/consultations/${appointmentId}/token`, {
    method: "POST",
  });
  const { token, serverUrl } = await res.json();

  // Launch the teleconference imperatively from anywhere
  await callController.start(token, serverUrl);
}

// Bind a global keyboard shortcut
window.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    void callController.toggleMic();
  }
});
```

### Mount a Global UI Overlay Once

Mount `<GlobalCallOverlay />` once at the root of your React app using `useConferenceController` and `ConferenceControllerRoot`:

```tsx
// components/GlobalCallOverlay.tsx
import { ConnectionState, Track } from "livekit-client";
import { callController } from "smarthealth-livekit";
import {
  Conference,
  ConferenceControllerRoot,
  useConferenceController,
} from "smarthealth-livekit/react";

export function GlobalCallOverlay() {
  const state = useConferenceController(callController);

  if (state.connectionState === ConnectionState.Disconnected) {
    return null;
  }

  const allParticipants = [
    ...(state.localParticipant ? [state.localParticipant] : []),
    ...state.remoteParticipants,
  ];
  const screenSharer = allParticipants.find(
    (p) => p.identity === state.screenShareParticipantId
  );

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 text-white">
      <ConferenceControllerRoot controller={callController} className="flex flex-col h-full">
        <div className="flex-1 flex gap-4 p-4 overflow-hidden">
          <Conference.Stage className="flex-1 bg-black rounded-xl overflow-hidden">
            {screenSharer && (
              <Conference.Video
                participant={screenSharer}
                source={Track.Source.ScreenShare}
                className="w-full h-full object-contain"
              />
            )}
          </Conference.Stage>

          <Conference.Grid className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            {allParticipants.map((participant) => (
              <Conference.Participant
                key={participant.identity}
                participant={participant}
                className="relative rounded-xl overflow-hidden bg-zinc-900 border-2 border-transparent data-[speaking=true]:border-emerald-500"
              >
                <Conference.Video
                  participant={participant}
                  className="w-full h-full object-cover"
                />
                <Conference.Audio participant={participant} />
              </Conference.Participant>
            ))}
          </Conference.Grid>
        </div>

        <Conference.Controls className="flex items-center justify-center gap-3 p-4 bg-zinc-900 border-t border-zinc-800">
          <Conference.MicTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=false]:bg-red-600">
            {({ enabled }) => (enabled ? "Mute" : "Unmute")}
          </Conference.MicTrigger>
          <Conference.CameraTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=false]:bg-red-600">
            {({ enabled }) => (enabled ? "Stop Video" : "Start Video")}
          </Conference.CameraTrigger>
          <Conference.ScreenShareTrigger className="px-4 py-2 rounded-lg bg-zinc-800 data-[enabled=true]:bg-emerald-600">
            {({ enabled }) => (enabled ? "Stop Sharing" : "Share Screen")}
          </Conference.ScreenShareTrigger>
          <Conference.LeaveTrigger className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700">
            Leave Call
          </Conference.LeaveTrigger>
        </Conference.Controls>
      </ConferenceControllerRoot>
    </div>
  );
}
```

---

## 3. Core / Vanilla JS Usage (Framework-Agnostic)

Use `conference` directly without any UI framework:

```ts
import { conference } from "smarthealth-livekit";

const call = conference({
  id: "main-call",
  serverUrl: "wss://your-project.livekit.cloud",
  token: "eyJ...",
  autoConnect: true,
});

await call.api.connect();

const micBtn = document.getElementById("mic-btn")!;
micBtn.addEventListener("click", () => void call.api.toggleMic());

const unsubscribe = call.subscribe(() => {
  const state = call.get();
  micBtn.textContent = state.isMicEnabled ? "Mute" : "Unmute";
  micBtn.setAttribute("data-enabled", String(state.isMicEnabled));
});
```

---

## 4. AI Chat & Transcription Integration (`smarthealth-livekit/ai`)

Connect LiveKit's reliable data channels and real-time voice transcriptions to `@ai-sdk/react`'s `useChat`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { useChat } from "@ai-sdk/react";
import {
  LiveKitChatTransport,
  syncRoomTranscriptions,
} from "smarthealth-livekit/ai";

export function VoiceAndChatAgent({
  token,
  serverUrl,
}: {
  token: string;
  serverUrl: string;
}) {
  const [room] = useState(() => new Room());
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const audioContainerRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new LiveKitChatTransport(room), [room]);
  const { messages, sendMessage, setMessages, status } = useChat({ transport });

  useEffect(() => {
    let mounted = true;

    const handleTrackSubscribed = (track: Track) => {
      if (track.kind === Track.Kind.Audio && audioContainerRef.current) {
        audioContainerRef.current.appendChild(track.attach());
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);

    const stopTranscriptions = syncRoomTranscriptions(room, (transcriptMsg) => {
      setMessages((prev) => [...prev, transcriptMsg]);
    });

    void room.connect(serverUrl, token).then(async () => {
      await room.localParticipant.setMicrophoneEnabled(true);
      if (mounted) setConnected(true);
    });

    return () => {
      mounted = false;
      stopTranscriptions();
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      void room.disconnect();
    };
  }, [room, serverUrl, token, setMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !connected) return;
    const text = input;
    setInput("");
    await sendMessage({ text });
  };

  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto p-4">
      <div ref={audioContainerRef} className="hidden" />
      <div className="text-sm text-gray-500">
        Status: {connected ? "Connected (Mic Live)" : "Connecting..."}
      </div>

      <div className="flex flex-col gap-2 border rounded p-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className="font-semibold">
              {m.role === "user" ? "You" : "Agent"}:{" "}
            </span>
            {m.parts.map((part, i) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message or speak..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={!connected || status === "streaming"}
          className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

### Data Channel Protocol

`LiveKitChatTransport` uses topic `"ai-chat"` by default (configurable via `new LiveKitChatTransport(room, { topic })`):

- **Outgoing (client -> agent):** `{ type: "user_message", message: UIMessage }`
- **Incoming (agent -> client):**
  - `{ type: "text-delta", delta: string }`
  - `{ type: "done" }`
  - `{ type: "error", errorText?: string }`

---

## 5. Styling with Tailwind `data-[...]` Modifiers

Because every slot exposes `data-*` attributes automatically, you can style states purely with CSS/Tailwind:

- `data-[speaking=true]:border-emerald-500` on `<Conference.Participant>` highlights active speakers.
- `data-[enabled=false]:bg-red-600` on `<Conference.MicTrigger>` / `<Conference.CameraTrigger>` styles muted controls.
- `data-[connection-state=reconnecting]:opacity-50` on `<Conference.Root>` dims the UI during network drops.
- `data-[active=true]` / `hidden` on `<Conference.Stage>` toggles the screen-share spotlight automatically.

---

## 6. API Reference

### `ConferenceOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `serverUrl` | `string` | `undefined` | LiveKit WebSocket URL |
| `token` | `string` | `undefined` | LiveKit participant JWT |
| `autoConnect` | `boolean` | `false` | Auto-connect when `root` binds |
| `autoEnableMedia` | `boolean` | `true` | Enable camera & mic upon connecting |
| `onConnected` | `(room: Room) => void` | `undefined` | Called after connecting |
| `onDisconnected` | `() => void` | `undefined` | Called after disconnecting |
| `onError` | `(error: Error) => void` | `undefined` | Called on connection/media error |

### `ConferenceState`

| Field | Type | Description |
| :--- | :--- | :--- |
| `connectionState` | `ConnectionState` | LiveKit room connection state |
| `localParticipant` | `LocalParticipant \| null` | Local participant instance |
| `remoteParticipants` | `RemoteParticipant[]` | Connected remote participants |
| `activeSpeakerIds` | `string[]` | Identities of currently speaking participants |
| `screenShareParticipantId` | `string \| null` | Identity of participant sharing screen, if any |
| `isMicEnabled` | `boolean` | Local microphone enabled state |
| `isCameraEnabled` | `boolean` | Local camera enabled state |
| `isScreenShareEnabled` | `boolean` | Local screen share enabled state |
| `error` | `Error \| null` | Last connection error, if any |

### Slots

| Slot | Role / Element | Exposed Attributes & Behavior |
| :--- | :--- | :--- |
| `root` | `region` / `div` | `data-connection-state`, `data-screen-sharing`; cleans up room on unmount |
| `stage` | `section` | `data-active`, `hidden` when no active screen share |
| `grid` | `list` / `div` | `data-count` with total participant count |
| `participant` | `listitem` / `div` | `data-identity`, `data-speaking`, `data-local` |
| `video` | `video` | `autoplay`, `playsinline`, `muted` (local only), `data-source`; attaches/detaches track on bind |
| `audio` | `audio` | `autoplay`; attaches remote mic audio, skips local participant to prevent echo |
| `controls` | `toolbar` / `div` | `aria-label="Call controls"` |
| `micTrigger` | `button` | `aria-pressed`, `data-enabled`, `disabled` when disconnected; toggles mic |
| `cameraTrigger` | `button` | `aria-pressed`, `data-enabled`, `disabled` when disconnected; toggles camera |
| `screenShareTrigger` | `button` | `aria-pressed`, `data-enabled`, `disabled` when disconnected; toggles screen share |
| `leaveTrigger` | `button` | `aria-label="Leave call"`, `disabled` when disconnected; disconnects room |
