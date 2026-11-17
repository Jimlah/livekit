import { ConnectionState, Track } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRooms, MockRoom } = vi.hoisted(() => {
  const rooms: any[] = [];

  class SimpleEmitter {
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
      return this;
    }

    off(event: string, fn: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(fn);
      return this;
    }

    removeAllListeners() {
      this.listeners.clear();
      return this;
    }
  }

  class MockLocalParticipant {
    identity = "local-user";
    name = "Local User";
    isMicrophoneEnabled = false;
    isCameraEnabled = false;
    isScreenShareEnabled = false;
    publications = new Map<
      Track.Source,
      { track?: unknown; isSubscribed?: boolean; isMuted?: boolean }
    >();

    enableCameraAndMicrophone = vi.fn(async () => {
      this.isMicrophoneEnabled = true;
      this.isCameraEnabled = true;
    });

    setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
      this.isMicrophoneEnabled = enabled;
    });

    setCameraEnabled = vi.fn(async (enabled: boolean) => {
      this.isCameraEnabled = enabled;
    });

    setScreenShareEnabled = vi.fn(async (enabled: boolean) => {
      this.isScreenShareEnabled = enabled;
    });

    getTrackPublication(source: Track.Source) {
      return this.publications.get(source);
    }
  }

  class HoistedMockRoom extends SimpleEmitter {
    state: ConnectionState = ConnectionState.Disconnected;
    localParticipant = new MockLocalParticipant();
    remoteParticipants = new Map<string, unknown>();

    constructor() {
      super();
      rooms.push(this);
    }

    connect = vi.fn(async (_url: string, _token: string) => {
      this.state = ConnectionState.Connected;
    });

    disconnect = vi.fn(async () => {
      this.state = ConnectionState.Disconnected;
    });

    switchActiveDevice = vi.fn(async () => true);
  }

  return { mockRooms: rooms, MockRoom: HoistedMockRoom };
});

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();
  return {
    ...actual,
    Room: MockRoom,
  };
});

import { conference, createConferenceController } from "../src/index.js";

describe("conference primitive", () => {
  beforeEach(() => {
    mockRooms.length = 0;
  });

  it("initializes in disconnected state and connects with autoEnableMedia", async () => {
    const onConnected = vi.fn();
    const instance = conference({
      id: "test-room",
      serverUrl: "wss://livekit.example.com",
      token: "jwt-token",
      autoEnableMedia: true,
      onConnected,
    });

    expect(instance.get().connectionState).toBe(ConnectionState.Disconnected);
    expect(instance.get().isMicEnabled).toBe(false);

    await instance.api.connect();

    const state = instance.get();
    expect(state.connectionState).toBe(ConnectionState.Connected);
    expect(state.isMicEnabled).toBe(true);
    expect(state.isCameraEnabled).toBe(true);
    expect(onConnected).toHaveBeenCalledTimes(1);

    await instance.api.toggleMic();
    expect(instance.get().isMicEnabled).toBe(false);

    await instance.api.toggleCamera();
    expect(instance.get().isCameraEnabled).toBe(false);

    await instance.api.toggleScreenShare();
    expect(instance.get().isScreenShareEnabled).toBe(true);

    instance.destroy();
    expect(mockRooms[0].disconnect).toHaveBeenCalled();
  });

  it("exposes slot attributes with echo prevention on local video", async () => {
    const instance = conference({
      id: "slot-room",
      serverUrl: "wss://livekit.example.com",
      token: "jwt-token",
    });

    await instance.api.connect();
    const local = instance.get().localParticipant!;
    const remote = {
      identity: "remote-doctor",
      getTrackPublication: () => undefined,
    } as never;

    const rootPart = instance.part("root", {});
    expect(rootPart).toBeDefined();

    const localVideoPart = conference.slots.video.attrs!(instance.get(), {
      id: "v1",
      key: "v1",
      props: { participant: local },
      api: instance.api,
    });
    expect(localVideoPart.muted).toBe("");
    expect(localVideoPart["data-source"]).toBe(Track.Source.Camera);

    const remoteVideoPart = conference.slots.video.attrs!(instance.get(), {
      id: "v2",
      key: "v2",
      props: { participant: remote },
      api: instance.api,
    });
    expect(remoteVideoPart.muted).toBeUndefined();

    instance.destroy();
  });
});

describe("createConferenceController", () => {
  beforeEach(() => {
    mockRooms.length = 0;
  });

  it("starts and ends calls imperatively and notifies subscribers", async () => {
    const controller = createConferenceController({
      serverUrl: "wss://livekit.example.com",
    });

    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    await controller.start("token-123");

    expect(mockRooms[0].connect).toHaveBeenCalledWith(
      "wss://livekit.example.com",
      "token-123"
    );
    expect(controller.getState().connectionState).toBe(ConnectionState.Connected);
    expect(listener).toHaveBeenCalled();

    await controller.end();
    expect(controller.getState().connectionState).toBe(
      ConnectionState.Disconnected
    );

    unsubscribe();
    controller.destroy();
  });
});
