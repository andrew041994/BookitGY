import { Platform } from "react-native";
import * as Sentry from "sentry-expo";

export const handleIncomingURL = (url) => {
  if (!url || typeof url !== "string") return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "bookitgy:" && parsed.hostname) {
      const combinedPath = `/${parsed.hostname}${parsed.pathname || ""}`.replace(
        /\/{2,}/g,
        "/"
      );
      const normalizedPath = combinedPath.replace(/^\/+/, "");
      return `${parsed.protocol}///${normalizedPath}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch (error) {
    try {
      Sentry.Native.captureException(error, {
        extra: {
          scope: "deep-link",
          url: `${url}`,
          platform: Platform.OS,
        },
      });
    } catch (captureErr) {
      console.log("[deepLinking] Failed to report error", captureErr?.message || captureErr);
    }

    console.log("[deepLinking] Invalid incoming URL", url, error?.message || error);
    return null;
  }
};
