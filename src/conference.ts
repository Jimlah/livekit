import { definePrimitive } from "@ui-sdk/core";
import {
  ConnectionState,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";

export interface ConferenceOptions {
  /** LiveKit WebSocket server URL (e.g. `wss://your-project.livekit.cloud`). */
  serverUrl?: string;
  /** LiveKit participant access token (JWT). */
  token?: string;
  /** Automatically connect to the room when the `root` slot binds to the DOM. */
  autoConnect?: boolean;
  /** Automatically enable camera and microphone upon connecting. Defaults to `true`. */
  autoEnableMedia?: boolean;
  /** Called after the room connects and initial media is enabled. */
  onConnected?: (room: Room) => void;
  /** Called after the room disconnects. */
  onDisconnected?: () => void;
  /** Called when connecting or media initialization fails. */
  onError?: (error: Error) => void;
}

export interface ConferenceState {
  connectionState: ConnectionState;
  localParticipant: LocalParticipant | null;
  remoteParticipants: RemoteParticipant[];
  activeSpeakerIds: string[];
  screenShareParticipantId: string | null;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  error: Error | null;
}

export type MediaDeviceKind = "audioinput" | "videoinput" | "audiooutput";

export type ConferenceVideoSource = Track.Source.Camera | Track.Source.ScreenShare;

function findScreenSharer(participants: Participant[]): Participant | undefined {
  return participants.find((p) => {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    return Boolean(pub?.isSubscribed || pub?.track);
  });
}

function getTrackMutedState(participant: Participant, source: Track.Source): boolean {
  const pub = participant.getTrackPublication(source);
  return pub?.isMuted ?? true;
}

/**
 * Headless teleconferencing primitive built on `@ui-sdk/core` and `livekit-client`.
 *
 * Manages a LiveKit `Room` lifecycle, reactive participant/track/speaker state,
 * imperative media controls, and 11 typed DOM slots (`root`, `stage`, `grid`,
 * `participant`, `video`, `audio`, `controls`, `micTrigger`, `cameraTrigger`,
 * `screenShareTrigger`, `leaveTrigger`).
 */
const conferencePrimitive = definePrimitive({
  name: "conference",
  options: {
    serverUrl: "string",
    token: "string",
    autoConnect: "boolean",
    autoEnableMedia: "boolean",
    onConnected: "callback",
    onDisconnected: "callback",
    onError: "callback",
  },
  state: (_options: ConferenceOptions): ConferenceState => ({
    connectionState: ConnectionState.Disconnected,
    localParticipant: null,
    remoteParticipants: [],
    activeSpeakerIds: [],
    screenShareParticipantId: null,
    isMicEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    error: null,
  }),
  api: (context) => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
    });

    const syncState = () => {
      const local = room.localParticipant ?? null;
      const remotes = Array.from(room.remoteParticipants.values());
      const allParticipants: Participant[] = local ? [local, ...remotes] : remotes;
      const screenSharer = findScreenSharer(allParticipants);

      context.store.set({
        connectionState: room.state,
        localParticipant: local,
        remoteParticipants: remotes,
        screenShareParticipantId: screenSharer?.identity ?? null,
        isMicEnabled: local?.isMicrophoneEnabled ?? false,
        isCameraEnabled: local?.isCameraEnabled ?? false,
        isScreenShareEnabled: local?.isScreenShareEnabled ?? false,
      });
    };

    const handleActiveSpeakersChanged = (speakers: Participant[]) => {
      context.store.set({
        activeSpeakerIds: speakers.map((s) => s.identity),
      });
    };

    room
      .on(RoomEvent.ConnectionStateChanged, syncState)
      .on(RoomEvent.ParticipantConnected, syncState)
      .on(RoomEvent.ParticipantDisconnected, syncState)
      .on(RoomEvent.TrackSubscribed, syncState)
      .on(RoomEvent.TrackUnsubscribed, syncState)
      .on(RoomEvent.TrackMuted, syncState)
      .on(RoomEvent.TrackUnmuted, syncState)
      .on(RoomEvent.LocalTrackPublished, syncState)
      .on(RoomEvent.LocalTrackUnpublished, syncState)
      .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged);

    const api = {
      room,

      getOptions() {
        return context.options();
      },

      async connect() {
        const {
          serverUrl,
          token,
          autoEnableMedia = true,
          onConnected,
          onError,
        } = context.options();
        if (!serverUrl || !token) return;

        try {
          context.store.set({ error: null, connectionState: ConnectionState.Connecting });
          await room.connect(serverUrl, token);

          if (autoEnableMedia) {
            await room.localParticipant.enableCameraAndMicrophone();
          }

          syncState();
          onConnected?.(room);
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error("Failed to connect to LiveKit room");
          context.store.set({ error, connectionState: ConnectionState.Disconnected });
          onError?.(error);
        }
      },

      async disconnect() {
        await room.disconnect();
        syncState();
        context.options().onDisconnected?.();
      },

      async toggleMic() {
        const next = !context.store.get().isMicEnabled;
        await room.localParticipant.setMicrophoneEnabled(next);
        syncState();
      },

      async toggleCamera() {
        const next = !context.store.get().isCameraEnabled;
        await room.localParticipant.setCameraEnabled(next);
        syncState();
      },

      async toggleScreenShare() {
        const next = !context.store.get().isScreenShareEnabled;
        await room.localParticipant.setScreenShareEnabled(next, { audio: true });
        syncState();
      },

      async switchDevice(kind: MediaDeviceKind, deviceId: string) {
        await room.switchActiveDevice(kind, deviceId);
      },

      attachTrack(
        participant: Participant,
        source: Track.Source,
        element: HTMLMediaElement
      ) {
        const track = participant.getTrackPublication(source)?.track;
        track?.attach(element);
        return () => {
          track?.detach(element);
        };
      },

      destroy() {
        room.removeAllListeners();
        void room.disconnect();
      },
    };

    context.onDestroy(() => {
      api.destroy();
    });

    return api;
  },
  slots: (slot) => {
    const bindTrackElement = (
      el: HTMLElement,
      participant: Participant,
      source: Track.Source,
      api: {
        attachTrack: (
          p: Participant,
          s: Track.Source,
          element: HTMLMediaElement
        ) => () => void;
      },
      store: { subscribe: (fn: () => void) => () => void }
    ) => {
      if (!(el instanceof HTMLMediaElement)) return;

      let currentTrack = participant.getTrackPublication(source)?.track ?? null;
      let detach = currentTrack ? api.attachTrack(participant, source, el) : undefined;

      const unsubscribe = store.subscribe(() => {
        const nextTrack = participant.getTrackPublication(source)?.track ?? null;
        if (nextTrack !== currentTrack) {
          detach?.();
          currentTrack = nextTrack;
          detach = currentTrack ? api.attachTrack(participant, source, el) : undefined;
        }
      });

      return () => {
        unsubscribe();
        detach?.();
      };
    };

    return {
      root: slot<{}, { connectionState: ConnectionState; hasScreenShare: boolean }>({
        role: "region",
        state: (state) => ({
          connectionState: state.connectionState,
          hasScreenShare: Boolean(state.screenShareParticipantId),
        }),
        attrs: (state) => ({
          "aria-label": "Teleconference Room",
          "data-connection-state": state.connectionState,
          "data-screen-sharing": String(Boolean(state.screenShareParticipantId)),
        }),
        bind: (_el, part) => {
          if (part.api.getOptions().autoConnect) {
            void part.api.connect();
          }
          return () => part.api.destroy();
        },
      }),

      stage: slot<{}, { active: boolean; sharerId: string | null }>({
        state: (state) => ({
          active: Boolean(state.screenShareParticipantId),
          sharerId: state.screenShareParticipantId,
        }),
        attrs: (state) => ({
          "data-active": String(Boolean(state.screenShareParticipantId)),
          hidden: state.screenShareParticipantId ? undefined : "",
        }),
      }),

      grid: slot<{}, { participantCount: number }>({
        role: "list",
        state: (state) => ({
          participantCount:
            (state.localParticipant ? 1 : 0) + state.remoteParticipants.length,
        }),
        attrs: (state) => ({
          "data-count": String(
            (state.localParticipant ? 1 : 0) + state.remoteParticipants.length
          ),
        }),
      }),

      participant: slot<
        { participant: Participant },
        {
          isLocal: boolean;
          isSpeaking: boolean;
          isMicMuted: boolean;
          isCameraMuted: boolean;
        }
      >({
        role: "listitem",
        props: {
          participant: "value",
        },
        state: (state, { props }) => ({
          isLocal: props.participant.identity === state.localParticipant?.identity,
          isSpeaking: state.activeSpeakerIds.includes(props.participant.identity),
          isMicMuted: getTrackMutedState(props.participant, Track.Source.Microphone),
          isCameraMuted: getTrackMutedState(props.participant, Track.Source.Camera),
        }),
        attrs: (state, { props }) => ({
          "data-identity": props.participant.identity,
          "data-speaking": String(
            state.activeSpeakerIds.includes(props.participant.identity)
          ),
          "data-local": String(
            props.participant.identity === state.localParticipant?.identity
          ),
        }),
      }),

      video: slot<
        { participant: Participant; source?: ConferenceVideoSource },
        { isMuted: boolean }
      >({
        props: {
          participant: "value",
          source: "value",
        },
        state: (_state, { props }) => ({
          isMuted: getTrackMutedState(
            props.participant,
            props.source ?? Track.Source.Camera
          ),
        }),
        attrs: (state, { props }) => {
          const isLocal =
            props.participant.identity === state.localParticipant?.identity;
          const source = props.source ?? Track.Source.Camera;
          return {
            autoplay: "",
            playsinline: "",
            muted: isLocal ? "" : undefined,
            "data-source": source,
          };
        },
        bind: (el, part) => {
          const source = part.props.source ?? Track.Source.Camera;
          return bindTrackElement(
            el,
            part.props.participant,
            source,
            part.api,
            part.store
          );
        },
      }),

      audio: slot<{ participant: Participant }, { isMuted: boolean }>({
        props: {
          participant: "value",
        },
        state: (_state, { props }) => ({
          isMuted: getTrackMutedState(props.participant, Track.Source.Microphone),
        }),
        attrs: () => ({
          autoplay: "",
        }),
        bind: (el, part) => {
          // Never attach audio output for the local participant to prevent echo
          const localIdentity = part.store.get().localParticipant?.identity;
          if (part.props.participant.identity === localIdentity) return;

          return bindTrackElement(
            el,
            part.props.participant,
            Track.Source.Microphone,
            part.api,
            part.store
          );
        },
      }),

      controls: slot<{}, { connected: boolean }>({
        role: "toolbar",
        keys: { none: "Toolbar buttons use native Tab navigation" },
        state: (state) => ({
          connected: state.connectionState === ConnectionState.Connected,
        }),
        attrs: () => ({
          "aria-label": "Call controls",
        }),
      }),

      micTrigger: slot<{}, { enabled: boolean }>({
        role: "button",
        focus: "native",
        state: (state) => ({ enabled: state.isMicEnabled }),
        attrs: (state) => ({
          type: "button",
          "aria-pressed": String(state.isMicEnabled),
          "aria-label": state.isMicEnabled ? "Mute microphone" : "Unmute microphone",
          "data-enabled": String(state.isMicEnabled),
          disabled:
            state.connectionState !== ConnectionState.Connected ? "" : undefined,
        }),
        press: ({ api }) => {
          void api.toggleMic();
        },
      }),

      cameraTrigger: slot<{}, { enabled: boolean }>({
        role: "button",
        focus: "native",
        state: (state) => ({ enabled: state.isCameraEnabled }),
        attrs: (state) => ({
          type: "button",
          "aria-pressed": String(state.isCameraEnabled),
          "aria-label": state.isCameraEnabled ? "Turn off camera" : "Turn on camera",
          "data-enabled": String(state.isCameraEnabled),
          disabled:
            state.connectionState !== ConnectionState.Connected ? "" : undefined,
        }),
        press: ({ api }) => {
          void api.toggleCamera();
        },
      }),

      screenShareTrigger: slot<{}, { enabled: boolean }>({
        role: "button",
        focus: "native",
        state: (state) => ({ enabled: state.isScreenShareEnabled }),
        attrs: (state) => ({
          type: "button",
          "aria-pressed": String(state.isScreenShareEnabled),
          "aria-label": state.isScreenShareEnabled
            ? "Stop screen share"
            : "Share screen",
          "data-enabled": String(state.isScreenShareEnabled),
          disabled:
            state.connectionState !== ConnectionState.Connected ? "" : undefined,
        }),
        press: ({ api }) => {
          void api.toggleScreenShare();
        },
      }),

      leaveTrigger: slot<{}, { connected: boolean }>({
        role: "button",
        focus: "native",
        state: (state) => ({
          connected: state.connectionState === ConnectionState.Connected,
        }),
        attrs: (state) => ({
          type: "button",
          "aria-label": "Leave call",
          disabled:
            state.connectionState === ConnectionState.Disconnected ? "" : undefined,
        }),
        press: ({ api }) => {
          void api.disconnect();
        },
      }),
    };
  },
});

type Named<T> = T;

export interface ConferencePrimitive extends Named<typeof conferencePrimitive> {}

export const conference: ConferencePrimitive = conferencePrimitive;
