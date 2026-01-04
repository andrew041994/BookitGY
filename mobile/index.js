import 'react-native-gesture-handler';
import * as Sentry from 'sentry-expo';
import Constants from 'expo-constants';
import { registerRootComponent } from 'expo';
import App from './App';
import { initGlobalErrorHandling } from './src/utils/globalErrorHandler';

const sentryDsn =
  Constants?.expoConfig?.extra?.SENTRY_DSN ||
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  process.env.SENTRY_DSN ||
  "";

Sentry.init({
  dsn: sentryDsn,
  enableInExpoDevelopment: false,
  debug: false,
  tracesSampleRate: 0.15,
});

initGlobalErrorHandling(Sentry);

registerRootComponent(App);
