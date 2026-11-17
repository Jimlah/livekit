import { conference, type ConferenceOptions, type ConferenceState, type MediaDeviceKind } from "./conference.js";

export type ConferenceControllerOptions = Omit<ConferenceOptions, "token"> & {
  /** Optional unique ID for the underlying primitive instance. */
  id?: string;
};

export interface ConferenceController {
  /** Start or join a teleconference call imperatively from anywhere in JS/TS. */
  start: (token: string, serverUrl?: string) => Promise<void>;
  /** End the active teleconference call and disconnect from the LiveKit room. */
  end: () => Promise<void>;
  /** Update controller options (callbacks, serverUrl, autoEnableMedia, etc.). */
  configure: (options: Partial<ConferenceOptions>) => void;
  /** Toggle local microphone on/off. */
  toggleMic: () => Promise<void>;
  /** Toggle local camera on/off. */
  toggleCamera: () => Promise<void>;
  /** Toggle local screen share on/off. */
  toggleScreenShare: () => Promise<void>;
  /** Switch active audio/video input or audio output device. */
  switchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  /** Subscribe to reactive `ConferenceState` updates. */
  subscribe: (listener: () => void) => () => void;
  /** Read the current `ConferenceState` snapshot. */
  getState: () => ConferenceState;
  /** Destroy the underlying primitive instance and release all WebRTC resources. */
  destroy: () => void;
  /** Underlying `@ui-sdk/core` primitive instance for UI bindings. */
  readonly _instance: ReturnType<typeof conference>;
}

let controllerCounter = 0;

/**
 * Creates a standalone imperative teleconference controller backed by `conference(...)`.
 *
 * Decouples the LiveKit `Room` lifecycle from any specific UI component tree so calls
 * can be started, controlled, and ended from anywhere in your application (e.g. button
 * handlers, keyboard shortcuts, router guards, or WebSocket events), just like a
 * payment SDK (`stripe.confirmPayment()`, `paystack.newTransaction()`).
 */
export function createConferenceController(
  defaultOptions: ConferenceControllerOptions = {}
): ConferenceController {
  const id = defaultOptions.id ?? `smarthealth-conference-${++controllerCounter}`;
  let currentOptions: ConferenceOptions & { id: string } = {
    id,
    autoConnect: false,
    autoEnableMedia: true,
    ...defaultOptions,
  };

  const instance = conference(currentOptions);

  const updateOptions = (partial: Partial<ConferenceOptions>) => {
    currentOptions = { ...currentOptions, ...partial, id };
    instance.setOptions(currentOptions);
  };

  return {
    async start(token: string, serverUrl?: string) {
      updateOptions(serverUrl !== undefined ? { token, serverUrl } : { token });
      await instance.api.connect();
    },

    async end() {
      await instance.api.disconnect();
    },

    configure(options: Partial<ConferenceOptions>) {
      updateOptions(options);
    },

    toggleMic: () => instance.api.toggleMic(),
    toggleCamera: () => instance.api.toggleCamera(),
    toggleScreenShare: () => instance.api.toggleScreenShare(),
    switchDevice: (kind: MediaDeviceKind, deviceId: string) =>
      instance.api.switchDevice(kind, deviceId),

    subscribe: (listener: () => void) => instance.subscribe(listener),
    getState: () => instance.get(),
    destroy: () => instance.destroy(),

    _instance: instance,
  };
}

/**
 * Default singleton teleconference controller for imperative call management
 * anywhere in your application.
 */
export const CallSDK: ConferenceController = createConferenceController({
  id: "smarthealth-call-sdk",
  autoConnect: false,
  autoEnableMedia: true,
});
