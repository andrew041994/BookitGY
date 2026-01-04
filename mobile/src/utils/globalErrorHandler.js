import { Alert, Platform } from "react-native";

/**
 * Registers a single global error handler that captures fatal JS exceptions
 * in release builds without letting them bubble up to RCTFatal.
 */
export function initGlobalErrorHandling(Sentry) {
  const client = Sentry?.Native || Sentry;
  const previousHandler =
    typeof ErrorUtils?.getGlobalHandler === "function"
      ? ErrorUtils.getGlobalHandler()
      : null;

  if (typeof ErrorUtils?.setGlobalHandler !== "function") return;

  ErrorUtils.setGlobalHandler((error, isFatal) => {
    try {
      client?.captureException?.(error, {
        level: isFatal ? "fatal" : "error",
        extra: {
          scope: "global-handler",
          platform: Platform.OS,
          isFatal,
        },
      });
    } catch (captureErr) {
      console.log("[globalErrorHandler] Failed to send to Sentry", captureErr);
    }

    if (__DEV__) {
      previousHandler?.(error, isFatal);
    } else {
      console.log("[globalErrorHandler] Captured", error?.message || error);
      if (isFatal) {
        Alert.alert(
          "Something went wrong",
          "We hit an unexpected error. Please restart the app and try again."
        );
      }
    }
  });
}

