import 'react-native-gesture-handler';
import * as Sentry from 'sentry-expo';
import Constants from 'expo-constants';
import { registerRootComponent } from 'expo';
import App from './App';

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

registerRootComponent(App);
