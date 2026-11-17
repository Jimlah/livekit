import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
    ai: "src/ai.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "livekit-client",
    "@ui-sdk/core",
    "@ui-sdk/react",
    "ai",
    "@ai-sdk/react",
  ],
});
