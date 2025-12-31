import { Platform } from "react-native";

let parsedDsn = null;
let initOptions = {};

const parseDsn = (dsn) => {
  if (!dsn || typeof dsn !== "string") return null;

  try {
    const parsedUrl = new URL(dsn);
    const projectId = parsedUrl.pathname.replace(/^\/+/, "");
    if (!projectId) return null;

    return {
      protocol: parsedUrl.protocol,
      host: parsedUrl.host,
      projectId,
      publicKey: parsedUrl.username,
    };
  } catch (err) {
    console.log("[sentry-expo] Failed to parse DSN", err?.message || err);
    return null;
  }
};

const buildAuthHeader = (dsnParts) => {
  if (!dsnParts?.publicKey) return null;
  return `Sentry sentry_version=7, sentry_key=${dsnParts.publicKey}, sentry_client=bookitgy-mobile/1.0`;
};

const sendToSentry = async (payload) => {
  if (!parsedDsn) return;
  try {
    const endpoint = `${parsedDsn.protocol}//${parsedDsn.host}/api/${parsedDsn.projectId}/store/`;
    const authHeader = buildAuthHeader(parsedDsn);
    const headers = {
      "Content-Type": "application/json",
    };

    if (authHeader) headers["X-Sentry-Auth"] = authHeader;

    await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.log("[sentry-expo] Failed to send event", err?.message || err);
  }
};

const baseEventPayload = () => ({
  platform: "javascript",
  environment: initOptions?.environment || (initOptions?.enableInExpoDevelopment === false && __DEV__ ? "development" : "production"),
  release: initOptions?.release,
  contexts: { device: { platform: Platform.OS } },
});

const captureException = (error, options = {}) => {
  const message = error?.message || String(error || "Unknown error");
  const event = {
    ...baseEventPayload(),
    level: "error",
    message,
    extra: options.extra,
    tags: options.tags,
  };

  if (error?.stack) {
    event.extra = {
      ...(event.extra || {}),
      stack: error.stack,
    };
  }

  sendToSentry(event);
};

const captureMessage = (message, options = {}) => {
  const event = {
    ...baseEventPayload(),
    level: options.level || "info",
    message: String(message),
    extra: options.extra,
    tags: options.tags,
  };

  sendToSentry(event);
};

export const init = (options = {}) => {
  initOptions = options;
  parsedDsn = parseDsn(options.dsn);
};

export const Native = {
  captureException,
  captureMessage,
};

export default {
  init,
  captureException,
  captureMessage,
  Native,
};
