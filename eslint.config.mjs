// Expo's own flat config (React, hooks, TypeScript, import rules), as the web uses Next's.
import expo from "eslint-config-expo/flat.js";

export default [
  ...expo,
  { ignores: ["dist-check/**", ".expo/**"] },
  // The release scripts run under Node, not in the app.
  {
    files: [".github/scripts/**/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly", process: "readonly", console: "readonly" } },
    // Expo inlines env vars only in app code; Node reads process.env at run time.
    rules: { "expo/no-env-var-destructuring": "off" },
  },
];
