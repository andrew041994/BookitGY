import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Sentry from "sentry-expo";

const TOKEN_KEY = "accessToken";
// const REFRESH_TOKEN_KEY = "refreshToken";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

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

export async function saveRefreshToken(token) {
  if (!token) return;
  // Always try SecureStore first
  try {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  } catch (e) {
    console.warn("[tokenStorage] SecureStore saveRefreshToken failed, falling back to AsyncStorage:", e);
  }

  // Always keep a fallback copy in AsyncStorage (helps when SecureStore read fails on cold start)
  try {
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch (e) {
    console.warn("[tokenStorage] AsyncStorage saveRefreshToken failed:", e);
  }
}

// export async function saveRefreshToken(token) {
//   if (!token) return;
//   try {
//     await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
//   } catch (err) {
//     reportStorageError("SecureStore.setItemAsync refresh failed", err);
//   }
// }

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

export async function loadRefreshToken() {
  // Try SecureStore first
  try {
    const t = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (t) return t;
  } catch (e) {
    console.warn("[tokenStorage] SecureStore loadRefreshToken failed, trying AsyncStorage:", e);
  }

  // Fallback to AsyncStorage
  try {
    const t2 = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    return t2 || null;
  } catch (e) {
    console.warn("[tokenStorage] AsyncStorage loadRefreshToken failed:", e);
    return null;
  }
}

// export async function loadRefreshToken() {
//   try {
//     return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
//   } catch (err) {
//     reportStorageError("SecureStore.getItemAsync refresh failed", err);
//     return null;
//   }
// }

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

export async function clearRefreshToken() {
  // Clear both to avoid half-states
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch (e) {
    // deleteItemAsync throws if it doesn't exist sometimes; ignore but log once
    console.warn("[tokenStorage] SecureStore clearRefreshToken failed:", e);
  }

  try {
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch (e) {
    console.warn("[tokenStorage] AsyncStorage clearRefreshToken failed:", e);
  }
}

// export async function clearRefreshToken() {
//   try {
//     await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
//   } catch (err) {
//     reportStorageError("SecureStore.deleteItemAsync refresh failed", err);
//   }
// }

export async function clearAllAuthTokens() {
  await clearToken();
  await clearRefreshToken();
}
