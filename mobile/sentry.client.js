// sentry.client.js
import * as Sentry from "sentry-expo";

Sentry.init({
  dsn: process.env.SENTRY_DSN || "",
  enableInExpoDevelopment: false,
  debug: false,
});

// optional: export Sentry if you want to use it elsewhere
export { Sentry };
