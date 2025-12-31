import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Sentry from "sentry-expo";

const TOKEN_KEY = "accessToken";

const reportStorageError = (stage, err) => {
  const message = err?.message || err;
  console.log(`[tokenStorage] ${stage}`, message);

  try {
    Sentry.Native.captureException(err, {
      extra: {
        scope: "tokenStorage",
        stage,
      },
    });
  } catch (captureErr) {
    console.log(
      "[tokenStorage] Unable to send error to Sentry",
      captureErr?.message || captureErr
    );
  }
};

export async function saveToken(token) {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return;
  } catch (err) {
    reportStorageError("SecureStore.setItemAsync failed, falling back", err);
  }

  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.log("[tokenStorage] AsyncStorage.setItem failed", err?.message || err);
  }
}

export async function loadToken() {
  try {
    const secureToken = await SecureStore.getItemAsync(TOKEN_KEY);
    if (secureToken) return secureToken;
  } catch (err) {
    reportStorageError("SecureStore.getItemAsync failed, trying AsyncStorage", err);
  }

  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (err) {
    reportStorageError("AsyncStorage.getItem failed", err);
    return null;
  }
}

export async function clearToken() {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  } catch (err) {
    reportStorageError("SecureStore.deleteItemAsync failed, falling back", err);
  }

  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    reportStorageError("AsyncStorage.removeItem failed", err);
  }
}
