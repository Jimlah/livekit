import * as React from "react";
import {
  createParts,
  usePart,
  type PartProps,
  type PrimitiveHandle,
} from "@ui-sdk/react/primitive";
import type { ConnectionState } from "livekit-client";
import { conference, type ConferenceState } from "./conference.js";
import type { ConferenceController } from "./controller.js";

/**
 * Compound React components bound to the `conference` primitive:
 * `Conference.Root`, `Conference.Stage`, `Conference.Grid`, `Conference.Participant`,
 * `Conference.Video`, `Conference.Audio`, `Conference.Controls`,
 * `Conference.MicTrigger`, `Conference.CameraTrigger`,
 * `Conference.ScreenShareTrigger`, and `Conference.LeaveTrigger`.
 */
export const Conference = createParts(conference, {
  root: "div",
  stage: "section",
  grid: "div",
  participant: "div",
  video: "video",
  audio: "audio",
  controls: "div",
  micTrigger: "button",
  cameraTrigger: "button",
  screenShareTrigger: "button",
  leaveTrigger: "button",
});

/**
 * Subscribes a React component to an external `ConferenceController` (such as `CallSDK`)
 * and returns the latest reactive `ConferenceState`.
 */
export function useConferenceController(
  controller: ConferenceController
): ConferenceState {
  return React.useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );
}

export type ConferenceControllerRootProps = PartProps<
  "div",
  { connectionState: ConnectionState; hasScreenShare: boolean }
> & {
  /** External `ConferenceController` (such as `CallSDK`) to bind to this UI tree. */
  controller: ConferenceController;
};

/**
 * Binds an external `ConferenceController` (such as `CallSDK`) to the `root` slot
 * so all nested `Conference.*` compound components (`Conference.Grid`,
 * `Conference.Video`, `Conference.MicTrigger`, etc.) operate on the controller's live room.
 */
export function ConferenceControllerRoot({
  controller,
  ...props
}: ConferenceControllerRootProps): React.JSX.Element | null {
  const state = useConferenceController(controller);

  const handle = React.useMemo<PrimitiveHandle<typeof conference>>(
    () => ({
      primitive: conference,
      instance: controller._instance,
      get state() {
        return state;
      },
      api: controller._instance.api,
    }),
    [controller, state]
  );

  return usePart(handle, "root", {}, props, "div");
}
