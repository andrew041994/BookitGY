import Constants from "expo-constants";
import { createApiClient } from "./client";

// Same API logic you already use in App.js
const API =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL ||
  "https://bookitgy.onrender.com";

// This keeps refresh working everywhere.
// NOTE: onUnauthorized can only log here (no navigation/state access).
export const apiClient = createApiClient({
  baseURL: API,
  onUnauthorized: async ({ sessionExpired }) => {
    console.log("[auth] unauthorized", { sessionExpired });
    // Tokens are already cleared inside client.js on refresh failure.
    // Your UI should react to "no token" / unauthenticated state.
  },
});
