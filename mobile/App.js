import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Text,
  View,
  StyleSheet,
  TextInput,
  Button,
  Alert,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Switch,
  Linking,
  Platform,
  Image,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Pressable,
  RefreshControl,
  Share,
  Modal,
  FlatList,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import {
  NavigationContainer,
  CommonActions,
  useFocusEffect,
  useIsFocused,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearToken,
  clearAllAuthTokens,
  loadToken,
  saveRefreshToken,
  saveToken,
} from "./src/components/tokenStorage";
import ProviderCard from "./src/components/ProviderCard";
import { createApiClient } from "./src/api/client";
import * as Location from "expo-location";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import {
  CalendarProvider,
  Calendar,
} from "react-native-calendars";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
// import { AccessToken, LoginManager } from "react-native-fbsdk-next";
import BookitGYLogoTransparent from "./assets/bookitgy-logo-transparent.png"
import { theme } from "./src/theme";
// import * as Sentry from "sentry-expo";

let Clipboard = null;
try {
  Clipboard = require("expo-clipboard");
} catch (e) {}

enableScreens(false);




// import { API } from "./App"; // wherever you define your base URL





const API =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL ||
  "https://bookitgy.onrender.com";

  console.log("### API base URL =", API);

const colors = theme.colors;
const HEADER_LOGO_WIDTH = 120;
const HEADER_LOGO_HEIGHT = 120;
const HEADER_VERTICAL_PADDING = 0;

// status color mapping
const getAppointmentStatusThemeKey = (statusValue) => {
  const normalized = `${statusValue || ""}`.trim().toLowerCase();
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("complete")) return "completed";
  return "scheduled";
};

const APPOINTMENT_STATUS_THEME = {
  scheduled: {
    accent: "#4DA3FF",
    bgTint: "rgba(77,163,255,0.10)",
    border: "rgba(77,163,255,0.35)",
  },
  completed: {
    accent: "#2ECC71",
    bgTint: "rgba(46,204,113,0.10)",
    border: "rgba(46,204,113,0.35)",
  },
  cancelled: {
    accent: "#FF4D4F",
    bgTint: "rgba(255,77,79,0.10)",
    border: "rgba(255,77,79,0.35)",
  },
};

const withTimeout = (promise, ms, label) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label || "Operation"} timed out after ${ms}ms`);
      error.code = "ETIMEDOUT";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
};

const AUTH_BOOTSTRAP_WATCHDOG_MS = 15000;
const AUTH_TOKEN_TIMEOUT_MS = 10000;
const AUTH_ME_TIMEOUT_MS = 12000;
const FB_COMPLETE_ERROR_MESSAGES = {
  EMAIL_REQUIRED: "Please provide an email address to continue.",
  PHONE_REQUIRED: "Please provide your phone number to continue.",
  PHONE_TAKEN: "This phone number is already in use.",
  FB_TOKEN_INVALID: "Facebook login session expired. Please try again.",
};

const normalizeErrorCode = (payload) => {
  if (!payload) return null;
  const detailCode = payload?.detail?.code;
  if (typeof detailCode === "string") return detailCode;
  if (typeof payload?.code === "string") return payload.code;
  if (typeof payload?.detail === "string") return payload.detail;
  return null;
};

const getFacebookCompleteErrorMessage = (code) =>
  FB_COMPLETE_ERROR_MESSAGES[code] || "Unable to complete Facebook login. Please try again.";

const persistFacebookSession = async ({
  responseData,
  setToken,
  setIsAdmin,
}) => {
  await saveToken(responseData.access_token);
  await saveRefreshToken(responseData.refresh_token);

  let meData = null;
  try {
    const meRes = await axios.get(`${API}/users/me`, {
      headers: { Authorization: `Bearer ${responseData.access_token}` },
    });
    meData = meRes.data;
  } catch (meError) {
    console.log("[auth] Failed to fetch /users/me after Facebook login", meError?.message || meError);
  }

  setToken({
    token: responseData.access_token,
    userId: meData?.id || meData?.user_id || responseData.user_id,
    email: meData?.email || responseData.email,
    username: meData?.username,
    isProvider:
      typeof meData?.is_provider === "boolean"
        ? meData?.is_provider
        : responseData.is_provider,
    isAdmin:
      typeof meData?.is_admin === "boolean" ? meData?.is_admin : responseData.is_admin,
  });

  setIsAdmin(
    typeof meData?.is_admin === "boolean" ? meData?.is_admin : !!responseData.is_admin
  );
};
  const isValidEmail = (value) => {
  const trimmed = value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
};

const isValidUsername = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
};

const normalizeSearchValue = (value) =>
  String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();

const resolveImageUrl = (url) => {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    const normalizedPath = url.startsWith("/") ? url : `/${url}`;
    return `${API}${normalizedPath}`;
  };

const toNum = (value) => {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
};

function formatTimeRange(start, end) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return "--:--";
  const fmt = (d) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(" ", "");
  if (end instanceof Date && !Number.isNaN(end.getTime())) {
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return `${fmt(start)} – --:--`;
}

const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return null;
  }
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Number.isFinite(distance) ? distance : null;
};

function dedupeById(list) {
  const map = new Map();
  for (const item of list || []) {
    const k = item?.id != null ? String(item.id) : null;
    if (!k) continue;
    map.set(k, item);
  }
  return Array.from(map.values());
}

const getProviderCoords = (provider) => {
  const location = provider?.location;
  const pinnedLocation = provider?.pinned_location ?? provider?.pinnedLocation;
  const coords = provider?.coords;
  const getCoordsFrom = (source) => {
    const lat = toNum(source?.lat ?? source?.latitude);
    const lng = toNum(source?.long ?? source?.lng ?? source?.longitude);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  };

  const fromPinned = getCoordsFrom(pinnedLocation);
  if (fromPinned) return fromPinned;

  const fromLocation = getCoordsFrom(location);
  if (fromLocation) return fromLocation;

  const fromProvider = getCoordsFrom(provider);
  if (fromProvider) return fromProvider;

  const fromUser = getCoordsFrom(provider?.user);
  if (fromUser) return fromUser;
  const fromCoords = getCoordsFrom(coords);
  if (fromCoords) return fromCoords;

  const legacyLat = toNum(
    provider?.pinned_lat ??
      provider?.pinnedLatitude ??
      provider?.location_lat ??
      provider?.locationLat
  );
  const legacyLng = toNum(
    provider?.pinned_long ??
      provider?.pinned_lng ??
      provider?.pinnedLongitude ??
      provider?.location_lng ??
      provider?.locationLng ??
      provider?.lon
  );
  if (legacyLat != null && legacyLng != null) {
    return { lat: legacyLat, lng: legacyLng };
  }

  return null;
};

const LEGACY_ACCESS_TOKEN_KEY = "accessToken";

const getAuthToken = async (tokenState) => {
  if (tokenState?.token) return tokenState.token;

  try {
    const secure = await withTimeout(loadToken(), 1500, "loadToken");
    if (secure) return secure;
  } catch (error) {
    console.log("[auth] Failed to load secure token", error?.message || error);
  }

  try {
    const legacy = await withTimeout(
      AsyncStorage.getItem(LEGACY_ACCESS_TOKEN_KEY),
      1500,
      "loadLegacyToken"
    );
    return legacy || null;
  } catch (error) {
    console.log("[auth] Failed to load legacy token", error?.message || error);
    return null;
  }
};

const FAVORITES_STORAGE_KEY = (userKey) =>
  userKey ? `favoriteProviders:${userKey}` : "favoriteProviders";

const getProviderId = (provider) =>
  provider?.provider_id ?? provider?.id ?? provider?._id ?? null;

const RESERVED_USERNAME_PATHS = new Set([
  "u",
  "privacy",
  "terms",
  "download",
  "login",
  "signup",
  "forgot",
  "reset",
]);

function extractUsernameFromUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;

  // Strip query string or hash before parsing.
  const withoutQuery = trimmed.split(/[?#]/)[0];
  let pathname = withoutQuery;

  if (/^https?:\/\//i.test(withoutQuery)) {
    // Strip protocol + host, keep only path.
    const withoutProtocol = withoutQuery.replace(/^https?:\/\//i, "");
    const slashIndex = withoutProtocol.indexOf("/");
    pathname = slashIndex === -1 ? "/" : withoutProtocol.slice(slashIndex);
  } else {
    const schemeMatch = withoutQuery.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
    if (schemeMatch) {
      // Strip custom scheme and treat remainder as path.
      pathname = `/${withoutQuery.slice(schemeMatch[0].length)}`;
    }
  }

  if (!pathname.startsWith("/")) {
    pathname = `/${pathname}`;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let username = null;

  if (segments[0] === "u" && segments[1]) {
    username = segments[1];
  } else if (segments.length === 1 && !RESERVED_USERNAME_PATHS.has(segments[0])) {
    username = segments[0];
  }

  if (!username) return null;

  let decoded = username;
  try {
    decoded = decodeURIComponent(username);
  } catch (error) {
    decoded = username;
  }

  const cleaned = decoded.trim().replace(/^@/, "");
  if (!cleaned || !isValidUsername(cleaned)) return null;
  return cleaned;
}

function buildProviderPublicLink(username) {
  const trimmed = String(username || "").trim();
  if (!trimmed) return null;
  return `https://bookitgy.com/u/${encodeURIComponent(trimmed)}`;
}



function findSearchTabNavigatorKey(state) {
  if (!state || !Array.isArray(state.routes)) return null;

  const routeNames = state.routes.map((r) => r?.name).filter(Boolean);

  const looksLikeClientTabs =
    routeNames.includes("Home") &&
    routeNames.includes("Search") &&
    routeNames.includes("Appointments") &&
    routeNames.includes("Profile");

  if (looksLikeClientTabs && state.key) return state.key;

  for (const route of state.routes) {
    const nestedKey = findSearchTabNavigatorKey(route?.state);
    if (nestedKey) return nestedKey;
  }
  return null;
}




function useFavoriteProviders(userKey) {
  const storageKey = FAVORITES_STORAGE_KEY(userKey);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [favoriteProviders, setFavoriteProviders] = useState([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);

  const persistIds = useCallback(async (ids) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(ids));
    } catch (err) {
      console.log("Error saving favorites", err?.message || err);
    }
  }, [storageKey]);

  const loadFavoritesFromStorage = useCallback(async () => {
    try {
      setFavoritesLoading(true);
      const raw = await AsyncStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setFavoriteIds(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.log("Error reading favorites", err?.message || err);
      setFavoriteIds([]);
    } finally {
      setFavoritesLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    setFavoriteIds([]);
    setFavoriteProviders([]);
    loadFavoritesFromStorage();
  }, [loadFavoritesFromStorage]);

  const syncFavoritesFromList = useCallback(
    (list) => {
      if (!Array.isArray(list)) return;

      setFavoriteProviders((prev) => {
        const idSet = new Set(favoriteIds);
        const merged = list.filter((p) => idSet.has(getProviderId(p)));

        const prevMap = new Map(
          prev.map((p) => [getProviderId(p), p]).filter(([id]) => idSet.has(id))
        );

        merged.forEach((p) => {
          const id = getProviderId(p);
          if (id) prevMap.set(id, p);
        });

        return Array.from(prevMap.values());
      });
    },
    [favoriteIds]
  );

  const refreshFavoriteProviders = useCallback(async () => {
    if (!favoriteIds.length) {
      setFavoriteProviders([]);
      return;
    }

    try {
      const res = await axios.get(`${API}/providers`);
      const list = Array.isArray(res.data)
        ? res.data
        : res.data?.providers || [];

      const idSet = new Set(favoriteIds);
      setFavoriteProviders(list.filter((p) => idSet.has(getProviderId(p))));
    } catch (err) {
      console.log(
        "Error refreshing favorite providers",
        err?.response?.data || err?.message
      );
    }
  }, [favoriteIds]);

  useEffect(() => {
    if (favoritesLoading) return;
    refreshFavoriteProviders();
  }, [favoriteIds, favoritesLoading, refreshFavoriteProviders]);

  const toggleFavorite = useCallback(
    (provider) => {
      const id = getProviderId(provider);
      if (!id) return;

      setFavoriteIds((prev) => {
        const already = prev.includes(id);
        const next = already ? prev.filter((x) => x !== id) : [...prev, id];
        persistIds(next);
        return next;
      });

      setFavoriteProviders((prev) => {
        const exists = prev.some((p) => getProviderId(p) === id);
        if (exists) {
          return prev.filter((p) => getProviderId(p) !== id);
        }
        return [...prev, provider];
      });
    },
    [persistIds]
  );

  const isFavorite = useCallback(
    (provider) => {
      const id = typeof provider === "object" ? getProviderId(provider) : provider;
      return favoriteIds.includes(id);
    },
    [favoriteIds]
  );

  return {
    favoriteIds,
    favoriteProviders,
    favoritesLoading,
    toggleFavorite,
    isFavorite,
    syncFavoritesFromList,
    refreshFavoriteProviders,
  };
}


// ✅ add this block:


let MapView;
let Marker;

if (Platform.OS !== "web") {
  const { default: MV, Marker: MK } = require("react-native-maps");
  MapView = MV;
  Marker = MK;
} else {
  MapView = (props) => <View {...props} />;
  Marker = (props) => <View {...props} />;
}



const PROFESSION_OPTIONS = [
  "Barber",
  "Hairdresser",
  "Hairstylist",
  "Braider",
  "Loctician (dreadlocks)",
  "Nail Technician",
  "Manicurist",
  "Pedicurist",
  "Makeup Artist (MUA)",
  "Lash Technician",
  "Brow Technician",
  "Esthetician / Skin Care",
  "Waxing Specialist",
  "Sugaring Specialist",
  "Massage Therapist",
  "Spa Therapist",
  "Facialist",
  "Beard Specialist",
  "Men's Grooming Specialist",
];

const Tab = createBottomTabNavigator();

// 🔹 New landing/home screen shown BEFORE login
function LandingScreen({ goToLogin, goToSignup }) {
  return (
    <View style={styles.container}>
     <View style={{ alignItems: "center", marginBottom: 40, marginTop: 60 }}>
      <Image
        source={BookitGYLogoTransparent}
        style={{
          width: 360,
          height: 360,
          resizeMode: "contain",
          opacity: 0.96,
        }}
      />
      </View>
        <Text
          style={styles.subtitle}
          allowFontScaling={false}
        >
          Find and book services in {"\n"}Guyana
        </Text>
        

          <View style={{ marginTop: 30, width: "100%" }}>
            <TouchableOpacity
              style={styles.authPrimaryButton}
              onPress={goToLogin}
            >
              <Text style={styles.authPrimaryButtonText}>LOGIN</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.authSecondaryButton}
              onPress={goToSignup}
            >
              <Text style={styles.authSecondaryButtonText}>SIGN UP</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

// 🔹 Dedicated login screen component
const ENABLE_FACEBOOK_AUTH = process.env.EXPO_PUBLIC_ENABLE_FACEBOOK_AUTH === "true";

function LoginScreen({
  setToken,
  setIsAdmin,
  onFacebookSetupRequired,
  goToSignup,
  goToForgot,
  goBack,
  showFlash,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);


  const login = async () => {
    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      if (showFlash) {
        showFlash("error", "Please enter a valid email address");
      } else {
        Alert.alert("Error", "Please enter a valid email address");
      }
      return;
  }

  setLoading(true);

    try {
      const body = new URLSearchParams({
        username: normalizedEmail,
        password: password,
      }).toString();

    const res = await axios.post(`${API}/auth/login`, body, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

    try {
      await saveToken(res.data.access_token);
      await saveRefreshToken(res.data.refresh_token);
      const persistedToken = await loadToken();
      console.log("[auth] login success -> token saved:", Boolean(persistedToken));
      if (!persistedToken) {
        Alert.alert(
          "Save issue",
          "We couldn't save your login securely. You'll stay logged in for now."
        );
      }
    } catch (err) {
      console.error(
        "[LOGIN_NATIVE_CRASH_GUARD] Failed to persist access token",
        err
      );
      // Sentry.Native.captureException(err, {
      //   extra: { scope: "token-persistence" },
      // });
      Alert.alert(
        "Save issue",
        "We couldn't save your login securely. You'll stay logged in for now."
      );
    }

    let meData = null;
    try {
      const meRes = await axios.get(`${API}/users/me`, {
        headers: {
          Authorization: `Bearer ${res.data.access_token}`,
        },
      });
      meData = meRes.data;
    } catch (meError) {
      console.log("[auth] Failed to fetch /users/me after login", meError?.message || meError);
    }

    // Successful login
      setToken({
        token: res.data.access_token,
        userId: meData?.id || meData?.user_id || res.data.user_id,
        email: meData?.email || res.data.email,
        username: meData?.username,
        isProvider: typeof meData?.is_provider === "boolean" ? meData?.is_provider : res.data.is_provider,
        isAdmin: typeof meData?.is_admin === "boolean" ? meData?.is_admin : res.data.is_admin,
      });

      setIsAdmin(
        typeof meData?.is_admin === "boolean" ? meData?.is_admin : !!res.data.is_admin
      );

    if (showFlash) {
        showFlash("success", "Logged in successfully");
      }
    } catch (e) {
      console.log("Login error:", e.response?.data || e.message);
      if (showFlash) {
        showFlash(
          "error",
          "Login failed: wrong email/password or server unreachable"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const loginWithFacebook = async () => {
    setFacebookLoading(true);
    try {
      const loginResult = await LoginManager.logInWithPermissions([
        "public_profile",
        "email",
      ]);

      if (loginResult?.isCancelled) {
        return;
      }

      const accessTokenData = await AccessToken.getCurrentAccessToken();
      const facebookAccessToken = accessTokenData?.accessToken;

      if (!facebookAccessToken) {
        showFlash?.("error", "Could not get Facebook access token. Please try again.");
        return;
      }

      const payload = {
        facebook_access_token: facebookAccessToken,
        phone: "",
        is_provider: false,
      };

      try {
        const res = await axios.post(`${API}/auth/facebook/complete`, payload);
        await persistFacebookSession({
          responseData: res.data,
          setToken,
          setIsAdmin,
        });
        showFlash?.("success", "Logged in successfully");
      } catch (requestError) {
        const errorCode = normalizeErrorCode(requestError?.response?.data);
        if (errorCode === "EMAIL_REQUIRED" || errorCode === "PHONE_REQUIRED") {
          onFacebookSetupRequired?.({
            facebookAccessToken,
            requiresEmail: errorCode === "EMAIL_REQUIRED",
            requiresPhone: true,
            initialPhone: "",
            initialEmail: "",
            initialIsProvider: false,
          });
          return;
        }

        showFlash?.("error", getFacebookCompleteErrorMessage(errorCode));
      }
    } catch (error) {
      console.log("Facebook login error:", error?.response?.data || error?.message || error);
      showFlash?.("error", "Facebook login failed. Please try again.");
    } finally {
      setFacebookLoading(false);
    }
  };

return (
    <KeyboardAvoidingView
      style={styles.avoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0} // tweak if needed

    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.logoWrapper}>
              <Image
                source={BookitGYLogoTransparent}
                style={styles.logo}
              />
            </View>
        <Text style={styles.title}>Login</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={styles.inputPlaceholder.color}
          value={email}
          autoCapitalize="none"
          onChangeText={setEmail}
        />

        <TextInput
          style={[
            styles.input,
            Platform.OS === "android" && {
              fontFamily: "sans-serif",
              letterSpacing: 0,
              includeFontPadding: false,
            },
          ]}
          placeholder="Password"
          placeholderTextColor={styles.inputPlaceholder.color}
          value={password}
          onChangeText={setPassword}
          textContentType="password"
          autoComplete="password"
          importantForAutofill="yes"
          secureTextEntry={true}
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          underlineColorAndroid="transparent"
          selectionColor={colors.primary}
          cursorColor={colors.primary}
        />

          {goToSignup && (
            <View style={{ width: "100%", marginBottom: 10 }}>
               {loading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <Button title="Login" onPress={login} color={colors.primary} />
              )}
            </View>
          )}

          {ENABLE_FACEBOOK_AUTH && (
            <View style={{ width: "100%", marginBottom: 12 }}>
              {facebookLoading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <TouchableOpacity
                  style={styles.facebookButton}
                  onPress={loginWithFacebook}
                >
                  <Text style={styles.facebookButtonText}>Continue with Facebook</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {goToForgot && (
            <TouchableOpacity onPress={goToForgot} style={styles.forgotLink}>
              <Text
                style={styles.forgotLinkText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                Forgot password?
              </Text>
            </TouchableOpacity>
          )}

            {goToSignup && (
              <View style={{ width: "100%", marginBottom: 10 }}>
                <Button
                  title="Need an account? Sign Up"
                  onPress={goToSignup}
                  color={colors.primary}
                />
              </View>
            )}

            {goBack && (
              <View style={{ width: "100%" }}>
                <Button title="Back" onPress={goBack} color={colors.textMuted} />
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );

}


function ForgotPasswordScreen({ goToLogin, goBack, showFlash }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [devResetLink, setDevResetLink] = useState(null);

  const requestReset = async () => {
    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      showFlash?.("error", "Please enter a valid email address");
      return;
    }

    setSubmitting(true);
    setDevResetLink(null);

    try {
      const res = await axios.post(`${API}/auth/forgot-password`, {
        email: normalizedEmail,
      });
      const message =
        res.data?.message ||
        "If an account exists for that email, a reset link has been sent.";

      showFlash?.("success", message);

      if (res.data?.reset_link) {
        setDevResetLink(res.data.reset_link);
      }
    } catch (err) {
      console.log("Forgot password error", err?.response?.data || err?.message);
      showFlash?.("error", "Unable to send reset email. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.avoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.logoWrapper}>
              <Image source={BookitGYLogoTransparent} style={styles.logo} />
            </View>

            <Text style={styles.title}>Forgot password</Text>
            <Text style={styles.subtitle}>
              Enter your account email. We'll send a link to reset your password.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <View style={{ width: "100%", marginBottom: 10 }}>
              <Button
                title={submitting ? "Sending..." : "Send reset link"}
                onPress={requestReset}
                color={colors.primary}
                disabled={submitting}
              />
            </View>

            {devResetLink && (
              <View style={{ width: "100%", marginBottom: 10 }}>
                <Text style={{ color: colors.textSecondary, marginBottom: 6 }}>
                  Dev reset link (only visible in dev):
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openURL(devResetLink)}
                  style={{ paddingVertical: 10 }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      textDecorationLine: "underline",
                    }}
                  >
                    {devResetLink}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {goToLogin && (
              <View style={{ width: "100%", marginBottom: 10 }}>
                <Button
                  title="Back to Login"
                  onPress={goToLogin}
                  color={colors.primary}
                />
              </View>
            )}

            {goBack && (
              <View style={{ width: "100%" }}>
                <Button title="Back" onPress={goBack} color={colors.textMuted} />
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FinishSetupScreen({
  facebookSetup,
  setToken,
  setIsAdmin,
  goBackToLogin,
  showFlash,
}) {
  const [phone, setPhone] = useState(facebookSetup?.initialPhone || "");
  const [email, setEmail] = useState(facebookSetup?.initialEmail || "");
  const [isProvider, setIsProvider] = useState(
    facebookSetup?.initialIsProvider || false
  );
  const [submitting, setSubmitting] = useState(false);

  const requiresEmail = !!facebookSetup?.requiresEmail;

  const submitFinishSetup = async () => {
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    if (!trimmedPhone) {
      showFlash?.("error", "Phone is required.");
      return;
    }

    if (requiresEmail && !trimmedEmail) {
      showFlash?.("error", "Email is required.");
      return;
    }

    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      showFlash?.("error", "Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        facebook_access_token: facebookSetup?.facebookAccessToken,
        phone: trimmedPhone,
        is_provider: isProvider,
      };

      if (trimmedEmail) {
        payload.email = trimmedEmail.toLowerCase();
      }

      const res = await axios.post(`${API}/auth/facebook/complete`, payload);
      await persistFacebookSession({
        responseData: res.data,
        setToken,
        setIsAdmin,
      });
      showFlash?.("success", "Logged in successfully");
    } catch (error) {
      const errorCode = normalizeErrorCode(error?.response?.data);
      showFlash?.("error", getFacebookCompleteErrorMessage(errorCode));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.avoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.title}>Finish setup</Text>

            <TextInput
              style={styles.input}
              placeholder="Phone"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            {requiresEmail && (
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={styles.inputPlaceholder.color}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            )}

            <Pressable
              style={({ pressed }) => [
                styles.toggleCard,
                pressed && styles.toggleCardPressed,
              ]}
              onPress={() => setIsProvider((prev) => !prev)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isProvider }}
            >
              <View style={styles.toggleTextGroup}>
                <Text style={styles.toggleLabel}>I’m a provider</Text>
              </View>
              <Switch value={isProvider} onValueChange={setIsProvider} />
            </Pressable>

            <View style={{ width: "100%", marginBottom: 10 }}>
              {submitting ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <Button
                  title="Continue"
                  onPress={submitFinishSetup}
                  color={colors.primary}
                />
              )}
            </View>

            <View style={{ width: "100%" }}>
              <Button title="Back" onPress={goBackToLogin} color={colors.textMuted} />
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}




function SignupScreen({ goToLogin, goBack, showFlash }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [isProvider, setIsProvider] = useState(false); // 👈 new
  const passwordRules = {
    length: password.length >= 5,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
  };
  const passwordStrong = Object.values(passwordRules).every(Boolean);
  const keyboardWrapperProps = {
    behavior: Platform.OS === "ios" ? "padding" : "height",
    keyboardVerticalOffset: Platform.OS === "ios" ? 40 : 0,
  };
  const signupValidation = useMemo(() => {
    const errors = {};
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();
    const phoneDigitsOnly = /^\d+$/;

    if (!trimmedUsername) errors.username = "Username is required";
    if (!trimmedEmail) {
      errors.email = "Email is required";
    } else if (!isValidEmail(trimmedEmail)) {
      errors.email = "Email is invalid";
    }
    if (!trimmedPhone) errors.phone = "Phone is required";
    if (!passwordStrong) {
      errors.password =
        "Password must be at least 5 characters and include 1 uppercase and 1 lowercase letter.";
    }
    if (!trimmedConfirm || trimmedConfirm !== trimmedPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    const signupIsValid =
      trimmedUsername.length > 0 &&
      trimmedEmail.length > 0 &&
      trimmedEmail.includes("@") &&
      isValidEmail(trimmedEmail) &&
      trimmedPhone.length > 0 &&
      phoneDigitsOnly.test(trimmedPhone) &&
      passwordStrong &&
      trimmedConfirm.length > 0 &&
      trimmedPassword === trimmedConfirm;

    return {
      errors,
      signupIsValid,
    };
  }, [username, email, phone, password, confirmPassword, passwordStrong]);
  const signupIsValid = signupValidation.signupIsValid;

  const signup = async () => {
    if (!signupIsValid) {
      if (!passwordStrong) {
        const message =
          "Password must be at least 5 characters and include 1 uppercase and 1 lowercase letter.";
        if (showFlash) {
          showFlash("error", message);
        } else {
          Alert.alert("Error", message);
        }
      }
      return;
    }

    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();
    const trimmedUsername = username.trim();
    const trimmedPhone = phone.trim();

    // ✅ All fields required
    if (
      !trimmedUsername ||
      !trimmedEmail ||
      !trimmedPhone ||
      !trimmedPassword ||
      !trimmedConfirm
    ) {
      if (showFlash) {
        showFlash("error", "Please fill in all fields");
      } else {
        Alert.alert("Error", "Please fill in all fields");
      }
      return;
    }

    // ✅ Passwords must match
    if (trimmedPassword !== trimmedConfirm) {
      if (showFlash) {
        showFlash("error", "Passwords do not match");
      } else {
        Alert.alert("Error", "Passwords do not match");
      }
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      if (showFlash) {
        showFlash("error", "Please enter a valid email address");
      } else {
        Alert.alert("Error", "Please enter a valid email address");
      }
      return;
    }

    // ✅ Normalize phone into WhatsApp format: whatsapp:+...
    let whatsappValue = trimmedPhone;

    // Strip existing 'whatsapp:' if user typed it
    if (whatsappValue.startsWith("whatsapp:")) {
      whatsappValue = whatsappValue.replace(/^whatsapp:/, "");
    }

    // Ensure it starts with +
    if (!whatsappValue.startsWith("+")) {
      // If it starts with 592, assume +592...
      if (whatsappValue.startsWith("592")) {
        whatsappValue = `+${whatsappValue}`;
      } else {
        // Fallback: just prefix +
        whatsappValue = `+${whatsappValue}`;
      }
    }

    // Final WhatsApp format
    whatsappValue = `whatsapp:${whatsappValue}`;

    try {
      await axios.post(`${API}/auth/signup`, {
        email: normalizedEmail,
        password: trimmedPassword,
        username: trimmedUsername,
        phone: trimmedPhone,          // plain phone as user entered
        location: "Georgetown",
        whatsapp: whatsappValue,      // normalized WhatsApp format
        is_provider: isProvider,      // tell backend this is a provider
      });

      if (showFlash) {
        showFlash("success", "Account created! Please verify email and log in.");
      } else {
        Alert.alert("Success", "Account created! Please verify email and log in.");
      }

      if (goToLogin) goToLogin();
    } catch (e) {
      console.log("Signup error:", e.response?.data || e.message);
      const detail = e.response?.data?.detail || "Signup failed. Try again.";
      if (showFlash) {
        showFlash("error", detail);
      } else {
        Alert.alert("Error", detail);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.avoider} {...keyboardWrapperProps}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <Text style={styles.title}>Create Account</Text>

            {/* Username Field */}
            <TextInput
              style={[
                styles.input,
                signupValidation.errors.username ? styles.inputError : null,
              ]}
              placeholder="Username"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={username}
              onChangeText={setUsername}
            />

            <TextInput
              style={[
                styles.input,
                signupValidation.errors.email ? styles.inputError : null,
              ]}
              placeholder="Email"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              style={[
                styles.input,
                signupValidation.errors.phone ? styles.inputError : null,
              ]}
              placeholder="Phone (592XXXXXXX)"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            {/* Provider toggle */}
            <Pressable
              style={({ pressed }) => [
                styles.toggleCard,
                pressed && styles.toggleCardPressed,
              ]}
              onPress={() => setIsProvider((prev) => !prev)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isProvider }}
            >
              <View style={styles.toggleTextGroup}>
                <Text style={styles.toggleLabel}>
                  Register as Service Provider
                </Text>
                <Text style={styles.toggleHelper}>
                  Turn this on if you offer services to clients.
                </Text>
              </View>
              <Switch value={isProvider} onValueChange={setIsProvider} />
            </Pressable>

            <TextInput
              style={[
                styles.input,
                signupValidation.errors.password ? styles.inputError : null,
                Platform.OS === "android" && {
                  fontFamily: "sans-serif",
                  letterSpacing: 0,
                  includeFontPadding: false,
                },
              ]}
              placeholder="Password"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={password}
              onChangeText={setPassword}
              textContentType="password"
              autoComplete="password"
              importantForAutofill="yes"
              secureTextEntry={true}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              underlineColorAndroid="transparent"
              selectionColor={colors.primary}
              cursorColor={colors.primary}
            />
            <View style={styles.passwordRequirements}>
              <Text
                style={[
                  styles.passwordRequirement,
                  passwordRules.length
                    ? styles.passwordRequirementMet
                    : styles.passwordRequirementUnmet,
                ]}
              >
                At least 5 characters
              </Text>
              <Text
                style={[
                  styles.passwordRequirement,
                  passwordRules.lower
                    ? styles.passwordRequirementMet
                    : styles.passwordRequirementUnmet,
                ]}
              >
                At least 1 lowercase letter
              </Text>
              <Text
                style={[
                  styles.passwordRequirement,
                  passwordRules.upper
                    ? styles.passwordRequirementMet
                    : styles.passwordRequirementUnmet,
                ]}
              >
                At least 1 uppercase letter
              </Text>
            </View>
            {signupValidation.errors.password && (
              <Text style={styles.inputErrorText}>
                {signupValidation.errors.password}
              </Text>
            )}

            <TextInput
              style={[
                styles.input,
                signupValidation.errors.confirmPassword ? styles.inputError : null,
                Platform.OS === "android" && {
                  fontFamily: "sans-serif",
                  letterSpacing: 0,
                  includeFontPadding: false,
                },
              ]}
              placeholder="Confirm Password"
              placeholderTextColor={styles.inputPlaceholder.color}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              textContentType="password"
              autoComplete="password"
              importantForAutofill="yes"
              secureTextEntry={true}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              underlineColorAndroid="transparent"
              selectionColor={colors.primary}
              cursorColor={colors.primary}
            />
            {signupValidation.errors.confirmPassword && (
              <Text style={styles.inputErrorText}>
                {signupValidation.errors.confirmPassword}
              </Text>
            )}

            <View style={{ width: "100%", marginBottom: 10 }}>
              {Platform.OS === "ios" ? (
                <TouchableOpacity
                  style={[
                    styles.signupTextButton,
                    !signupIsValid && styles.signupTextButtonDisabled,
                  ]}
                  onPress={signup}
                  disabled={!signupIsValid}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !signupIsValid }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.signupTextButtonText}>Sign Up</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.signupButton,
                    !signupIsValid && styles.signupButtonDisabled,
                  ]}
                  onPress={signup}
                  disabled={!signupIsValid}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !signupIsValid }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.signupButtonText}>Sign Up</Text>
                </TouchableOpacity>
              )}
            </View>

            {goToLogin && (
              <View style={{ width: "100%", marginBottom: 10 }}>
                <Button
                  title="Already have an account? Login"
                  onPress={goToLogin}
                  color={colors.primary}
                />
              </View>
            )}

            {goBack && (
              <View style={{ width: "100%" }}>
                <Button title="Back" onPress={goBack} color={colors.textMuted} />
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}



const ListRow = ({
   title,
   onPress,
   icon,
   isLast = false,
   disabled = false,
  }) => (
  <TouchableOpacity
    style={[
      styles.listRow,
      isLast && styles.listRowLast,
      disabled && styles.listRowDisabled,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <View style={styles.listRowLeft}>
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={colors.textMuted}
          style={styles.listRowIcon}
        />
      ) : null}
      <Text style={styles.listRowTitle}>{title}</Text>
    </View>
    <Text style={styles.listRowChevron}>›</Text>
  </TouchableOpacity>
);

// Placeholder screens so MainApp compiles — replace with your real ones
function ProfileScreen({ apiClient, authLoading, setToken, showFlash, token }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
   // NEW state for editing profile
  const [showEdit, setShowEdit] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editProfile, setEditProfile] = useState({
    full_name: "",
    username: "",
    phone: "",
    whatsapp: "",
    location: "",
  });
  // NEW state for "My bookings"
  const [showBookings, setShowBookings] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isProviderUser, setIsProviderUser] = useState(null);
  const canUseClipboard = Boolean(Clipboard?.setStringAsync);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const forceLogout = useCallback(
    async (flashMessage) => {
      try {
        await clearAllAuthTokens();
      } catch (err) {
        console.log("Error clearing token", err?.message || err);
      }
      try {
        await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
      } catch (err) {
        console.log("Error clearing legacy token", err?.message || err);
      }
      setUser(null);
      setAvatarUrl(null);
      if (setToken) {
        setToken(null);
      }
      if (flashMessage && showFlash) {
        showFlash("success", flashMessage);
      }
    },
    [setToken, showFlash]
  );


  const uploadAvatar = async (uri) => {
    try {
      const storedToken = await loadToken();
      if (!storedToken) {
        alert("No access token found. Please log in again.");
        return;
      }

      const filename = uri.split("/").pop() || "avatar.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1] : "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";

      const formData = new FormData();
      formData.append("file", {
        uri,
        name: filename,
        type: mimeType,
      });

      let isProvider = isProviderUser;

      if (typeof isProvider !== "boolean") {
        try {
          const meRes = await apiClient.get("/users/me");

          if (typeof meRes.data?.is_provider === "boolean") {
            isProvider = meRes.data.is_provider;
            setIsProviderUser(isProvider);
          }

          setUser((prev) => ({ ...(prev || {}), ...meRes.data }));
        } catch (fetchErr) {
          console.log(
            "Could not refresh user before avatar upload",
            fetchErr.response?.data || fetchErr.message
          );
        }
      }

      const endpoint =
        isProvider === true
          ? "/providers/me/avatar"
          : "/users/me/avatar";

      const res = await apiClient.post(endpoint, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const newUrl = res.data.avatar_url;

      // update avatar in this screen and shared user state
      setAvatarUrl(newUrl);
      setUser((prev) =>
        prev ? { ...prev, avatar_url: newUrl } : { avatar_url: newUrl }
      );
    } catch (err) {
      console.log(
        "Avatar upload error:",
        err.response?.data || err.message
      );
      alert("Failed to upload avatar. Please try again.");
    }
  };

  const pickClientAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        // ✅ This is the safe, supported form in your setup
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets && result.assets[0];
      if (!asset || !asset.uri) {
        return;
      }

    await uploadAvatar(asset.uri);
    } catch (err) {
      console.log("Image picker error:", err);
    }
  };



  const logout = async () => {
    try {
        await clearAllAuthTokens(); // ✅ clears access + refresh
      
        // Optional cleanup (keeps old installs from reviving stale tokens)
        try {
          await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
        } catch (e) {
          console.log("Error clearing legacy token", e?.message || e);
        }
      
        if (setToken) setToken(null);
      
        if (showFlash) showFlash("success", "Logged out successfully");
      } catch (err) {
        console.error("Error during logout", err);
        if (showFlash) showFlash("error", "Could not log out. Please try again.");
      }
    };


  // const logout = async () => {
  //   try {
  //     await clearToken();
  //     if (setToken) {
  //       setToken(null);
  //     }
  //     if (showFlash) {
  //       showFlash("success", "Logged out successfully");
  //     }
  //   } catch (err) {
  //     console.error("Error during logout", err);
  //     if (showFlash) {
  //       showFlash("error", "Could not log out. Please try again.");
  //     }
  //   }
  // };

  const handleDeleteAccountRequest = () => {
    Alert.alert(
      "Delete account?",
      "This will delete your account and remove all personal data associated with it. Your appointments and billing history may be retained for record-keeping. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            setDeletePassword("");
            setDeleteModalVisible(true);
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (deleteLoading) return;
    const trimmedPassword = deletePassword.trim();
    if (!trimmedPassword) {
      if (showFlash) {
        showFlash("error", "Please enter your password.");
      }
      return;
    }
    setDeleteLoading(true);
    try {
      await apiClient.post("/users/me/delete", {
        password: trimmedPassword,
      });
      setDeleteModalVisible(false);
      setDeletePassword("");
      await forceLogout("Account deleted.");
    } catch (err) {
      const message =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "Could not delete account.";
      if (showFlash) {
        showFlash("error", message);
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const loadProfile = useCallback(
    async (useRefresh = false) => {
      try {
        if (useRefresh) setRefreshing(true);
        setLoading(true);
        setError("");

        const storedToken = await loadToken();
        console.log("[profile] token present?", Boolean(storedToken));
        if (!storedToken) {
          setError("No access token found. Please log in again.");
          setLoading(false);
          return;
        }

        // 1) Load base user info
        const res = await apiClient.get("/users/me");
        if (
          res.data?.account_deleted === true ||
          res.data?.detail === "account_deleted"
        ) {
          await forceLogout();
          return;
        }

        setUser(res.data);
        if (typeof res.data.is_provider === "boolean") {
          setIsProviderUser(res.data.is_provider);
        }
        setEditProfile({
          full_name: res.data.full_name || "",
          username: res.data.username || "",
          phone: res.data.phone || "",
          whatsapp: res.data.whatsapp || "",
          location: res.data.location || "",
        });

        // 2) Try to get avatar
        let avatar = res.data.avatar_url || null;

        // If this user is a provider, also check provider profile
        if ((token && token.isProvider) || res.data.is_provider) {
          try {
            const provRes = await apiClient.get("/providers/me/profile");
            if (provRes.data.avatar_url) {
              avatar = provRes.data.avatar_url;
            }
          } catch (err) {
            console.log(
              "Error loading provider avatar for profile",
              err.response?.data || err.message
            );
          }
        }

        setAvatarUrl(avatar);
      } catch (err) {
        const shouldForceLogout =
          err?.response?.status === 401 ||
          err?.response?.status === 403 ||
          err?.response?.data?.detail === "account_deleted" ||
          err?.response?.data?.account_deleted === true;
        if (shouldForceLogout) {
          await forceLogout();
          return;
        }
        console.error("Error loading profile", err);
        setError("Could not load profile.");
        if (showFlash) {
          showFlash("error", "Could not load profile information.");
        }
      } finally {
        setLoading(false);
        if (useRefresh) setRefreshing(false);
      }
    },
    [apiClient, forceLogout, showFlash, token]
  );

  useEffect(() => {
    if (authLoading || !token?.token) return;
    loadProfile();
  }, [authLoading, loadProfile, token?.token]);

    const toggleEditProfile = () => {
    // ensure form reflects current user
    if (user && !showEdit) {
      setEditProfile({
        full_name: user.full_name || "",
        username: user.username || "",
        phone: user.phone || "",
        whatsapp: user.whatsapp || "",
        location: user.location || "",
      });
    }
    setShowEdit((prev) => !prev);
  };

  const saveProfileChanges = async () => {
    try {
      console.log("[profile] save changes pressed");
      setEditSaving(true);
      const storedToken = await loadToken();
      console.log("[profile] API base URL", API);
      if (!storedToken) {
        if (showFlash) showFlash("error", "No access token found. Please log in again.");
        return;
      }

      const trimmedUsername = String(editProfile.username || "").trim();
      if (trimmedUsername && !isValidUsername(trimmedUsername)) {
        if (showFlash) {
          showFlash(
            "error",
            "Username can only contain letters, numbers, dots, underscores, or dashes (no spaces)."
          );
        }
        return;
      }

      const payload = {
        full_name: editProfile.full_name,
        username: trimmedUsername,
        phone: editProfile.phone,
        whatsapp: editProfile.whatsapp,
        location: editProfile.location,
      };

      console.log("[profile] save payload", payload);
      console.log("[profile] auth token present", Boolean(storedToken));
      const res = await apiClient.put("/users/me", payload, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });
      console.log("[profile] save response status", res?.status);

      const meRes = await apiClient.get("/users/me");
      console.log("[profile] refresh response status", meRes?.status);

      setUser(meRes.data);
      setEditProfile({
        full_name: meRes.data?.full_name || "",
        username: meRes.data?.username || "",
        phone: meRes.data?.phone || "",
        whatsapp: meRes.data?.whatsapp || "",
        location: meRes.data?.location || "",
      });
      if (setToken) {
        setToken((prev) => ({
          ...(prev || {}),
          email: meRes.data?.email,
          username: meRes.data?.username,
          isProvider: !!meRes.data?.is_provider,
          isAdmin: !!meRes.data?.is_admin,
        }));
      }

      if (showFlash) showFlash("success", "Profile updated");
      setShowEdit(false);
    } catch (err) {
      console.log("[profile] error saving profile", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
      });
      const detail =
        err.response?.data?.detail || "Could not save profile changes.";
      if (showFlash) showFlash("error", detail);
    } finally {
      setEditSaving(false);
    }
  };


  const handleComingSoon = (label) => {
    if (showFlash) {
      showFlash("info", `${label} coming soon`);
    }
  };

  const openExternal = async (url) => {
    try {
      await Linking.openURL(url);
    } catch (err) {
      console.log("Error opening external link", err);
      showFlash?.("error", "Could not open link. Please try again.");
    }
  };

  const formatBookingDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatBookingTime = (iso) => {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes();
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
  };

  const loadMyBookings = useCallback(async () => {
    try {
      setBookingsLoading(true);
      setBookingsError("");

      const authToken = await getAuthToken(token);
      if (!authToken) {
        setBookingsError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/bookings/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const rawBookings = res.data;
      const bookingsList = Array.isArray(rawBookings)
        ? rawBookings
        : rawBookings?.bookings || rawBookings?.results || [];

      setBookings(bookingsList);
    } catch (err) {
      console.log("Error loading my bookings", err.response?.data || err.message);
      setBookingsError("Could not load your bookings.");
      if (showFlash) showFlash("error", "Could not load your bookings.");
    } finally {
      setBookingsLoading(false);
    }
  }, [showFlash]);

  const onRefresh = useCallback(async () => {
    await loadProfile(true);
    if (showBookings) {
      await loadMyBookings();
    }
  }, [loadMyBookings, loadProfile, showBookings]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>No user data.</Text>
      </View>
    );
  }

  const isAdmin = user.is_admin;
  const isProvider = user.is_provider;
  const role = isAdmin ? "Admin" : isProvider ? "Provider" : "Client";
  const hasContactDetails = Boolean(user.phone || user.location);
  const showActivityBookings = !isProvider;
  const toggleMyBookings = async () => {
    const next = !showBookings;
    setShowBookings(next);
    if (next) {
      await loadMyBookings();
    }
  };

  const handleClientCancelBooking = (bookingId) => {
    Alert.alert(
      "Cancel booking",
      "Are you sure you want to cancel this booking?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, cancel",
          style: "destructive",
          onPress: async () => {
            try {
              const authToken = await getAuthToken(token);
              if (!authToken) {
                if (showFlash)
                  showFlash("error", "No access token found. Please log in.");
                return;
              }

                  await axios.post(
                    `${API}/bookings/${bookingId}/cancel`,
                    {},
                    {
                      headers: { Authorization: `Bearer ${authToken}` },
                    }
                  );



              // update local state so UI reflects cancellation
              setBookings((prev) =>
                (prev || []).map((b) =>
                  b.id === bookingId ? { ...b, status: "cancelled" } : b
                )
              );

              if (showFlash) showFlash("success", "Booking cancelled");
            } catch (err) {
              console.log(
                "Error cancelling booking (client)",
                err.response?.data || err.message
              );
              if (showFlash) showFlash("error", "Could not cancel booking.");
            }
          },
        },
      ]
    );
  };

  const handleNavigateToBooking = (booking) => {
    try {
      let url = "";

      if (
        booking.provider_lat != null &&
        booking.provider_long != null
      ) {
        const dest = `${booking.provider_lat},${booking.provider_long}`;
        url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
      } else if (booking.provider_location) {
        const q = encodeURIComponent(booking.provider_location);
        url = `https://www.google.com/maps/search/?api=1&query=${q}`;
      } else {
        if (showFlash) {
          showFlash(
            "error",
            "No location is available yet for this booking."
          );
        }
        return;
      }

      Linking.openURL(url);
    } catch (err) {
      console.log("Error opening maps", err);
      if (showFlash) {
        showFlash("error", "Could not open maps on this device.");
      }
    }
  };

  const displayAvatarUrl = resolveImageUrl(avatarUrl || user?.avatar_url);
  const isProviderPublic =
    user?.is_provider === true || token?.is_provider === true;
  const providerPublicLink = buildProviderPublicLink(user?.username);
  const isProfileValid = Boolean(String(editProfile.username || "").trim());
  const isSaveDisabled = editSaving || !isProfileValid;

  const handleShareProviderLink = async () => {
    if (!providerPublicLink) {
      if (showFlash) {
        showFlash("error", "Set a username to enable your profile link.");
      }
      return;
    }

    try {
      await Share.share({
        message: `Book with me on BookitGY:`,
        url: providerPublicLink,
      });
    } catch (err) {
      console.log("Error sharing provider link", err?.message || err);
      if (showFlash) {
        showFlash("error", "Could not share your profile link.");
      }
    }
  };

  const handleCopyProviderLink = async () => {
    if (!providerPublicLink) {
      if (showFlash) {
        showFlash("error", "Set a username to enable your profile link.");
      }
      return;
    }

    try {
      await Clipboard.setStringAsync(providerPublicLink);
      if (showFlash) {
        showFlash("success", "Profile link copied.");
      }
    } catch (err) {
      console.log("Error copying provider link", err?.message || err);
      if (showFlash) {
        showFlash("error", "Could not copy your profile link.");
      }
    }
  };

  const handleTestProviderLink = async () => {
    if (!providerPublicLink) {
      if (showFlash) {
        showFlash("error", "Set a username to enable your profile link.");
      }
      return;
    }

    try {
      const supported = await Linking.canOpenURL(providerPublicLink);
      if (!supported) {
        throw new Error("Unsupported URL");
      }
      await Linking.openURL(providerPublicLink);
    } catch (err) {
      console.log("Error opening provider link", err?.message || err);
      if (showFlash) {
        showFlash("error", "Could not open your profile link.");
      }
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.profileScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.profileHeaderCard}>
        <View style={styles.profileIdentityRow}>
          <View style={styles.profileAvatarColumn}>
            <Pressable onPress={pickClientAvatar} style={styles.profileAvatarWrapper}>
              {displayAvatarUrl ? (
                <Image
                  source={{ uri: displayAvatarUrl }}
                  style={styles.profileAvatarImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.profileAvatarFallback}>
                  <Text style={styles.profileAvatarInitial}>
                    {(user.full_name || user.email || "C").charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </Pressable>
            <TouchableOpacity
              onPress={pickClientAvatar}
              style={styles.profileAvatarLink}
            >
              <Text style={styles.profileAvatarLinkText}>
                Change profile picture
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.profileIdentityText}>
            <Text style={styles.profileName}>
              {user.full_name || "My Profile"}
            </Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
            <View
              style={[
                styles.roleBadge,
                isAdmin
                  ? styles.roleBadgeAdmin
                  : isProvider
                  ? styles.roleBadgeProvider
                  : styles.roleBadgeClient,
              ]}
            >
              <Text style={styles.roleBadgeText}>{role}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* comment out profile links */}

      {/* {isProviderPublic && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Profile Link</Text>
          {providerPublicLink ? (
            <Text selectable style={styles.profileLinkText}>
              {providerPublicLink}
            </Text>
          ) : (
            <Text style={styles.profileLinkWarning}>
              Set a username to enable your profile link.
            </Text>
          )}

          <View style={styles.profileLinkActions}>
            <TouchableOpacity
              style={[
                styles.linkActionButton,
                !providerPublicLink && styles.linkActionButtonDisabled,
              ]}
              onPress={handleShareProviderLink}
              disabled={!providerPublicLink}
            >
              <Text style={styles.linkActionButtonText}>Share Link</Text>
            </TouchableOpacity>

            {canUseClipboard && (
              <TouchableOpacity
                style={[
                  styles.linkActionButton,
                  !providerPublicLink && styles.linkActionButtonDisabled,
                ]}
                onPress={handleCopyProviderLink}
                disabled={!providerPublicLink}
              >
                <Text style={styles.linkActionButtonText}>Copy Link</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.linkActionButton,
                !providerPublicLink && styles.linkActionButtonDisabled,
              ]}
              onPress={handleTestProviderLink}
              disabled={!providerPublicLink}
            >
              <Text style={styles.linkActionButtonText}>Test Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}  */}

      {hasContactDetails && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Contact</Text>
          {user.phone && (
            <>
              <Text style={styles.label}>Phone</Text>
              <Text style={styles.value}>{user.phone}</Text>
            </>
          )}

          {user.location && (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>Location</Text>
              <Text style={styles.value}>{user.location}</Text>
            </>
          )}
        </View>
      )}

      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>Account</Text>
        <View style={styles.sectionCard}>
          <ListRow
            title={showEdit ? "Hide edit profile" : "Edit profile"}
            icon="person-outline"
            onPress={toggleEditProfile}
          />
          <ListRow
            title="Payment methods"
            icon="card-outline"
            onPress={() => handleComingSoon("Payment methods")}
            isLast={!isAdmin}
          />
          {isAdmin && (
            <ListRow
              title="Admin dashboard"
              icon="shield-checkmark-outline"
              onPress={() => handleComingSoon("Admin dashboard")}
              isLast
            />
          )}
        </View>
      </View>

      {showEdit && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Edit profile</Text>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textSecondary}
            value={editProfile.username}
            onChangeText={(text) =>
              setEditProfile((prev) => ({
                ...prev,
                username: text.replace(/\s+/g, ""),
              }))
            }
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Phone"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            value={editProfile.phone}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, phone: text }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder="WhatsApp"
            placeholderTextColor={colors.textSecondary}
            value={editProfile.whatsapp}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, whatsapp: text }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder="Location (e.g. Georgetown)"
            placeholderTextColor={colors.textSecondary}
            value={editProfile.location}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, location: text }))
            }
          />

          <View style={{ width: "100%", marginTop: 8 }}>
            <Button
              title={editSaving ? "Saving..." : "Save changes"}
              onPress={saveProfileChanges}
              color={colors.primary}
              disabled={isSaveDisabled}
            />
          </View>
        </View>
      )}

      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>Activity</Text>
        <View style={styles.sectionCard}>
          {showActivityBookings && (
            <ListRow
              title={showBookings ? "Hide my bookings" : "My bookings"}
              icon="calendar-outline"
              onPress={toggleMyBookings}
              isLast={false}
            />
          )}
          <ListRow
            title="Favorites"
            icon="heart-outline"
            onPress={() => handleComingSoon("Favorites")}
            isLast
          />
        </View>
      </View>

      {showBookings && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>My bookings</Text>

          {!bookingsLoading &&
            !bookingsError &&
            bookings.length > 0 && (
              <>
                {bookings.map((b) => (
                  <View key={b.id} style={styles.myBookingRow}>
                    <View style={styles.bookingMain}>
                      <Text style={styles.bookingService}>{b.service_name}</Text>
                      {b.provider_location ? (
                        <Text style={styles.bookingMeta}>{b.provider_location}</Text>
                      ) : null}
                      <Text style={styles.bookingMeta}>Status: {b.status}</Text>
                    </View>

                    {b.status === "confirmed" && (
                      <View style={styles.myBookingActions}>
                        <View style={styles.navigateButtonContainer}>
                          <TouchableOpacity
                            style={styles.navigateButton}
                            onPress={() => handleNavigateToBooking(b)}
                          >
                            <Text style={styles.navigateButtonText}>Navigate</Text>
                          </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                          style={styles.myBookingCancelWrapper}
                          onPress={() => handleClientCancelBooking(b.id)}
                        >
                          <Text style={styles.bookingCancel}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
        </View>
      )}

      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>Support</Text>
        <View style={styles.sectionCard}>
          <ListRow
            title="Help"
            icon="help-circle-outline"
            onPress={() => openExternal("https://bookitgy.com/support")}
          />
          <ListRow
            title="Terms of service"
            icon="document-text-outline"
            onPress={() => openExternal("https://bookitgy.com/termsofservice")}
          />
          <ListRow
            title="Privacy policy"
            icon="lock-closed-outline"
            onPress={() => openExternal("https://bookitgy.com/privacy")}
            isLast
          />
        </View>
      </View>

      {isAdmin && (
        <View style={styles.adminBox}>
          <Text style={styles.adminTitle}>Admin tools</Text>
          <Text style={styles.adminText}>
            You are logged in as an admin. In future versions, this area will
            let you manage users, providers and bookings.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.deleteAccountRow}
        onPress={handleDeleteAccountRequest}
      >
        <Text style={styles.deleteAccountRowText}>Delete account</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutRow} onPress={logout}>
        <Text style={styles.logoutRowText}>Logout</Text>
      </TouchableOpacity>

      <Modal
        transparent
        animationType="fade"
        visible={deleteModalVisible}
        onRequestClose={() => {
          if (!deleteLoading) {
            setDeleteModalVisible(false);
          }
        }}
      >
        <TouchableWithoutFeedback
          onPress={() => {
            if (!deleteLoading) {
              setDeleteModalVisible(false);
            }
          }}
        >
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalCard}
              >
                <Text style={styles.modalTitle}>Confirm deletion</Text>
                <Text style={styles.modalMessage}>
                  Enter your password to delete your account.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  value={deletePassword}
                  editable={!deleteLoading}
                  onChangeText={setDeletePassword}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      deleteLoading && styles.modalButtonDisabled,
                    ]}
                    onPress={() => setDeleteModalVisible(false)}
                    disabled={deleteLoading}
                  >
                    <Text style={styles.modalButtonText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.modalDeleteButton,
                      deleteLoading && styles.modalButtonDisabled,
                    ]}
                    onPress={handleDeleteAccount}
                    disabled={deleteLoading}
                  >
                    {deleteLoading ? (
                      <ActivityIndicator color={colors.error} />
                    ) : (
                      <Text style={styles.modalDeleteButtonText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </ScrollView>
    
  );
  
}



function ClientHomeScreen({
  navigation,
  token,
  favoriteProviders,
  favoriteIds,
  favoritesLoading,
  toggleFavorite,
  isFavorite,
  syncFavoritesFromList,
  refreshFavoriteProviders,
  }) {
 const [nearbyProviders, setNearbyProviders] = useState([]);
  const [currentProvider, setCurrentProvider] = useState(null);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [nearbyError, setNearbyError] = useState("");
  const [clientLocation, setClientLocation] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const insets = useSafeAreaInsets();
  const headerPaddingVertical = HEADER_VERTICAL_PADDING;
  // const headerMinHeight =
  //   insets.top + HEADER_LOGO_HEIGHT + HEADER_VERTICAL_PADDING * 2;

  const quickCategories = useMemo(
    () => ["Barber", "Hair", "Nails", "Massage", "Makeup", "Lash", "Tutor"],
    []
  );

  // adding console log
  console.log("[home] token username fields", {
  tokenUsername: token?.username,
  tokenEmail: token?.email,
  tokenKeys: token ? Object.keys(token) : null,
  tokenUserKeys: token?.user ? Object.keys(token.user) : null,
});
  const greetingName = useMemo(() => {
    const username = token?.user?.username || token?.username;
    if (username?.trim()) return username.trim();
    const emailPrefix = token?.email?.split("@")?.[0];
    return emailPrefix?.trim() || "";
  }, [token?.email, token?.user?.username, token?.username]);

  const greetingText = greetingName ? `Hi, ${greetingName}` : "Hi";

  const haversineKm = (lat1, lon1, lat2, lon2) => {
    if (
      lat1 == null ||
      lon1 == null ||
      lat2 == null ||
      lon2 == null
    ) {
      return null;
    }
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getClientCoords = () => {
    if (!clientLocation) return null;
    const lat = toNum(clientLocation.lat ?? clientLocation.latitude);
    const lng = toNum(
      clientLocation.lng ?? clientLocation.long ?? clientLocation.longitude
    );
    if (lat == null || lng == null) return null;
    return { lat, lng };
  };

  const loadNearbyProviders = useCallback(async () => {
  let didSetLoading = false;
  const t0 = Date.now();

  try {
    setNearbyLoading(true);
    didSetLoading = true;
    setNearbyError("");
    setLocationDenied(false);

    // Permissions (don’t re-prompt unless needed)
    const perm = await Location.getForegroundPermissionsAsync();
    let status = perm?.status;
    if (status !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      status = req?.status;
    }
    if (status !== "granted") {
      setLocationDenied(true);
      setClientLocation(null);
      setNearbyProviders([]);
      setCurrentProvider(null);
      return;
    }

    // 1) Fast coords: last known -> stored
    let coords = null;

    try {
      const last = await Location.getLastKnownPositionAsync({});
      if (last?.coords?.latitude != null && last?.coords?.longitude != null) {
        coords = { lat: toNum(last.coords.latitude), long: toNum(last.coords.longitude) };
      }
    } catch {}

    if (!coords) {
      try {
        const saved = await AsyncStorage.getItem("clientLocation");
        if (saved) {
          const parsed = JSON.parse(saved);
          const lat = toNum(parsed?.lat ?? parsed?.latitude);
          const long = toNum(parsed?.long ?? parsed?.lng ?? parsed?.longitude);
          if (lat != null && long != null) coords = { lat, long };
        }
      } catch {}
    }

    if (!coords?.lat || !coords?.long) {
      // If we can’t get fast coords, try quick fresh GPS once (short timeout)
      try {
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeout: 2000,
        });
        if (fresh?.coords?.latitude != null && fresh?.coords?.longitude != null) {
          coords = { lat: toNum(fresh.coords.latitude), long: toNum(fresh.coords.longitude) };
        }
      } catch {}
    }

    if (!coords?.lat || !coords?.long) {
      setNearbyError("Could not determine your location.");
      setNearbyProviders([]);
      setCurrentProvider(null);
      return;
    }

    // Store + set location (fast)
    setClientLocation(coords);
    AsyncStorage.setItem("clientLocation", JSON.stringify(coords)).catch(() => {});

    // 2) Fetch providers NOW (don’t wait on long GPS)
    const clientCoords = { lat: coords.lat, lng: coords.long };

    const res = await axios.get(`${API}/providers`, { timeout: 8000 });
    const list = Array.isArray(res.data) ? res.data : res.data?.providers || [];

    // 3) Compute + sort (keep it cheap)
    const withinRadius = [];
    for (const p of list) {
      const pc = getProviderCoords(p);
      if (!pc) continue;

      const d = haversineKm(clientCoords.lat, clientCoords.lng, pc.lat, pc.lng);
      if (!Number.isFinite(d) || d > 15) continue;

      withinRadius.push({ ...p, distance_km: d });
    }
    withinRadius.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));

    setNearbyProviders(withinRadius);
    setCurrentProvider(withinRadius[0] || null);

    // IMPORTANT: don’t make home wait on favorites syncing
    Promise.resolve()
      .then(() => syncFavoritesFromList(withinRadius))
      .catch(() => {});

  } catch (err) {
    console.log("Error loading nearby providers", err?.response?.data || err?.message);
    setNearbyError("Could not load nearby providers.");
  } finally {
    if (didSetLoading) setNearbyLoading(false);
    console.log("[home] loadNearbyProviders done in", Date.now() - t0, "ms");
  }
}, [syncFavoritesFromList]);



  // const loadNearbyProviders = useCallback(async () => {
  //   try {
  //     setNearbyLoading(true);
  //     setNearbyError("");
  //     setLocationDenied(false);

  //     const { status } = await Location.requestForegroundPermissionsAsync();
  //     if (status !== "granted") {
  //       setLocationDenied(true);
  //       setClientLocation(null);
  //       setNearbyProviders([]);
  //       setCurrentProvider(null);
  //       return;
  //     }

  //     const loc = await Location.getCurrentPositionAsync({});
  //     const coords = {
  //       lat: toNum(loc.coords.latitude),
  //       long: toNum(loc.coords.longitude),
  //     };
  //     setClientLocation(coords);
  //     await AsyncStorage.setItem("clientLocation", JSON.stringify(coords));
  //     const clientCoords =
  //       coords.lat != null && coords.long != null
  //         ? { lat: coords.lat, lng: coords.long }
  //         : null;

  //     const res = await axios.get(`${API}/providers`);
  //     const list = Array.isArray(res.data)
  //       ? res.data
  //       : res.data?.providers || [];

  //     const withinRadius = list
  //       .map((p) => {
  //         const providerCoords = getProviderCoords(p);
  //         const distance = clientCoords && providerCoords
  //           ? haversineKm(
  //               clientCoords.lat,
  //               clientCoords.lng,
  //               providerCoords.lat,
  //               providerCoords.lng
  //             )
  //           : null;
  //         const distance_km = Number.isFinite(distance) ? distance : null;
  //         return { ...p, distance_km };
  //       })
  //       .filter(
  //         (p) => typeof p.distance_km === "number" && p.distance_km <= 15
  //       )
  //       .sort(
  //         (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
  //       );

  //     setNearbyProviders(withinRadius);
  //     setCurrentProvider(withinRadius[0] || null);
  //     syncFavoritesFromList(withinRadius);
  //   } catch (err) {
  //     console.log(
  //       "Error loading nearby providers",
  //       err?.response?.data || err?.message
  //     );
  //     setNearbyError("Could not load nearby providers.");
  //   } finally {
  //     setNearbyLoading(false);
  //   }
  // }, [syncFavoritesFromList]);

  useEffect(() => {
    loadNearbyProviders();
  }, [loadNearbyProviders]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadNearbyProviders(),
      refreshFavoriteProviders ? refreshFavoriteProviders() : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [loadNearbyProviders, refreshFavoriteProviders]);

  const hasCarousel = nearbyProviders.length > 0;

  const handleCarouselScroll = (event) => {
    if (!nearbyProviders.length) return;

    const CARD_WIDTH = 280 + 12; // card width + marginRight
    const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
    const index = Math.min(
      nearbyProviders.length - 1,
      Math.max(0, Math.round(offsetX / CARD_WIDTH))
    );

    setCurrentProvider(nearbyProviders[index] || null);
  };

  const handleProviderPress = (provider) => {
    if (!provider) return;
    navigation.navigate("Search", { provider });
  };

  const handleSearchNavigate = useCallback(
    (query) => {
      const trimmed = String(query || "").trim();
      const params = trimmed
        ? { incomingUsername: trimmed, deeplinkNonce: Date.now() }
        : undefined;
      navigation.navigate("Search", params);
    },
    [navigation]
  );

  useEffect(() => {
    refreshFavoriteProviders();
  }, [refreshFavoriteProviders]);

  const clientCoords = getClientCoords();
  let nearbyHasDistance = false;
  let nearbyLastProviderCoords = null;
  let nearbyLastDistanceKm = null;
  const nearbyCards = nearbyProviders.map((provider) => {
    const avatar = resolveImageUrl(
      provider.avatar_url || provider.profile_photo_url
    );
    const saved = isFavorite(provider);
    const providerId = getProviderId(provider) || provider.name;
    const professionLabel = provider.professions?.length
      ? provider.professions.join(", ")
      : (provider.services || []).join(" · ");
    const providerCoords = getProviderCoords(provider);
    const baseDistance = toNum(provider.distance_km);
    const computedDistance =
      baseDistance != null
        ? baseDistance
        : clientCoords && providerCoords
        ? getDistanceKm(
            clientCoords.lat,
            clientCoords.lng,
            providerCoords.lat,
            providerCoords.lng
          )
        : null;
    const distanceKm = Number.isFinite(computedDistance)
      ? computedDistance
      : null;
    if (distanceKm != null) {
      nearbyHasDistance = true;
    }
    nearbyLastProviderCoords = providerCoords;
    nearbyLastDistanceKm = distanceKm;
     console.log("[distance source]", {
          clientCoords,
          providerCoords,
          distanceKm,
        });

    return (
     
      <ProviderCard
        key={providerId}
        provider={provider}
        avatarUrl={avatar}
        profession={professionLabel}
        distanceKm={distanceKm}
        isFavorite={saved}
        onFavoriteToggle={() => toggleFavorite(provider)}
        onPress={() => handleProviderPress(provider)}
        ctaLabel={null}
        style={styles.providerCardCarousel}
      />
    );
  });

  if (!nearbyHasDistance && nearbyProviders.length) {
    console.log("[distance] nearby list missing distances", {
      clientCoords,
      providerCoords: nearbyLastProviderCoords,
      distanceKm: nearbyLastDistanceKm,
    });
  }

  let favoritesHasDistance = false;
  let favoritesLastProviderCoords = null;
  let favoritesLastDistanceKm = null;
  const favoriteCards = favoriteProviders.map((provider) => {
    const avatar = resolveImageUrl(
      provider.avatar_url || provider.profile_photo_url
    );
    const saved = isFavorite(provider);
    const providerId = getProviderId(provider) || provider.name;
    const professionLabel = provider.professions?.length
      ? provider.professions.join(", ")
      : (provider.services || []).join(" · ");
    const providerCoords = getProviderCoords(provider);
    const baseDistance = toNum(provider.distance_km);
    const computedDistance =
      baseDistance != null
        ? baseDistance
        : clientCoords && providerCoords
        ? getDistanceKm(
            clientCoords.lat,
            clientCoords.lng,
            providerCoords.lat,
            providerCoords.lng
          )
        : null;
    const distanceKm = Number.isFinite(computedDistance)
      ? computedDistance
      : null;
    if (distanceKm != null) {
      favoritesHasDistance = true;
    }
    favoritesLastProviderCoords = providerCoords;
    favoritesLastDistanceKm = distanceKm;

    return (
      <ProviderCard
        key={providerId}
        provider={provider}
        avatarUrl={avatar}
        profession={professionLabel}
        distanceKm={distanceKm}
        isFavorite={saved}
        onFavoriteToggle={() => toggleFavorite(provider)}
        onPress={() => handleProviderPress(provider)}
        ctaLabel={null}
        style={styles.providerCardCarousel}
      />
    );
  });

  if (!favoritesHasDistance && favoriteProviders.length) {
    console.log("[distance] favorites list missing distances", {
      clientCoords,
      providerCoords: favoritesLastProviderCoords,
      distanceKm: favoritesLastDistanceKm,
    });
  }

  return (
    <View style={styles.homeWrapper}>
        <View
          style={[
            styles.pinnedHeader,
            // headerMinHeight ? { minHeight: headerMinHeight } : null,
          ]}
        >
          <View
            style={[
              styles.pinnedHeaderSafeArea,
              {
                paddingTop: Platform.OS === "ios" ? 6 : 6,
                paddingBottom: 1,
              },
            ]}
          >
            <Image
              source={BookitGYLogoTransparent}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          </View>
        </View>
      <ScrollView
        contentContainerStyle={styles.homeScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.homeHeader}>
          <Text style={styles.homeGreeting}>{greetingText}</Text>
          <Text style={styles.homeSubtitle}>
            What are you looking for today?
          </Text>
        </View>

        <Pressable
          style={styles.searchBar}
          onPress={() => handleSearchNavigate(searchText)}
          >
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput
            pointerEvents="none"
            style={styles.searchInput}
            placeholder="Search by profession, provider, or service"
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            editable={false}
            showSoftInputOnFocus={false}
            caretHidden={true}
            returnKeyType="search"
          />
          </Pressable>


        <View style={styles.quickCategorySection}>
          <Text style={styles.sectionTitle}>Quick Categories</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickCategoryList}
          >
            {quickCategories.map((category) => (
              <Pressable
                key={category}
                style={styles.quickCategoryChip}
                onPress={() => handleSearchNavigate(category)}
              >
                <Text style={styles.quickCategoryText}>{category}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>


        <View style={[styles.card, styles.homeCard]}>
          <View style={styles.carouselHeader}>
            <View>
              <Text style={styles.sectionTitle}>Nearby Providers</Text>
              <Text style={styles.serviceMeta}>
                Based on your current location
              </Text>
            </View>

            {hasCarousel ? (
              <View style={styles.carouselBadge}>
                <Text style={styles.carouselBadgeText}>
                  {nearbyProviders.length}
                </Text>
              </View>
            ) : null}
          </View>

          {nearbyLoading ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselList}
            >
              {[0, 1, 2].map((index) => (
                <View
                  key={`nearby-skeleton-${index}`}
                  style={styles.providerCardSkeleton}
                >
                  <View style={[styles.cardImageWrapper, styles.skeletonBlock]} />
                  <View style={styles.cardBody}>
                    <View style={[styles.skeletonLine, { width: "70%" }]} />
                    <View style={[styles.skeletonLine, { width: "45%" }]} />
                    <View style={[styles.skeletonLine, { width: "60%" }]} />
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {!nearbyLoading && nearbyError ? (
            <Text style={styles.errorText}>{nearbyError}</Text>
          ) : null}

          {!nearbyLoading && !nearbyError && locationDenied ? (
            <View style={styles.nearbyEmptyCard}>
              <Text style={styles.nearbyEmptyTitle}>
                Enable location to see providers near you.
              </Text>
              <Text style={styles.nearbyEmptyBody}>
                Turn on location permissions to view nearby providers.
              </Text>
            </View>
          ) : null}

          {!nearbyLoading && !nearbyError && !locationDenied && !hasCarousel ? (
            <View style={styles.nearbyEmptyCard}>
              <Text style={styles.nearbyEmptyTitle}>
                No providers nearby yet
              </Text>
              <Text style={styles.nearbyEmptyBody}>
                There aren’t any providers available in your area right now.
                More providers are being added constantly and will be available
                near you soon.
              </Text>
              <Text style={styles.nearbyEmptyHint}>
                Try again soon, or use Search to explore other areas.
              </Text>
            </View>
          ) : null}

          {!nearbyLoading && !nearbyError && hasCarousel ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselList}
              onMomentumScrollEnd={handleCarouselScroll}
            >
              {nearbyCards}
            </ScrollView>
          ) : null}

          {currentProvider ? (
            <Text style={styles.carouselActiveLabel} numberOfLines={1}>
              Viewing: {currentProvider.name}
            </Text>
          ) : null}
        </View>


        <View style={[styles.card, styles.homeCard, { marginTop: 16 }]}>
          <View style={styles.carouselHeader}>
            <View>
              <Text style={styles.sectionTitle}>Favorite Providers</Text>
              <Text style={styles.serviceMeta}>
                Tap the heart on any provider to save them here
              </Text>
            </View>

            {favoriteProviders.length ? (
              <View style={styles.carouselBadge}>
                <Text style={styles.carouselBadgeText}>
                  {favoriteProviders.length}
                </Text>
              </View>
            ) : null}
          </View>

          {favoritesLoading ? (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading your favorites…</Text>
            </View>
          ) : null}

          {!favoritesLoading && favoriteIds.length === 0 ? (
            <Text style={styles.serviceHint}>
              Tap the heart on a provider to keep them here for quick access.
            </Text>
          ) : null}

          {!favoritesLoading &&
            favoriteIds.length > 0 &&
            favoriteProviders.length === 0 ? (
              <Text style={styles.serviceHint}>
                We couldn't load your saved providers. Try again soon.
              </Text>
            ) : null}

          {favoriteProviders.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselList}
            >
              {favoriteCards}
            </ScrollView>
          ) : null}
          </View>
        </ScrollView>
        </View>      
    );
  }





function AppointmentsScreen({ token, showFlash }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const normalizeStart = (booking) => {
    const iso = booking?.start_time || booking?.start;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const formatBookingDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatBookingTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    let h = d.getHours();
    const m = d.getMinutes();
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
  };

  const fetchBookings = useCallback(
    async (useRefresh = false) => {
      try {
        if (useRefresh) setRefreshing(true);
        setLoading(true);
        setError("");

        const authToken = await getAuthToken(token);

        if (!authToken) {
          setError("Please log in to view your appointments.");
          setBookings([]);
          return;
        }

        const res = await axios.get(`${API}/bookings/me`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const raw = res.data;
        const list = Array.isArray(raw)
          ? raw
          : raw?.bookings || raw?.results || [];

        setBookings(list);
      } catch (err) {
        console.log(
          "Error loading appointments",
          err.response?.data || err.message
        );
        setError("Could not load your appointments.");
        if (showFlash) {
          showFlash("error", "Could not load your appointments.");
        }
      } finally {
        setLoading(false);
        if (useRefresh) setRefreshing(false);
      }
    },
    [showFlash, token?.token]
  );

  const handleRefresh = useCallback(() => fetchBookings(true), [fetchBookings]);

  useFocusEffect(
    useCallback(() => {
      fetchBookings();
    }, [fetchBookings])
  );

  const handleNavigateToBooking = (booking) => {
    try {
      let url = "";
      if (
        booking?.provider_lat != null &&
        booking?.provider_long != null
      ) {
        const dest = `${booking.provider_lat},${booking.provider_long}`;
        url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
      } else if (booking?.provider_location) {
        const q = encodeURIComponent(booking.provider_location);
        url = `https://www.google.com/maps/search/?api=1&query=${q}`;
      } else {
        showFlash &&
          showFlash("error", "No location is available yet for this booking.");
        return;
      }

      Linking.openURL(url);
    } catch (err) {
      console.log("Error opening maps", err);
      showFlash &&
        showFlash("error", "Could not open maps on this device.");
    }
  };

  const handleCancelBooking = (booking) => {
    const bookingId = booking?.id || booking?.booking_id;
    if (!bookingId) return;

    Alert.alert(
      "Cancel appointment",
      "Are you sure you want to cancel this appointment?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, cancel",
          style: "destructive",
          onPress: async () => {
            try {
              const authToken = await getAuthToken(token);

              if (!authToken) {
                showFlash &&
                  showFlash("error", "No access token found. Please log in.");
                return;
              }

              await axios.post(
                `${API}/bookings/${bookingId}/cancel`,
                {},
                {
                  headers: { Authorization: `Bearer ${authToken}` },
                }
              );

              setBookings((prev) =>
                (prev || []).map((b) =>
                  b.id === bookingId || b.booking_id === bookingId
                    ? { ...b, status: "cancelled" }
                    : b
                )
              );

              showFlash && showFlash("success", "Booking cancelled");
            } catch (err) {
              console.log(
                "Error cancelling booking (appointments)",
                err.response?.data || err.message
              );
              showFlash && showFlash("error", "Could not cancel booking.");
            }
          },
        },
      ]
    );
  };

  const datedBookings = bookings.map((b) => ({
    ...b,
    _start: normalizeStart(b),
  }));

  const now = new Date();
  const upcomingBookings = datedBookings
    .filter((b) => b._start && b.status !== "cancelled" && b._start >= now)
    .sort((a, b) => a._start - b._start);

  const finishedBookings = datedBookings
    .filter((b) => !b._start || b.status === "cancelled" || b._start < now)
    .sort((a, b) => {
      const aTime = a?._start?.getTime?.() ?? 0;
      const bTime = b?._start?.getTime?.() ?? 0;
      return bTime - aTime;
    });

  const deriveStatus = (booking) => {
    const startIso = booking.start_time || booking.start;
    const endIso = booking.end_time || booking.end;
    const startDate = startIso ? new Date(startIso) : null;
    const endDate = endIso ? new Date(endIso) : null;
    const nowTs = Date.now();

    const normalizedStart =
      startDate && !Number.isNaN(startDate.getTime()) ? startDate.getTime() : null;
    const normalizedEnd =
      endDate && !Number.isNaN(endDate.getTime()) ? endDate.getTime() : null;

    if (booking.status === "cancelled") return "cancelled";

    if (normalizedEnd != null) {
      if (nowTs >= normalizedEnd) return "completed";
      if (normalizedStart != null && nowTs >= normalizedStart) return "in progress";
    }

    return booking.status || "pending";
  };

  const renderBooking = (booking, isUpcoming = false) => {
    const startIso = booking.start_time || booking.start;
    const dateLabel = formatBookingDate(startIso);
    const timeLabel = formatBookingTime(startIso);
    const statusLabel = deriveStatus(booking);
    // status color mapping
    const statusThemeKey = getAppointmentStatusThemeKey(statusLabel);
    const statusTheme = APPOINTMENT_STATUS_THEME[statusThemeKey];

    return (
      <View
        key={booking.id || booking.booking_id || `${startIso}-${booking.service_name}`}
        style={[
          styles.appointmentItem,
          // tint based on status
          { backgroundColor: statusTheme.bgTint, borderColor: statusTheme.border },
        ]}
      >
        {/* left accent bar */}
        <View style={[styles.appointmentLeftAccentBar, { backgroundColor: statusTheme.accent }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.appointmentTitle}>{booking.service_name}</Text>
          <Text style={styles.appointmentMeta}>
            {booking.provider_name || "Your provider"}
          </Text>
          {(dateLabel || timeLabel) && (
            <Text style={styles.appointmentMeta}>
              {dateLabel} {timeLabel ? `· ${timeLabel}` : ""}
            </Text>
          )}
          {booking.provider_location ? (
            <Text style={styles.appointmentMeta}>
              {booking.provider_location}
            </Text>
          ) : null}
          <View style={styles.appointmentStatusRow}>
            <View
              style={[
                styles.appointmentStatusBadge,
                // tint based on status
                { backgroundColor: statusTheme.bgTint, borderColor: statusTheme.accent },
              ]}
            >
              <Text style={[styles.appointmentStatus, { color: statusTheme.accent }]}>Status: {statusLabel}</Text>
            </View>

            {isUpcoming && (
              <TouchableOpacity
                style={styles.appointmentCancelButton}
                onPress={() => handleCancelBooking(booking)}
              >
                <Text style={styles.appointmentCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isUpcoming &&
          (booking.provider_lat != null || booking.provider_location) && (
          <TouchableOpacity
            style={[styles.navigateButton, styles.appointmentDirectionsButton]}
            onPress={() => handleNavigateToBooking(booking)}
          >
            <Text style={styles.navigateButtonText}>Directions</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
  <ScrollView
    contentContainerStyle={styles.appointmentScroll}
    refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
    }
  >
    <View style={styles.card}>
      <View style={styles.appointmentHeader}>
        <Text style={styles.profileTitle}>Appointments</Text>
        {/* <TouchableOpacity onPress={fetchBookings}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity> */}
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.serviceMeta}>Loading your appointments…</Text>
        </View>
      )}

      {!loading && error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}

      {!loading && !error && bookings.length === 0 ? (
        <Text style={styles.serviceMeta}>
          You don’t have any appointments yet.
        </Text>
      ) : null}
    </View>

    {!loading && bookings.length > 0 && (
      <>
        <View style={styles.card}>
          <View style={styles.appointmentHeader}>
            <Text style={styles.sectionTitle}>Upcoming</Text>
            <Text style={styles.appointmentCount}>
              {upcomingBookings.length} booking
              {upcomingBookings.length === 1 ? "" : "s"}
            </Text>
          </View>

          {upcomingBookings.length === 0 ? (
            <Text style={styles.serviceMeta}>
              No upcoming appointments yet.
            </Text>
          ) : (
            upcomingBookings.map((booking) => renderBooking(booking, true))
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.appointmentHeader}>
            <Text style={styles.sectionTitle}>Finished</Text>
            <Text style={styles.appointmentCount}>
              {finishedBookings.length} booking
              {finishedBookings.length === 1 ? "" : "s"}
            </Text>
          </View>

          {finishedBookings.length === 0 ? (
            <Text style={styles.serviceMeta}>
              Nothing here yet. Completed or cancelled bookings will
              appear once you have them.
            </Text>
          ) : (
            finishedBookings.map((booking) =>
              renderBooking(booking, false)
            )
          )}
        </View>
      </>
    )}
  </ScrollView>
);
}

    




function SearchScreen({ token, showFlash, navigation, route, toggleFavorite, isFavorite, syncFavoritesFromList }) {
  const incomingUsername = route?.params?.incomingUsername ?? null;
  const deeplinkNonce = route?.params?.deeplinkNonce ?? null;
  const [filteredProviders, setFilteredProviders] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(0); // 0 = any distance
  const [clientLocation, setClientLocation] = useState(null);
  const [locationError, setLocationError] = useState("");
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");
  const [selectedService, setSelectedService] = useState(null);
  const [catalogImages, setCatalogImages] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [availability, setAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null); // ISO string
  const [bookingLoading, setBookingLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false); // 👈 NEW
  const [refreshing, setRefreshing] = useState(false);
  const [shouldScrollToResults, setShouldScrollToResults] = useState(false);
  const [hasRequestedLocation, setHasRequestedLocation] = useState(false);
  const isFocused = useIsFocused();
  const scrollRef = useRef(null);
  const resultsOffset = useRef(0);
  //Radius 
  const distanceChips = [0, 5, 10, 15, 20];

  useEffect(() => {
    if (!isFocused) return;
    if (!incomingUsername) return;
    console.log(
      "[deeplink] consumed in SearchScreen",
      incomingUsername,
      deeplinkNonce,
      "focused",
      isFocused
    );
    setSearchQuery(incomingUsername);
    setHasSearched(true);
    setShouldScrollToResults(true);
  }, [incomingUsername, deeplinkNonce, isFocused]);

  const haversineKm = (lat1, lon1, lat2, lon2) => {
    if (
      lat1 == null ||
      lon1 == null ||
      lat2 == null ||
      lon2 == null
    ) {
      return null;
    }
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getClientCoords = () => {
    if (!clientLocation) return null;
    const lat = toNum(clientLocation.lat ?? clientLocation.latitude);
    const lng = toNum(
      clientLocation.lng ?? clientLocation.long ?? clientLocation.longitude
    );
    if (lat == null || lng == null) return null;
    return { lat, lng };
  };

  useEffect(() => {
    if (clientLocation) return;
    let isMounted = true;

    const loadStoredClientLocation = async () => {
      try {
        const stored = await AsyncStorage.getItem("clientLocation");
        if (!stored) return;
        const parsed = JSON.parse(stored);
        const lat = toNum(parsed?.lat ?? parsed?.latitude);
        const long = toNum(
          parsed?.long ?? parsed?.lng ?? parsed?.longitude
        );
        if (lat == null || long == null) return;
        if (isMounted) {
          setClientLocation({ lat, long });
        }
      } catch (error) {
        console.log("Error loading stored client location", error);
      }
    };

    loadStoredClientLocation();

    return () => {
      isMounted = false;
    };
  }, [clientLocation]);


  const handleSearchSubmit = () => {
    // when the user hits enter/search on the keyboard
    setHasSearched(true);
    setShouldScrollToResults(true);
  };


  const loadProviders = useCallback(async () => {
    try {
      setProvidersLoading(true);
      setProvidersError("");

      const res = await axios.get(`${API}/providers`);

      // Always normalize the result to an array
      const list = Array.isArray(res.data)
        ? res.data
        : res.data?.providers || [];

      setProviders(list);
      setFilteredProviders(list);
      syncFavoritesFromList(list);
      return list;
    } catch (err) {
      console.log(
        "Error loading providers",
        err?.response?.data || err?.message
      );
      setProvidersError("Could not load providers.");
      if (showFlash) showFlash("error", "Could not load providers.");
      return [];
    } finally {
      setProvidersLoading(false);
    }
  }, [showFlash, syncFavoritesFromList]);

  const clearSelectedProvider = useCallback(() => {
    setSelectedProvider(null);
    setServices([]);
    setServicesError("");
    setSelectedService(null);
    setAvailability([]);
    setAvailabilityError("");
    setCatalogImages([]);
    setCatalogError("");
    setSelectedDate(null);
    setSelectedSlot(null);
  }, []);

  // Load providers on mount
  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const providerFromNav = route?.params?.provider;
    if (!providerFromNav) return;

    const incomingId = getProviderId(providerFromNav);
    const currentId = getProviderId(selectedProvider);
    if (incomingId && incomingId === currentId) return;

    setSearchQuery(providerFromNav.name || "");
    setHasSearched(true);
    setFilteredProviders([providerFromNav]);
    handleSelectProvider(providerFromNav);
  }, [route?.params?.provider, selectedProvider, handleSelectProvider]);

  // Add a useEffect that recomputes filteredProviders
  // whenever providers/search/radius/location changes:
  useEffect(() => {
    // 👇 do nothing until the user actually searches or if the query is empty
    const normalizedQuery = normalizeSearchValue(searchQuery);
    if (!hasSearched || !normalizedQuery) {
      setFilteredProviders([]);
      clearSelectedProvider();
      return;
    }

    const providerList = Array.isArray(providers) ? providers : [];
    const deeplinkUsername = normalizeSearchValue(incomingUsername);
    if (
      deeplinkUsername &&
      normalizedQuery === deeplinkUsername
    ) {
      console.log(
        "[search] deeplink exact attempt",
        deeplinkUsername
      );
      const exact = providerList.filter((p) => {
        const u1 = normalizeSearchValue(p.username);
        const u2 = normalizeSearchValue(p.user?.username);
        return u1 === deeplinkUsername || u2 === deeplinkUsername;
      });
      console.log(
        "[search] deeplink exact username",
        deeplinkUsername,
        "matches",
        exact.length
      );
      if (exact.length > 0) {
        setFilteredProviders(exact);
        return;
      }
      console.log("[search] deeplink exact miss, falling back to fuzzy");
    }

    const q = normalizedQuery;
    const providerFromNav = route?.params?.provider;
    const navProviderId = getProviderId(providerFromNav);
    const navProviderName = normalizeSearchValue(providerFromNav?.name);

    // If we navigated in with a specific provider, keep the results scoped
    // to that provider ID so namesakes don't appear.
    if (
      navProviderId &&
      navProviderName &&
      normalizedQuery === navProviderName
    ) {
      const exactMatch = providerList.find(
        (p) => getProviderId(p) === navProviderId
      );

      setFilteredProviders([exactMatch || providerFromNav]);
      return;
    }

    const clientCoords = getClientCoords();
    let list = providerList.map((p) => {
      const providerCoords = getProviderCoords(p);
      const distance = clientCoords && providerCoords
        ? haversineKm(
            clientCoords.lat,
            clientCoords.lng,
            providerCoords.lat,
            providerCoords.lng
          )
        : null;
      const distance_km = Number.isFinite(distance) ? distance : null;
      return { ...p, distance_km };
    });

    // text filter (profession/name/location)
    if (q) {
      list = list.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const location = (p.location || "").toLowerCase();
        const username = (p.username || "").toLowerCase();
        const username2 = (p.user?.username || "").toLowerCase();
        const professions = (p.professions || []).map((pr) =>
          (pr || "").toLowerCase()
        );

        return (
          professions.some((pr) => pr.includes(q)) ||
          name.includes(q) ||
          location.includes(q) ||
          username.includes(q) ||
          username2.includes(q)
        );
      });
    }

    // distance filter
    if (radiusKm > 0) {
      if (!clientLocation) {
        setLocationError(
          "Turn on location services to filter providers by distance."
        );
      } else {
        setLocationError("");
        list = list.filter(
          (p) =>
            typeof p.distance_km === "number" &&
            p.distance_km <= radiusKm
        );
        list.sort((a, b) => {
          const da = a.distance_km ?? 999999;
          const db = b.distance_km ?? 999999;
          return da - db;
        });
      }
    } else {
      setLocationError("");
    }

    setFilteredProviders(list);
  }, [providers, searchQuery, radiusKm, clientLocation, hasSearched, route?.params?.provider, clearSelectedProvider]);



  const ensureClientLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError(
          "Location permission is required to filter by distance."
        );
        if (showFlash) {
          showFlash(
            "error",
            "Please enable location permission to use distance filters."
          );
        }
        return null;
      }

      const loc = await Location.getCurrentPositionAsync({});
      const coords = {
        lat: loc.coords.latitude,
        long: loc.coords.longitude,
      };
      setClientLocation(coords);
      await AsyncStorage.setItem("clientLocation", JSON.stringify(coords));
      setLocationError("");
      return coords;
    } catch (err) {
      console.log("Error getting client location", err);
      setLocationError("Could not get your current location.");
      if (showFlash) {
        showFlash("error", "Could not get your current location.");
      }
      // Sentry.Native.captureException(err, {
      //   extra: { scope: "client-location" },
      // });
      return null;
    }
  }, [showFlash]);

  const handleRadiusChange = async (value) => {
    setRadiusKm(value);
    if (value > 0 && !clientLocation) {
      await ensureClientLocation();
    }
  };

  useEffect(() => {
    if (!hasSearched || clientLocation || hasRequestedLocation) return;
    let isMounted = true;

    const requestLocation = async () => {
      setHasRequestedLocation(true);
      const coords = await ensureClientLocation();
      if (!isMounted || !coords) return;
    };

    requestLocation();

    return () => {
      isMounted = false;
    };
  }, [clientLocation, ensureClientLocation, hasRequestedLocation, hasSearched]);

  const handleResultsLayout = (event) => {
    resultsOffset.current = event.nativeEvent.layout.y;
    if (shouldScrollToResults && scrollRef.current) {
      scrollRef.current.scrollTo({
        y: resultsOffset.current,
        animated: true,
      });
      setShouldScrollToResults(false);
    }
  };

  useEffect(() => {
    if (!shouldScrollToResults || !scrollRef.current) return;
    scrollRef.current.scrollTo({
      y: resultsOffset.current,
      animated: true,
    });
    setShouldScrollToResults(false);
  }, [shouldScrollToResults]);


  const loadAvailability = useCallback(
    async (providerId, serviceId) => {
      try {
        setAvailabilityLoading(true);
        setAvailabilityError("");

        const res = await axios.get(
          `${API}/providers/${providerId}/availability`,
          {
            params: {
              service_id: serviceId,
              days: 14,
            },
          }
        );

        setAvailability(res.data || []);
      } catch (err) {
        console.log(
          "Error loading availability",
          err.response?.data || err.message
        );
        setAvailabilityError("Could not load availability for this service.");
        if (showFlash) showFlash("error", "Could not load availability.");
      } finally {
        setAvailabilityLoading(false);
      }
    },
    [showFlash]
  );

  const loadProviderCatalog = useCallback(async (providerId) => {
    try {
      setCatalogLoading(true);
      setCatalogError("");

      const res = await axios.get(`${API}/providers/${providerId}/catalog`);

      setCatalogImages(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.log(
        "Error loading provider catalog",
        err.response?.data || err.message
      );
      setCatalogError(
        err.response?.data?.detail || "Could not load provider photos."
      );
    } finally {
      setCatalogLoading(false);
    }
  }, []);


  const handleSelectProvider = useCallback(async (provider) => {
    setSelectedProvider(provider);

    const providerId = getProviderId(provider);
    if (!providerId) {
      setServices([]);
      setServicesError("Provider information is missing.");
      return;
    }

    // Reset downstream state
    setServices([]);
    setServicesError("");
    setSelectedService(null);
    setAvailability([]);
    setAvailabilityError("");
    setSelectedDate(null);
    setSelectedSlot(null);

    // Reset and load catalog for this provider
    setCatalogImages([]);
    setCatalogError("");
    loadProviderCatalog(providerId);

    try {
      setServicesLoading(true);

      const res = await axios.get(
        `${API}/providers/${providerId}/services`
      );
      setServices(res.data || []);
    } catch (err) {
      console.log(
        "Error loading services",
        err.response?.data || err.message
      );
      setServicesError("Could not load services for this provider.");
      if (showFlash) showFlash("error", "Could not load provider services.");
    } finally {
      setServicesLoading(false);
    }
  }, [loadProviderCatalog, showFlash]);

  const handleSelectService = useCallback(
    async (service) => {
      setSelectedService(service);
      setAvailability([]);
      setAvailabilityError("");
      setSelectedDate(null);
      setSelectedSlot(null);

      if (!selectedProvider) return;

      await loadAvailability(getProviderId(selectedProvider), service.id);
    },
    [loadAvailability, selectedProvider]
  );

  const clientCoords = getClientCoords();
  let searchHasDistance = false;
  let searchLastProviderCoords = null;
  let searchLastDistanceKm = null;
  const searchCards = filteredProviders.map((p) => {
    const avatar = resolveImageUrl(p.avatar_url || p.profile_photo_url);
    const favorite = isFavorite(p);
    const providerCoords = getProviderCoords(p);
    const baseDistance = toNum(p.distance_km);
    const computedDistance =
      baseDistance != null
        ? baseDistance
        : clientCoords && providerCoords
        ? getDistanceKm(
            clientCoords.lat,
            clientCoords.lng,
            providerCoords.lat,
            providerCoords.lng
          )
        : null;
    const distanceKm = Number.isFinite(computedDistance)
      ? computedDistance
      : null;
    if (distanceKm != null) {
      searchHasDistance = true;
    }
    searchLastProviderCoords = providerCoords;
    searchLastDistanceKm = distanceKm;
    const professionLabel = p.professions?.length
      ? p.professions.join(" · ")
      : p.profession || null;
    return (
      <ProviderCard
        key={getProviderId(p) || p.name}
        provider={p}
        avatarUrl={avatar}
        profession={professionLabel}
        distanceKm={distanceKm}
        isFavorite={favorite}
        onFavoriteToggle={() => toggleFavorite(p)}
        onPress={() => handleSelectProvider(p)}
        ctaLabel={null}
        isSelected={
          selectedProvider &&
          getProviderId(selectedProvider) === getProviderId(p)
        }
        style={styles.providerCardList}
      />
    );
  });

  if (!searchHasDistance && filteredProviders.length) {
    console.log("[distance] search list missing distances", {
      clientCoords,
      providerCoords: searchLastProviderCoords,
      distanceKm: searchLastDistanceKm,
    });
  }

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const list = await loadProviders();

    if (selectedProvider) {
      const match = (list || []).find(
        (p) => getProviderId(p) === getProviderId(selectedProvider)
      );

      if (match) {
        await handleSelectProvider(match);
      } else {
        setSelectedProvider(null);
        setServices([]);
        setAvailability([]);
        setCatalogImages([]);
      }
    }

    setRefreshing(false);
  }, [handleSelectProvider, loadProviders, selectedProvider]);

  const handleBookAppointment = async () => {
    if (!selectedService || !selectedSlot || !selectedProvider) return;

    const providerId = getProviderId(selectedProvider);
    if (!providerId) return;

    try {
      setBookingLoading(true);

      const authToken = await getAuthToken(token);
      if (!authToken) {
        if (showFlash) {
          showFlash("error", "No access token found. Please log in again.");
        } else {
          Alert.alert("Error", "No access token found. Please log in again.");
        }
        return;
      }

      await axios.post(
        `${API}/bookings`,
        {
          service_id: selectedService.id,
          start_time: selectedSlot,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      // Refresh availability so this slot disappears
      await loadAvailability(providerId, selectedService.id);

      // Clear selection
      setSelectedSlot(null);

      if (showFlash) showFlash("success", "Booking created!");
      else Alert.alert("Success", "Booking created!");
    } catch (err) {
      console.log(
        "Error creating booking",
        err.response?.data || err.message
      );
      const detail =
        err.response?.data?.detail ||
        "Could not create booking. Maybe slot is already taken.";

      if (showFlash) showFlash("error", detail);
      else Alert.alert("Error", detail);

      // Refresh availability after failure to show updated slots
      try {
        if (selectedProvider && selectedService) {
          await loadAvailability(
            providerId,
            selectedService.id
          );
        }
      } catch (e) {
        console.log("Error refreshing availability after failure", e);
      }
    } finally {
      setBookingLoading(false);
    }
  };

  // Map date string -> slots for easier lookup
  const availabilityMap = React.useMemo(() => {
    const map = {};
    (availability || []).forEach((day) => {
      map[day.date] = day.slots || [];
    });
    return map;
  }, [availability]);

  const makeDateKey = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`; // "YYYY-MM-DD"
  };


  // Build mini calendar for next 14 days
  const buildCalendarDays = () => {
    const days = [];
    const today = new Date();

    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const key = makeDateKey(d); // YYYY-MM-DD
      const hasSlots = (availabilityMap[key] || []).length > 0;

      days.push({ key, date: d, hasSlots });
    }
    return days;
  };

  const calendarDays = buildCalendarDays();

  const formatTimeLabel = (isoString) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

    return (
      <SafeAreaView style={styles.searchSafeArea}>
        <View style={styles.searchHeader}>
          <Text style={styles.searchHeaderTitle}>Search providers</Text>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by profession or provider…"
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={(value) => {
                if (!normalizeSearchValue(value)) {
                  setSearchQuery(value);
                  setHasSearched(false);
                  clearSelectedProvider();
                  return;
                }
                setSearchQuery(value);
              }}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
            />
          </View>
          <View style={styles.chipsRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
            >
              {distanceChips.map((km) => {
                const selected = radiusKm === km;
                const label = km === 0 ? "Any" : `${km}km`;
                return (
                  <TouchableOpacity
                    key={km}
                    style={[
                      styles.filterChip,
                      selected && styles.filterChipSelected,
                    ]}
                    onPress={() => handleRadiusChange(km)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selected && styles.filterChipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          {locationError ? (
            <Text style={styles.locationErrorText}>{locationError}</Text>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.searchContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <View style={styles.resultsSection} onLayout={handleResultsLayout}>
            <View style={styles.resultsHeader}>
              <Text style={styles.sectionTitle}>Results</Text>
              {hasSearched && !providersLoading ? (
                <Text style={styles.resultsCount}>
                  {filteredProviders.length} providers
                </Text>
              ) : null}
            </View>

            {!hasSearched && (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateTitle}>
                  Ready to discover your next service?
                </Text>
                <Text style={styles.emptyStateText}>
                  Search by profession or provider name to see who is available.
                  Use the distance chips to filter nearby options.
                </Text>
              </View>
            )}

            {providersLoading && hasSearched && (
              <View style={styles.skeletonList}>
                {[0, 1, 2].map((item) => (
                  <View key={item} style={styles.skeletonCard}>
                    <View style={styles.skeletonAvatar} />
                    <View style={styles.skeletonDetails}>
                      <View style={styles.skeletonLine} />
                      <View style={styles.skeletonLineShort} />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {!providersLoading && providersError && hasSearched && (
              <Text style={styles.errorText}>{providersError}</Text>
            )}

            {!providersLoading &&
              !providersError &&
              hasSearched &&
              filteredProviders.length === 0 && (
                <Text style={styles.emptyStateText}>
                  {incomingUsername
                    ? "We couldn't find that provider. Please check the username."
                    : "No providers found. Try adjusting your search or distance filter."}
                </Text>
              )}

            {!providersLoading &&
              !providersError &&
              hasSearched &&
              filteredProviders.length > 0 &&
              searchCards}
          </View>

                        {/* Services list for selected provider */}
                      {selectedProvider && (
                        <View style={styles.card}>
                          <Text style={styles.sectionTitle}>
                            Services by {selectedProvider.name}
                          </Text>

                          {/* Catalog preview */}
                          {catalogLoading && (
                            <View style={{ paddingVertical: 8 }}>
                              <ActivityIndicator />
                              <Text style={styles.serviceMeta}>Loading photos…</Text>
                            </View>
                          )}

                          {!catalogLoading && catalogError ? (
                            <Text style={styles.errorText}>{catalogError}</Text>
                          ) : null}

                          {!catalogLoading &&
                            !catalogError &&
                            catalogImages.length > 0 && (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.searchCatalogStrip}
                              >
                                {catalogImages.map((img) => (
                                  <Image
                                    key={img.id}
                                    source={{ uri: img.image_url }}
                                    style={styles.searchCatalogImage}
                                  />
                                ))}
                              </ScrollView>
                            )}

                          {servicesLoading && (
                            <View style={{ paddingVertical: 10 }}>
                              <ActivityIndicator />
                              <Text style={styles.serviceMeta}>Loading services…</Text>
                            </View>
                          )}


                    {servicesLoading && (
                      <View style={{ paddingVertical: 10 }}>
                        <ActivityIndicator />
                        <Text style={styles.serviceMeta}>Loading services…</Text>
                      </View>
                    )}

                    {!servicesLoading && servicesError ? (
                      <Text style={styles.errorText}>{servicesError}</Text>
                    ) : null}

                    {!servicesLoading &&
                      !servicesError &&
                      services.length === 0 && (
                        <Text style={styles.serviceHint}>
                          This provider has not added any services yet.
                        </Text>
                      )}

                    {!servicesLoading &&
                      !servicesError &&
                      (Array.isArray(services) ? services : []).map((s) => {
                        const isSelected =
                          selectedService && selectedService.id === s.id;
                        return (
                          <TouchableOpacity
                            key={s.id}
                            style={[
                              styles.serviceRow,
                              isSelected && { borderColor: colors.primary, borderWidth: 1 },
                            ]}
                            onPress={() => handleSelectService(s)}
                          >
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text style={styles.serviceName}>{s.name}</Text>
                              <Text style={styles.serviceMeta}>
                                {s.duration_minutes} min
                              </Text>
                              {s.description ? (
                                <Text style={styles.serviceMeta}>{s.description}</Text>
                              ) : null}
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              {s.price_gyd != null && (
                                <Text style={styles.servicePrice}>
                                  {s.price_gyd.toLocaleString()} GYD
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                )}

                {/* Calendar for selected service */}
                {selectedService && (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Choose a date</Text>

                    {availabilityLoading && (
                      <View style={{ paddingVertical: 10 }}>
                        <ActivityIndicator />
                        <Text style={styles.serviceMeta}>Loading availability…</Text>
                      </View>
                    )}

                    {!availabilityLoading && availabilityError ? (
                      <Text style={styles.errorText}>{availabilityError}</Text>
                    ) : null}

                    {!availabilityLoading && !availabilityError && (
                      <>
                        {calendarDays.every((d) => !d.hasSlots) ? (
                          <Text style={styles.serviceHint}>
                            No available dates in the next 14 days.
                          </Text>
                        ) : (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ marginTop: 8 }}
                          >
                            {calendarDays.map((d) => {
                              const isSelected = selectedDate === d.key;
                              const disabled = !d.hasSlots;

                              return (
                                <TouchableOpacity
                                  key={d.key}
                                  disabled={disabled}
                                  onPress={() => {
                                    setSelectedDate(d.key);
                                    setSelectedSlot(null);
                                  }}
                                  style={[
                                    styles.datePill,
                                    disabled && styles.datePillDisabled,
                                    isSelected && styles.datePillSelected,
                                  ]}
                                >
                                  <Text style={styles.datePillDow}>
                                    {d.date.toLocaleDateString("en-US", {
                                      weekday: "short",
                                    })}
                                  </Text>
                                  <Text style={styles.datePillDay}>
                                    {d.date.getDate()}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        )}
                      </>
                    )}
                  </View>
                )}

                {/* Time slots for selected date */}
                {selectedService && selectedDate && (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Available time slots</Text>

                    {(availabilityMap[selectedDate] || []).length === 0 ? (
                      <Text style={styles.serviceHint}>
                        No available times for this date.
                      </Text>
                    ) : (
                      <View style={styles.timesContainer}>
                        {availabilityMap[selectedDate].map((slotIso) => {
                          const isSelected = selectedSlot === slotIso;
                          return (
                            <TouchableOpacity
                              key={slotIso}
                              style={[
                                styles.timeSlotButton,
                                isSelected && styles.timeSlotButtonSelected,
                              ]}
                              onPress={() => setSelectedSlot(slotIso)}
                            >
                              <Text
                                style={[
                                  styles.timeSlotLabel,
                                  isSelected && styles.timeSlotLabelSelected,
                                ]}
                              >
                                {formatTimeLabel(slotIso)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}

                {/* Book button */}
                {selectedService && selectedDate && (
                  <View style={{ marginTop: 12, marginBottom: 20 }}>
                    <TouchableOpacity
                      style={[
                        styles.bookButton,
                        (!selectedSlot || bookingLoading) && styles.bookButtonDisabled,
                      ]}
                      disabled={!selectedSlot || bookingLoading}
                      onPress={handleBookAppointment}
                    >
                      <Text style={styles.bookButtonLabel}>
                        {bookingLoading ? "Booking..." : "Book Appointment"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
              </SafeAreaView>
         );
      }






function ProviderDashboardScreen({ apiClient, token, showFlash }) {
  // const providerLabel = profile?.full_name || "Provider";
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState("30");
  const [newDescription, setNewDescription] = useState("");
  const [isSavingService, setIsSavingService] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState("");
  const [workingHours, setWorkingHours] = useState([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursError, setHoursError] = useState("");
  const [showHours, setShowHours] = useState(false);
  const [hoursFlash, setHoursFlash] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profile, setProfile] = useState({
    full_name: "",
    phone: "",
    whatsapp: "",
    location: "",
    bio: "",
    professions: [],
    username: "",
  });
  const [provider, setProvider] = useState(null);  // 👈 add this


const providerLabel =
  (profile?.full_name && profile.full_name.trim()) ||
  token?.email ||
  "Provider";


const [customProfession, setCustomProfession] = useState("");
const [providerSummary, setProviderSummary] = useState(null);
const [todayBookings, setTodayBookings] = useState([]);
const [todayLoading, setTodayLoading] = useState(false);
const [todayError, setTodayError] = useState("");
const [upcomingBookings, setUpcomingBookings] = useState([]);
const [upcomingLoading, setUpcomingLoading] = useState(false);
const [upcomingError, setUpcomingError] = useState("");
const [providerLocation, setProviderLocation] = useState(null);
const [focusedHoursField, setFocusedHoursField] = useState(null);
const [avatarUrl, setAvatarUrl] = useState(null);
// Catalog (portfolio images)
const [catalog, setCatalog] = useState([]);
const [catalogLoading, setCatalogLoading] = useState(false);
const [catalogError, setCatalogError] = useState("");
const [catalogUploading, setCatalogUploading] = useState(false);
const isProviderUser = token?.isProvider || token?.is_provider;
const providerUsername =
  provider?.user?.username ||
  profile?.username ||
  token?.user?.username ||
  token?.username;
const providerProfileLink = buildProviderPublicLink(providerUsername);

const parseServiceNumber = useCallback((value) => {
  const normalized = String(value || "").replace(/[,\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}, []);

const validateServiceFields = useCallback((name, price, duration) => {
  const errors = { name: "", price: "", duration: "" };
  const trimmedName = String(name || "").trim();
  const priceNumber = parseServiceNumber(price);
  const durationNumber = parseServiceNumber(duration);

  if (!trimmedName) {
    errors.name = "Service name is required.";
  }

  if (!priceNumber || priceNumber <= 0) {
    errors.price = "Enter a price greater than 0.";
  }

  if (!durationNumber || durationNumber <= 0) {
    errors.duration = "Enter a duration greater than 0.";
  }

  return errors;
}, [parseServiceNumber]);

const serviceErrors = useMemo(
  () => validateServiceFields(newName, newPrice, newDuration),
  [newName, newPrice, newDuration, validateServiceFields]
);

const isServiceFormValid =
  !serviceErrors.name &&
  !serviceErrors.price &&
  !serviceErrors.duration;


const handleShareProfileLink = async () => {
  if (!providerProfileLink) {
    if (showFlash) {
      showFlash("error", "Set a username to enable your profile link.");
    }
    return;
  }

  try {
    await Share.share({
      message: providerProfileLink,
      url: providerProfileLink,
      title: "My BookitGY profile link",
    });
  } catch (err) {
    console.log("Error sharing provider profile link", err?.message || err);
    if (showFlash) {
      showFlash("error", "Could not share your profile link.");
    }
  }
};



  useEffect(() => {
    loadServices();
    loadBookings();
    loadWorkingHours();
    loadTodayBookings();
    loadUpcomingBookings(); 
    loadProviderLocation(); 
    loadProviderSummary();
    loadProviderProfile();
    loadCatalog();



  }, []);

  useFocusEffect(
  useCallback(() => {
    // Re-fetch profile (and anything else you want live-updated)
    loadProviderProfile();
    // optional: also refresh bookings, summary, etc.
    // loadTodayBookings();
    // loadUpcomingBookings();
    // loadProviderSummary();

    // No cleanup needed
    return () => {};
  }, [])
);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);

    await Promise.all([
      loadServices(),
      loadBookings(),
      loadWorkingHours(),
      loadTodayBookings(),
      loadUpcomingBookings(),
      loadProviderSummary(),
      loadProviderProfile(),
      loadProviderLocation(),
      loadCatalog(),
    ]);

    setRefreshing(false);
  }, [
    loadServices,
    loadBookings,
    loadWorkingHours,
    loadTodayBookings,
    loadUpcomingBookings,
    loadProviderSummary,
    loadProviderProfile,
    loadProviderLocation,
    loadCatalog,
  ]);

const resetForm = () => {
    setNewName("");
    setNewPrice("");
    setNewDuration("30");
    setNewDescription("");
  };

const loadBookings = async () => {
    try {
      setBookingsLoading(true);
      setBookingsError("");

      const authToken = await getAuthToken(token);
      if (!authToken) {
        setBookingsError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/providers/me/bookings`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      setBookings(res.data || []);
    } catch (err) {
      console.log("Error loading bookings", err.response?.data || err.message);
      setBookingsError("Could not load bookings.");
      if (showFlash) {
        showFlash("error", "Could not load bookings.");
      }
    } finally {
      setBookingsLoading(false);
    }
  };

const loadWorkingHours = async () => {
  try {
    setHoursLoading(true);
    setHoursError("");

    const authToken = await getAuthToken(token);
    if (!authToken) {
      setHoursError("No access token found. Please log in again.");
      return;
    }

    const res = await axios.get(`${API}/providers/me/working-hours`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    const rows = Array.isArray(res.data) ? res.data : [];

    // Map backend fields -> local editable fields
    const mapped = rows.map((row) => ({
      ...row,
      startLocal: row.start_time ? to12Hour(row.start_time) : "",
      endLocal: row.end_time ? to12Hour(row.end_time) : "",
    }));

     setWorkingHours(mapped);
  } catch (err) {
    console.log(
      "Error loading working hours:",
      err.response?.status,
      err.response?.data || err.message
    );
    const detail =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      "Could not load working hours.";
    setHoursError(detail);
    if (showFlash) showFlash("error", detail);
  } finally {
    setHoursLoading(false);
  }
};



const loadTodayBookings = async () => {
  try {
    const authToken = await getAuthToken(token);
    const res = await axios.get(
      `${API}/providers/me/bookings/today`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    setTodayBookings(res.data || []);
  } catch (error) {
    setTodayBookingsError(true);
  }
};

useEffect(() => {
  const intervalId = setInterval(() => {
    loadTodayBookings();
  }, 60 * 1000);

  return () => clearInterval(intervalId);
}, []);


const handleCancelBooking = (bookingId) => {
  Alert.alert(
    "Cancel booking",
    "Are you sure you want to cancel this booking?",
    [
      { text: "No", style: "cancel" },
      {
        text: "Yes, cancel",
        style: "destructive",
          onPress: async () => {
          try {
            const authToken = await getAuthToken(token);
            if (!authToken) {
              if (showFlash) showFlash("error", "No access token found.");
              return;
            }

            await axios.post(
              `${API}/providers/me/bookings/${bookingId}/cancel`,
              {},
              {
                headers: {
                  Authorization: `Bearer ${authToken}`,
                },
              }
            );

            if (showFlash) showFlash("success", "Booking cancelled");

            // 🔹 Optimistically remove from both lists so UI updates immediately
            setTodayBookings((prev) =>
              (prev || []).filter((b) => b.id !== bookingId)
            );
            setUpcomingBookings((prev) =>
              (prev || []).filter((b) => b.id !== bookingId)
            );

            // 🔹 (Optional) also re-sync with backend
            // await Promise.all([loadTodayBookings(), loadUpcomingBookings()]);
          } catch (err) {
            console.log(
              "Error cancelling booking",
              err.response?.data || err.message
            );
            if (showFlash) showFlash("error", "Could not cancel booking.");
          }
        },
      },
    ]
  );
};


 

const loadServices = async () => {
    try {
      setLoading(true);
      setServicesError("");

      const authToken = await getAuthToken(token);
      if (!authToken) {
        setServicesError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/providers/me/services`, {
        headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

        // 🔒 Always normalize to an array
    const rawServices = res.data;
    const list = Array.isArray(rawServices)
      ? rawServices
      : rawServices?.services || rawServices?.results || [];

    setServices(list || []);

    } catch (err) {
      console.log("Error loading services", err.response?.data || err.message);
      setServicesError("Could not load services.");
      if (showFlash) {
        showFlash("error", "Could not load services.");
      }
    } finally {
      setLoading(false);
    }
  };

const saveWorkingHours = async () => {
  try {
    const authToken = await getAuthToken(token);
    if (!authToken) {
      if (showFlash) showFlash("error", "No access token found.");
      setHoursFlash({ type: "error", message: "No access token found." });
      setTimeout(() => setHoursFlash(null), 4000);
      return;
    }

    // Validate and build payload
    const payload = [];
    for (const h of workingHours) {
      const start24 = to24Hour(h.startLocal);
      const end24 = to24Hour(h.endLocal);

      if (!h.is_closed) {
        // For open days, both times must be valid
        if (!start24 || !end24) {
          const dayNames = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ];
          const label = dayNames[h.weekday] || `Day ${h.weekday}`;
          const msg = `Please enter valid start and end times for ${label}.`;
          if (showFlash) showFlash("error", msg);
          setHoursFlash({ type: "error", message: msg });
          setTimeout(() => setHoursFlash(null), 4000);
          return;
        }

        // And end must be after start
        const [sh, sm] = start24.split(":").map((n) => parseInt(n, 10));
        const [eh, em] = end24.split(":").map((n) => parseInt(n, 10));
        const startMinutes = sh * 60 + sm;
        const endMinutes = eh * 60 + em;

        if (endMinutes <= startMinutes) {
          const dayNames = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ];
          const label = dayNames[h.weekday] || `Day ${h.weekday}`;
          const msg = `End time must be after start time for ${label}.`;
          if (showFlash) showFlash("error", msg);
          setHoursFlash({ type: "error", message: msg });
          setTimeout(() => setHoursFlash(null), 4000);
          return;
        }
      }

      payload.push({
        weekday: h.weekday,
        is_closed: h.is_closed,
        start_time: h.is_closed ? null : start24,
        end_time: h.is_closed ? null : end24,
      });
    }

    
    await axios.put(`${API}/providers/me/working-hours`, payload, {
      headers: { Authorization: `Bearer ${authToken}` },
    });


    // if (showFlash) showFlash("success", "Working hours saved");
    setHoursFlash({ type: "success", message: "Working hours saved" });
    setTimeout(() => setHoursFlash(null), 4000);
  } catch (err) {
    console.log(
      "Error saving working hours",
      err.response?.data || err.message
    );
    if (showFlash) showFlash("error", "Could not save working hours.");
    setHoursFlash({ type: "error", message: "Could not save working hours." });
    setTimeout(() => setHoursFlash(null), 4000);
  }
};

// Convert "HH:MM" → "h:MM AM/PM" (safe)
const to12Hour = (time24) => {
  if (!time24 || typeof time24 !== "string") return "";

  if (!time24.includes(":")) return "";

  let [h, m] = time24.split(":");

  h = parseInt(h, 10);
  m = parseInt(m, 10);

  if (isNaN(h) || isNaN(m)) return "";

  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;

  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
};


// Convert "h:MM AM/PM" → "HH:MM" safely
// "h:MM AM/PM" or "1000am" / "930 PM" / "10" -> "HH:MM"
const to24Hour = (time12) => {
      if (!time12) return "";

      let raw = time12.trim().toUpperCase();

      // 1) Extract AM/PM if present
      let suffix = null;
      if (raw.endsWith("AM")) {
        suffix = "AM";
        raw = raw.slice(0, -2).trim();
      } else if (raw.endsWith("PM")) {
        suffix = "PM";
        raw = raw.slice(0, -2).trim();
      }

      // 2) Remove any remaining spaces
      raw = raw.replace(/\s+/g, "");

      let h, m;

      if (raw.includes(":")) {
        // Normal "h:mm" or "hh:mm"
        const parts = raw.split(":");
        if (parts.length !== 2) return "";
        h = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
      } else if (/^\d+$/.test(raw)) {
        // Only digits like "1000", "930", "10"
        if (raw.length === 4) {
          // "1000" -> 10:00, "0930" -> 9:30
          h = parseInt(raw.slice(0, 2), 10);
          m = parseInt(raw.slice(2, 4), 10);
        } else if (raw.length === 3) {
          // "930" -> 9:30
          h = parseInt(raw.slice(0, 1), 10);
          m = parseInt(raw.slice(1, 3), 10);
        } else if (raw.length <= 2) {
          // "9" or "10" -> 9:00 / 10:00
          h = parseInt(raw, 10);
          m = 0;
        } else {
          return "";
        }
      } else {
        // Invalid format
        return "";
      }

      // 3) Validate ranges: must be real clock time
      if (
        isNaN(h) ||
        isNaN(m) ||
        h < 0 ||
        h > 23 ||
        m < 0 ||
        m > 59
      ) {
        return "";
      }

      // 4) Default to AM if no suffix provided
      if (!suffix) suffix = "AM";

      // 5) Convert to 24h
      if (suffix === "PM" && h !== 12) h += 12;
      if (suffix === "AM" && h === 12) h = 0;

      // 6) Return "HH:MM"
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};



  const handleAddService = async () => {
  if (isSavingService) return;
  if (!isServiceFormValid) return;

  const currentErrors = validateServiceFields(newName, newPrice, newDuration);
  const isValid =
    !currentErrors.name &&
    !currentErrors.price &&
    !currentErrors.duration;

  if (!isValid) {
    if (showFlash) {
      showFlash(
        "error",
        currentErrors.name ||
          currentErrors.price ||
          currentErrors.duration
      );
    }
    return;
  }

  const priceNumber = parseServiceNumber(newPrice);
  const durationNumber = parseServiceNumber(newDuration);

  try {
    setIsSavingService(true);
    const authToken = await getAuthToken(token);
    if (!authToken) {
      if (showFlash) showFlash("error", "No access token found.");
      return;
    }

    const payload = {
      name: newName.trim(),
      description: newDescription.trim(),
      duration_minutes: durationNumber,
      price_gyd: priceNumber,
    };

    // ✅ Create service on backend and get the created record back
    const res = await axios.post(
      `${API}/providers/me/services`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    const created = res.data;

    // ✅ Optimistically add to local list so it shows immediately
    setServices((prev) => {
      const prevArr = Array.isArray(prev) ? prev : [];
      return [...prevArr, created];
    });

    if (showFlash) {
      showFlash("success", "Service created");
    }

    // Reset form + close add UI
    resetForm();
    setAdding(false);

    // Optional: background refresh to stay in sync with backend
    loadServices();
  } catch (err) {
    console.log("Error creating service", err.response?.data || err.message);
    if (showFlash) {
      const detail =
        err.response?.data?.detail || "Could not create service.";
      showFlash("error", detail);
    }
  } finally {
    setIsSavingService(false);
  }
};


  const handleDeleteService = async (serviceId) => {
    try {
      const authToken = await getAuthToken(token);
      if (!authToken) {
        if (showFlash) showFlash("error", "No access token found.");
        return;
      }

      const res = await axios.delete(`${API}/providers/me/services/${serviceId}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const responseData = res?.data || {};
      const responseStatus = `${responseData.status || responseData.result || ""}`.toLowerCase();
      const responseMessage =
        responseData.detail || responseData.message || responseData.error || "";
      const responseText = `${responseStatus} ${responseMessage}`.toLowerCase();
      const hasBookings = responseText.includes("booking");

      if (showFlash) {
        if (hasBookings) {
          showFlash(
            "info",
            "This service has bookings and was archived instead."
          );
        } else {
          showFlash("success", "Service removed from your list.");
        }
      }

      await loadServices();
    } catch (err) {
      console.log("Error deleting service", err.response?.data || err.message);
      const status = err.response?.status;
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.response?.data?.error ||
        "";
      const hasBookings =
        status === 409 || String(detail).toLowerCase().includes("booking");

      if (hasBookings) {
        if (showFlash) {
          showFlash(
            "info",
            "This service has bookings and was archived instead."
          );
        }
        await loadServices();
        return;
      }

      if (showFlash) {
        showFlash("error", detail || "Could not delete service.");
      }
    }
  };


  const todayBookingsCount = () => {
    if (!bookings || bookings.length === 0) return 0;

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    return bookings.filter((b) => {
      const start = new Date(b.start_time);
      return (
        start.getFullYear() === y &&
        start.getMonth() === m &&
        start.getDate() === d
      );
    }).length;
  };

const loadProviderProfile = async () => {
  try {
    setProfileLoading(true);
    setProfileError("");

    const storedToken = await loadToken();
    if (!storedToken) {
      setProfileError("No access token found. Please log in again.");
      return;
    }

    const res = await apiClient.get("/providers/me/profile");

      setProfile({
        full_name: res.data.full_name || "",
        phone: res.data.phone || "",
        whatsapp: res.data.whatsapp || "",
        location: res.data.location || "",
        bio: res.data.bio || "",
        professions: res.data.professions || [],
        username: res.data.username || "",
      });

      setAvatarUrl(res.data.avatar_url || null);

  } catch (err) {
    console.log("Error loading provider profile", err.response?.data || err.message);
    setProfileError("Could not load provider profile.");
    if (showFlash) showFlash("error", "Could not load provider profile.");
  } finally {
    setProfileLoading(false);
  }
};

const loadCatalog = async () => {
  try {
    setCatalogLoading(true);
    setCatalogError("");

    const authToken = await getAuthToken(token);
    if (!authToken) {
      setCatalogError("No access token found. Please log in again.");
      return;
    }

    const res = await axios.get(`${API}/providers/me/catalog`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    setCatalog(Array.isArray(res.data) ? res.data : []);
  } catch (err) {
    console.log(
      "Error loading provider catalog",
      err.response?.data || err.message
    );
    const detail =
      err.response?.data?.detail ||
      "Could not load your catalog images.";
    setCatalogError(detail);
    if (showFlash) showFlash("error", detail);
  } finally {
    setCatalogLoading(false);
  }
};


const uploadCatalogImage = async (uri) => {
  try {
    setCatalogUploading(true);

    const authToken = await getAuthToken(token);
    if (!authToken) {
      alert("No access token found. Please log in again.");
      return;
    }

    const filename = uri.split("/").pop() || "catalog.jpg";
    const match = /\.(\w+)$/.exec(filename);
    const ext = match ? match[1].toLowerCase() : "jpg";

    let mimeType = "image/jpeg";
    if (ext === "png") mimeType = "image/png";
    else if (ext === "webp") mimeType = "image/webp";

    const formData = new FormData();
    formData.append("file", {
      uri,
      name: filename,
      type: mimeType,
    });

    const res = await axios.post(`${API}/providers/me/catalog`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${authToken}`,
      },
    });

    const created = res.data;
    setCatalog((prev) => [created, ...(prev || [])]);

    if (showFlash) showFlash("success", "Photo added to your catalog");
  } catch (err) {
    console.log(
      "Error uploading catalog image",
      err.response?.data || err.message
    );
    const detail =
      err.response?.data?.detail ||
      "Could not upload image. Please try again.";
    if (showFlash) showFlash("error", detail);
  } finally {
    setCatalogUploading(false);
  }
};


const pickCatalogImage = async () => {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5], // portrait-ish
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets && result.assets[0];
    if (!asset || !asset.uri) {
      return;
    }

    await uploadCatalogImage(asset.uri);
  } catch (err) {
    console.log("Error picking catalog image", err);
    alert("Could not open your gallery. Please try again.");
  }
};


const handleDeleteCatalogImage = (imageId) => {
  Alert.alert(
    "Remove photo",
    "Do you want to remove this photo from your catalog?",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            const authToken = await getAuthToken(token);
            if (!authToken) {
              alert("No access token found. Please log in again.");
              return;
            }

            await axios.delete(`${API}/providers/me/catalog/${imageId}`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });

            setCatalog((prev) =>
              (prev || []).filter((img) => img.id !== imageId)
            );

            if (showFlash) {
              showFlash("success", "Photo removed from your catalog");
            }
          } catch (err) {
            console.log(
              "Error deleting catalog image",
              err.response?.data || err.message
            );
            const detail =
              err.response?.data?.detail ||
              "Could not remove photo. Please try again.";
            if (showFlash) showFlash("error", detail);
          }
        },
      },
    ]
  );
};


const saveProviderProfile = async () => {
  try {
    const authToken = await getAuthToken(token);
    if (!authToken) {
      if (showFlash) showFlash("error", "No access token found.");
      return;
    }

    const payload = {
      full_name: profile.full_name,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      location: profile.location,
      bio: profile.bio,
      professions: profile.professions || [],
    };

    // ✅ Save provider profile to backend
    const res = await axios.put(
      `${API}/providers/me/profile`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    // ✅ Update local state from server response so UI reflects what’s saved
    setProfile({
      full_name: res.data.full_name || "",
      phone: res.data.phone || "",
      whatsapp: res.data.whatsapp || "",
      location: res.data.location || "",
      bio: res.data.bio || "",
      professions: res.data.professions || [],
      username: res.data.username || "",
    });

    // ✅ Show success flash in the green bar
    setHoursFlash({ type: "success", message: "Provider profile saved" });
    setTimeout(() => setHoursFlash(null), 4000);
  } catch (err) {
    console.log("Error saving provider profile", err.response?.data || err.message);

    setHoursFlash({ type: "error", message: "Provider profile not saved" });
    setTimeout(() => setHoursFlash(null), 4000);

    if (showFlash) {
      const detail =
        err.response?.data?.detail || "Could not save provider profile.";
      showFlash("error", detail);
    }
  }
};

const pickAvatar = async () => {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled) return;

    const asset = result.assets && result.assets[0];
    if (!asset || !asset.uri) return;

    await uploadAvatar(asset.uri);
  } catch (err) {
    console.log("Error picking avatar", err);
  }
};


const uploadAvatar = async (uri) => {
  try {
    const storedToken = await loadToken();
    if (!storedToken) {
      alert("No access token found. Please log in again.");
      return;
    }

    const filename = uri.split("/").pop() || "avatar.jpg";
    const match = /\.(\w+)$/.exec(filename);
    const ext = match ? match[1] : "jpg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    const formData = new FormData();
    formData.append("file", {
      uri,
      name: filename,
      type: mimeType,
    });

    // Decide which endpoint to use: client vs provider
    let endpoint = "/users/me/avatar"; // default: client

    try {
      const meRes = await apiClient.get("/users/me");

      if (meRes.data?.is_provider) {
        // logged-in user is a provider → use provider avatar endpoint
        endpoint = "/providers/me/avatar";
      }
    } catch (e) {
      console.log(
        "Could not determine user type for avatar upload; using /users/me/avatar",
        e.response?.data || e.message
      );
    }

    // Upload to the chosen endpoint
    const res = await apiClient.post(endpoint, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    const newUrl = res.data.avatar_url;

    // update avatar in this screen
    setAvatarUrl(newUrl);

    // if this screen has a provider object, keep it in sync (no-op for pure clients)
    if (typeof setProvider === "function") {
      setProvider((prev) => (prev ? { ...prev, avatar_url: newUrl } : prev));
    }
  } catch (err) {
    console.log("Avatar upload error:", err.response?.data || err.message);
    alert("Failed to upload avatar. Please try again.");
  }
};


const loadUpcomingBookings = async () => {
  try {
    const authToken = await getAuthToken(token);
    const res = await axios.get(
      `${API}/providers/me/bookings/upcoming`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    setUpcomingBookings(res.data || []);
  } catch (error) {
    setUpcomingBookingsError(true);
  }
};



const getCurrentLocation = async () => {
  let { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    return null;
  }

  const loc = await Location.getCurrentPositionAsync({});
  return {
    lat: loc.coords.latitude,
    long: loc.coords.longitude
  };
};


const handlePinLocation = async () => {
  try {
    const authToken = await getAuthToken(token);
    if (!authToken) {
      if (showFlash) showFlash("error", "No access token found. Please log in again.");
      return;
    }

    const coords = await getCurrentLocation();
    if (!coords) {
      Alert.alert(
        "Permission needed",
        "Location permission is required to pin your business on the map."
      );
      if (showFlash) showFlash("error", "Location permission denied.");
      return;
    }

    // 1) update the user record
    await axios.put(
      `${API}/users/me`,
      { lat: coords.lat, long: coords.long },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    // 2) ALSO update the provider record so searches & client view use it
    await axios.put(
      `${API}/providers/me/location`,
      { lat: coords.lat, long: coords.long },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    // 3) update local state so preview uses the latest coords
    setProviderLocation(coords);

    if (showFlash) showFlash("success", "Business location pinned here.");
    Alert.alert(
      "Location pinned",
      "Clients will now navigate to this location."
    );
  } catch (err) {
    console.log("Error pinning location", err.response?.data || err.message);
    if (showFlash) {
      const msg =
        err.response?.data?.detail ||
        err.response?.data?.message ||
        "Could not pin business location.";
      showFlash("error", msg);
    }
  }
};

const loadProviderLocation = async () => {
  try {
    const storedToken = await loadToken();
    if (!storedToken) return;

     const res = await apiClient.get("/users/me");

    if (res.data.lat != null && res.data.long != null) {
      setProviderLocation({
        lat: res.data.lat,
        long: res.data.long,
      });
    }
  } catch (err) {
    console.log("Error loading provider location", err.response?.data || err.message);
  }
};

const loadProviderSummary = async () => {
  try {
    const authToken = await getAuthToken(token);
    if (!authToken) return;

    const res = await axios.get(`${API}/providers/me/summary`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    setProviderSummary(res.data);
  } catch (err) {
    console.log(
      "Error loading provider summary",
      err.response?.data || err.message
    );
  }
};

  const insets = useSafeAreaInsets();
  // const headerMinHeight =
  //   insets.top + HEADER_LOGO_HEIGHT + HEADER_VERTICAL_PADDING * 2;
  const headerPaddingVertical = HEADER_VERTICAL_PADDING;

  return (
    <View style={styles.homeWrapper}>
      {hoursFlash && (
        <View
          style={[
            styles.hoursFlashGlobal,
            hoursFlash.type === "error"
              ? styles.hoursFlashError
              : styles.hoursFlashSuccess,
          ]}
        >
          <Text style={styles.hoursFlashText}>{hoursFlash.message}</Text>
        </View>
      )}

      <View
        style={[
          styles.pinnedHeader,
          // headerMinHeight ? { minHeight: headerMinHeight } : null,
        ]}
      >
        <View
          style={[
            styles.pinnedHeaderSafeArea,
            {
              paddingTop: Platform.OS === "ios" ? 6 : 6,
              paddingBottom: headerPaddingVertical,
            },
          ]}
        >
          <Image
            source={BookitGYLogoTransparent}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.providerScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.homeHeader}>
          <Text style={styles.homeGreeting}>Provider dashboard</Text>
          <Text style={styles.homeSubtitle}>Welcome, {providerLabel}</Text>
        </View>
    
        {/*Account Info */}
        {providerSummary && (
          <View style={styles.providerSummaryCard}>
            <Text style={styles.providerSummaryLabel}>Account number</Text>
            <Text style={styles.providerSummaryValue}>
              {providerSummary.account_number || "N/A"}
            </Text>
          </View>
        )}

        {/* TODAY overview */}
        <View style={styles.card}>
          <Text style={styles.label}>TODAY</Text>

          {todayLoading && (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading today&apos;s bookings…</Text>
            </View>
          )}

          {!todayLoading && todayError ? (
            <Text style={styles.errorText}>{todayError}</Text>
          ) : null}

          {!todayLoading && !todayError && todayBookings.length === 0 && (
            <>
              <Text style={styles.value}>0 bookings</Text>
              <Text style={styles.serviceMeta}>
                Once bookings are added, you’ll see your daily schedule here.
              </Text>
            </>
          )}

          {!todayLoading && !todayError && todayBookings.length > 0 && (
            <>
              <Text style={styles.value}>
                {todayBookings.length} booking
                {todayBookings.length > 1 ? "s" : ""}
              </Text>

              {todayBookings.map((b) => {
                const start = new Date(b.start_time);
                const end = new Date(b.end_time);

                const formatTime = (dt) => {
                  const d = new Date(dt);
                  let h = d.getHours();
                  const m = d.getMinutes();
                  const suffix = h >= 12 ? "PM" : "AM";
                  h = h % 12 || 12;
                  const mm = m.toString().padStart(2, "0");
                  return `${h}:${mm} ${suffix}`;
                };

                return (
                  <View key={b.id} style={styles.bookingRow}>
                    <View style={styles.bookingMain}>
                      <Text style={styles.bookingTime}>
                        {formatTime(start)} – {formatTime(end)}
                      </Text>
                      <Text style={styles.bookingService}>{b.service_name}</Text>
                      <Text style={styles.bookingMeta}>
                        {b.customer_name} · {b.customer_phone}
                      </Text>
                    </View>

                    <View style={styles.bookingActions}>
                      {/* <TouchableOpacity onPress={() => handleEditBooking(b)}>
                        <Text style={styles.bookingEdit}>Edit</Text>
                      </TouchableOpacity> */}
                      <TouchableOpacity
                        onPress={() => handleCancelBooking(b.id)}
                      >
                        <Text style={styles.bookingCancel}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </View>

        {/* Upcoming bookings */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upcoming bookings</Text>

          {upcomingLoading && (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>
                Loading upcoming bookings…
              </Text>
            </View>
          )}

          {!upcomingLoading && upcomingError ? (
            <Text style={styles.errorText}>{upcomingError}</Text>
          ) : null}

          {!upcomingLoading &&
            !upcomingError &&
            upcomingBookings.length === 0 && (
              <Text style={styles.serviceMeta}>
                No upcoming bookings for the next few days.
              </Text>
            )}

          {!upcomingLoading &&
            !upcomingError &&
            upcomingBookings.length > 0 && (
              <>
                {upcomingBookings.map((b) => {
                  const start = new Date(b.start_time);
                  const end = new Date(b.end_time);

                  const formatTime = (dt) => {
                    let h = dt.getHours();
                    const m = dt.getMinutes();
                    const suffix = h >= 12 ? "PM" : "AM";
                    h = h % 12 || 12;
                    return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
                  };

                  const formatDate = (dt) =>
                    dt.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });

                  return (
                    <View key={b.id} style={styles.bookingRow}>
                      <View style={styles.bookingMain}>
                        <Text style={styles.bookingTime}>
                          {formatDate(start)} · {formatTime(start)} –{" "}
                          {formatTime(end)}
                        </Text>
                        <Text style={styles.bookingService}>
                          {b.service_name}
                        </Text>
                        <Text style={styles.bookingMeta}>
                          {b.customer_name} · {b.customer_phone}
                        </Text>
                      </View>

                      <View style={styles.bookingActions}>
                        {/* <TouchableOpacity onPress={() => handleEditBooking(b)}>
                          <Text style={styles.bookingEdit}>Edit</Text>
                        </TouchableOpacity> */}
                        <TouchableOpacity
                          onPress={() => handleCancelBooking(b.id)}
                        >
                          <Text style={styles.bookingCancel}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
        </View>

        {/* Services */}
        <View style={styles.card}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text style={styles.sectionTitle}>Your services</Text>
            <TouchableOpacity onPress={() => setAdding((prev) => !prev)}>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                {adding ? "Cancel" : "+ Add"}
              </Text>
            </TouchableOpacity>
          </View>

          {adding && (
            <View style={{ marginBottom: 12 }}>
              <TextInput
                style={[
                  styles.input,
                  serviceErrors.name ? styles.inputError : null,
                ]}
                placeholder="Service name"
                placeholderTextColor={colors.textSecondary}
                value={newName}
                onChangeText={setNewName}
              />
              {serviceErrors.name ? (
                <Text style={styles.inputErrorText}>
                  {serviceErrors.name}
                </Text>
              ) : null}
              <TextInput
                style={[
                  styles.input,
                  serviceErrors.price ? styles.inputError : null,
                ]}
                placeholder="Price (GYD)"
                placeholderTextColor={colors.textSecondary}
                value={newPrice}
                onChangeText={setNewPrice}
                keyboardType="numeric"
              />
              {serviceErrors.price ? (
                <Text style={styles.inputErrorText}>
                  {serviceErrors.price}
                </Text>
              ) : null}
              <TextInput
                style={[
                  styles.input,
                  serviceErrors.duration ? styles.inputError : null,
                ]}
                placeholder="Duration (minutes)"
                placeholderTextColor={colors.textSecondary}
                value={newDuration}
                onChangeText={setNewDuration}
                keyboardType="numeric"
              />
              {serviceErrors.duration ? (
                <Text style={styles.inputErrorText}>
                  {serviceErrors.duration}
                </Text>
              ) : null}
              <TextInput
                style={[
                  styles.input,
                  { height: 80 },
                ]}
                placeholder="Description"
                placeholderTextColor={colors.textSecondary}
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
              />

              <View style={{ width: "100%", marginTop: 4 }}>
                <TouchableOpacity
                  style={[
                    styles.saveServiceButton,
                    isServiceFormValid && !isSavingService
                      ? styles.saveServiceButtonEnabled
                      : styles.saveServiceButtonDisabled,
                  ]}
                  onPress={handleAddService}
                  disabled={!isServiceFormValid || isSavingService}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: !isServiceFormValid || isSavingService,
                  }}
                  activeOpacity={0.8}
                >
                  {isSavingService ? (
                    <View style={styles.saveServiceButtonContent}>
                      <ActivityIndicator
                        size="small"
                        color={colors.textPrimary}
                        style={styles.saveServiceButtonSpinner}
                      />
                      <Text style={styles.saveServiceButtonText}>Saving…</Text>
                    </View>
                  ) : (
                    <Text style={styles.saveServiceButtonText}>
                      Save service
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {loading && (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading services…</Text>
            </View>
          )}

          {!loading && servicesError ? (
            <Text style={styles.errorText}>{servicesError}</Text>
          ) : null}

          {!loading && !servicesError && services.length === 0 && !adding && (
            <Text style={styles.serviceHint}>
              You have no services yet. Tap “+ Add” to create your first
              service.
            </Text>
          )}

           {!loading &&
            !servicesError &&
            (Array.isArray(services) ? services : []).map((s) => (
              <View key={s.id} style={styles.serviceRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.serviceName}>{s.name}</Text>
                  <Text style={styles.serviceMeta}>
                    {s.duration_minutes} min
                  </Text>
                  {s.description ? (
                    <Text style={styles.serviceMeta}>{s.description}</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {s.price_gyd != null && (
                    <Text style={styles.servicePrice}>
                      {s.price_gyd.toLocaleString()} GYD
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => handleDeleteService(s.id)}
                    style={{ marginTop: 4 }}
                  >
                    <Text style={{ fontSize: 12, color: colors.error }}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
        </View>

        {/* Working hours editor */}
        {showHours && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Working hours</Text>

            {hoursLoading && (
              <View style={{ paddingVertical: 10 }}>
                <ActivityIndicator />
                <Text style={styles.serviceMeta}>
                  Loading working hours…
                </Text>
              </View>
            )}

            {hoursError ? (
              <Text style={styles.errorText}>{hoursError}</Text>
            ) : null}

            {!hoursLoading &&
              !hoursError &&
              workingHours.map((h) => {
                const dayNames = [
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ];
                const label = dayNames[h.weekday] || `Day ${h.weekday}`;

                return (
                  <View key={h.id} style={styles.workingHoursRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serviceName}>{label}</Text>
                      <View style={{ flexDirection: "row", marginTop: 4 }}>
                        <Text style={styles.serviceMeta}>Open</Text>
                        <Switch
                          style={{ marginLeft: 8 }}
                          value={!h.is_closed}
                          onValueChange={(val) => {
                            setWorkingHours((prev) =>
                              prev.map((row) =>
                                row.id === h.id
                                  ? { ...row, is_closed: !val }
                                  : row
                              )
                            );
                          }}
                        />
                      </View>
                    </View>

                    {!h.is_closed && (
                      <View style={{ alignItems: "flex-end" }}>
                        <View style={{ flexDirection: "row" }}>
                          {/* Start time */}
                          <TextInput
                            style={[
                              styles.hoursInput,
                              focusedHoursField === `start-${h.id}` && styles.hoursInputFocused,
                            ]}
                            value={h.startLocal || ""}
                            onChangeText={(text) => {
                              setWorkingHours((prev) =>
                                prev.map((row) =>
                                  row.id === h.id ? { ...row, startLocal: text } : row
                                )
                              );
                            }}
                            onFocus={() => {
                              setFocusedHoursField(`start-${h.id}`);
                            }}
                            onBlur={() => {
                              setWorkingHours((prev) =>
                                prev.map((row) => {
                                  if (row.id !== h.id) return row;
                                  const as24 = to24Hour(row.startLocal);

                                  if (!as24) {
                                    return { ...row, startLocal: "" };
                                  }

                                  return { ...row, startLocal: to12Hour(as24) };
                                })
                              );
                              setFocusedHoursField(null);
                            }}
                            placeholder="9:00 AM"
                            placeholderTextColor={colors.textSecondary}
                          />
                         <Text style={styles.serviceMeta}> - </Text>

                          {/* End time */}
                         <TextInput
                            style={[
                              styles.hoursInput,
                              focusedHoursField === `end-${h.id}` && styles.hoursInputFocused,
                            ]}
                            value={h.endLocal || ""}
                            onChangeText={(text) => {
                              setWorkingHours((prev) =>
                                prev.map((row) =>
                                  row.id === h.id ? { ...row, endLocal: text } : row
                                )
                              );
                            }}
                            onFocus={() => {
                              setFocusedHoursField(`end-${h.id}`);
                            }}
                            onBlur={() => {
                              setWorkingHours((prev) =>
                                prev.map((row) => {
                                  if (row.id !== h.id) return row;
                                  const as24 = to24Hour(row.endLocal);

                                  if (!as24) {
                                    return { ...row, endLocal: "" };
                                  }

                                  return { ...row, endLocal: to12Hour(as24) };
                                })
                              );
                              setFocusedHoursField(null);
                            }}
                            placeholder="5:00 PM"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

            <View style={{ width: "100%", marginTop: 8 }}>
              <Button
                title="Save working hours"
                onPress={saveWorkingHours}
                color={colors.primary}
              />
            </View>
          </View>
        )}

        {/* Provider profile editor */}
        {showProfileEditor && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Provider profile</Text>
            <Text style={styles.hoursHelp}>
              This is what clients will see on your public profile.
            </Text>

            {profileLoading && (
              <View style={{ paddingVertical: 10 }}>
                <ActivityIndicator />
                <Text style={styles.serviceMeta}>Loading profile…</Text>
              </View>
            )}

            {profileError ? (
              <Text style={styles.errorText}>{profileError}</Text>
            ) : null}

            {!profileLoading && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Business / display name"
                  placeholderTextColor={colors.textSecondary}
                  value={profile.full_name}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, full_name: text }))
                  }
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone"
                  placeholderTextColor={colors.textSecondary}
                  value={profile.phone}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, phone: text }))
                  }
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={styles.input}
                  placeholder="WhatsApp"
                  placeholderTextColor={colors.textSecondary}
                  value={profile.whatsapp}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, whatsapp: text }))
                  }
                />
                <TextInput
                  style={styles.input}
                  placeholder="Location (e.g. Georgetown)"
                  placeholderTextColor={colors.textSecondary}
                  value={profile.location}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, location: text }))
                  }
                />
                <TextInput
                  style={[styles.input, { height: 80 }]}
                  placeholder="Short bio / description"
                  placeholderTextColor={colors.textSecondary}
                  value={profile.bio}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, bio: text }))
                  }
                  multiline
                />

                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Professions</Text>
                <Text style={styles.hoursHelp}>
                  Select all that apply. Clients will be able to search by these.
                </Text>

                <View style={styles.professionChipsContainer}>
                  {PROFESSION_OPTIONS.map((opt) => {
                    const selected = (profile.professions || []).some(
                      (p) => p.toLowerCase() === opt.toLowerCase()
                    );
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[
                          styles.professionChip,
                          selected && styles.professionChipSelected,
                        ]}
                        onPress={() => {
                          setProfile((prev) => {
                            const current = prev.professions || [];
                            const exists = current.some(
                              (p) => p.toLowerCase() === opt.toLowerCase()
                            );
                            return {
                              ...prev,
                              professions: exists
                                ? current.filter(
                                    (p) => p.toLowerCase() !== opt.toLowerCase()
                                  )
                                : [...current, opt],
                            };
                          });
                        }}
                      >
                        <Text
                          style={[
                            styles.professionChipText,
                            selected && styles.professionChipTextSelected,
                          ]}
                        >
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.customProfessionRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Add another profession (e.g. Tattoo Artist)"
                    placeholderTextColor={colors.textSecondary}
                    value={customProfession}
                    onChangeText={setCustomProfession}
                  />
                  <TouchableOpacity
                    style={styles.customProfessionAddButton}
                    onPress={() => {
                      const trimmed = customProfession.trim();
                      if (!trimmed) return;
                      setProfile((prev) => {
                        const current = prev.professions || [];
                        const exists = current.some(
                          (p) => p.toLowerCase() === trimmed.toLowerCase()
                        );
                        if (exists) return prev;
                        return {
                          ...prev,
                          professions: [...current, trimmed],
                        };
                      });
                      setCustomProfession("");
                    }}
                  >
                    <Text style={styles.customProfessionAddText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {(profile.professions || []).length > 0 && (
                  <Text style={styles.serviceMeta}>
                    Selected: {profile.professions.join(", ")}
                  </Text>
                )}

                <View style={{ width: "100%", marginTop: 12 }}>
                  <Button
                    title="Save provider profile"
                    onPress={saveProviderProfile}
                    color={colors.primary}
                  />
                </View>

              </>
            )}
          </View>
        )}

        {/* Catalog (portfolio) */}
        <View style={styles.card}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text style={styles.sectionTitle}>Catalog</Text>
            <TouchableOpacity
              onPress={pickCatalogImage}
              disabled={catalogUploading}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: "600",
                  opacity: catalogUploading ? 0.6 : 1,
                }}
              >
                {catalogUploading ? "Uploading…" : "+ Add photo"}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hoursHelp}>
            Add photos of your work. Clients will see these on your public
            profile.
          </Text>

          {catalogLoading && (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading catalog…</Text>
            </View>
          )}

          {catalogError ? (
            <Text style={styles.errorText}>{catalogError}</Text>
          ) : null}

          {!catalogLoading && !catalogError && catalog.length === 0 && (
            <Text style={styles.serviceMeta}>
              No photos yet. Tap “Add photo” to upload your first one.
            </Text>
          )}

          <View style={styles.catalogGrid}>
            {catalog.map((item) => (
              <View key={item.id} style={styles.catalogItem}>
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.catalogImage}
                />
                {item.caption ? (
                  <Text style={styles.catalogCaption}>{item.caption}</Text>
                ) : null}
                <TouchableOpacity
                  onPress={() => handleDeleteCatalogImage(item.id)}
                >
                  <Text style={styles.catalogDeleteText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Text style={styles.sectionTitle}>Actions</Text>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowHours((prev) => !prev)}
          >
            <Text style={styles.actionButtonText}>
              {showHours ? "Hide working hours" : "Manage working hours"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={async () => {
              const next = !showProfileEditor;
              setShowProfileEditor(next);
              if (next) {
                await loadProviderProfile();
              }
            }}
          >
            <Text style={styles.actionButtonText}>
              {showProfileEditor ? "Hide provider profile" : "Edit provider profile"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handlePinLocation}
          >
            <Text style={styles.actionButtonText}>
              Pin my business location here
            </Text>
          </TouchableOpacity>

          {providerLocation && (
            <View style={styles.mapContainer}>
                <MapView
                  style={{ flex: 1 }}
                  pointerEvents="none"
                  initialRegion={{
                    latitude: providerLocation.lat,
                    longitude: providerLocation.long,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                >
                  <Marker
                    coordinate={{
                      latitude: providerLocation.lat,
                      longitude: providerLocation.long,
                    }}
                    title="Your business location"
                  />
                </MapView>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ProviderBillingScreen({ token, showFlash }) {
  const [billingSummary, setBillingSummary] = useState(null);
  const [billingCycles, setBillingCycles] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [expandedBills, setExpandedBills] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const toggleBillExpanded = (billId) => {
    setExpandedBills((prev) => ({
      ...prev,
      [billId]: !prev[billId],
    }));
  };

  const formatMoney = (value) => {
    const amount = Number.isFinite(value) ? value : 0;
    return `GYD ${Math.round(amount).toLocaleString()}`;
  };

  const parseDateOnly = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        return new Date(year, month, day);
      }
    }
    const dateObj = new Date(value);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj;
  };

  const formatDate = (value) => {
    const dateObj = parseDateOnly(value);
    if (!dateObj) return "-";
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const fetchBilling = useCallback(async () => {
    try {
      setBillingLoading(true);
      setBillingError("");

      const authToken = await getAuthToken(token);

      if (!authToken) {
        setBillingError("No access token found. Please log in again.");
        return;
      }

      const billingEndpoint = `${API}/providers/me/billing/cycles?limit=6`;

      const response = await axios.get(billingEndpoint, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const summaryData = response?.data || null;
      setBillingSummary(summaryData);

      const cycles = Array.isArray(summaryData?.cycles)
        ? summaryData.cycles
        : [];
      setBillingCycles(cycles);
    } catch (err) {
      console.log("Error loading billing", err.response?.data || err.message);
      setBillingError("Could not load billing statements.");
      if (showFlash) {
        showFlash("error", "Could not load billing statements.");
      }
    } finally {
      setBillingLoading(false);
    }
  }, [showFlash, token?.token]);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  useFocusEffect(
    useCallback(() => {
      fetchBilling();
      return () => {};
    }, [fetchBilling])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBilling();
    setRefreshing(false);
  }, [fetchBilling]);

  const outstandingFees = billingSummary?.outstanding_fees_gyd || 0;

  return (
    <ScrollView
      contentContainerStyle={styles.providerBillingScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <Text style={styles.profileTitle}>Billing</Text>
      <Text style={styles.subtitleSmall}>
        Bills populate automatically on the 1st of each month with booking
        details.
      </Text>

      {billingSummary && (
        <View style={styles.providerSummaryCard}>
          <Text style={styles.providerSummaryLabel}>Account number</Text>
          <Text style={styles.providerSummaryValue}>
            {billingSummary.account_number || "N/A"}
          </Text>

          <View style={{ height: 8 }} />

          <Text style={styles.providerSummaryLabel}>Outstanding fees</Text>
          <Text style={styles.providerSummaryValue}>
            {formatMoney(outstandingFees)}
          </Text>
        </View>
      )}

      {billingLoading && (
        <View style={styles.card}>
          <ActivityIndicator />
          <Text style={styles.serviceMeta}>Loading billing history…</Text>
        </View>
      )}

      {billingError ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{billingError}</Text>
        </View>
      ) : null}

      {!billingLoading && !billingError && billingCycles.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.serviceMeta}>No billing history yet.</Text>
        </View>
      )}

      {!billingLoading &&
        !billingError &&
        billingCycles.map((bill) => {
          const cycleDate = parseDateOnly(bill?.cycle_month);
          const coverageStart = parseDateOnly(bill?.coverage_start) || cycleDate;
          const coverageEnd = parseDateOnly(bill?.coverage_end);
          const invoiceDate = parseDateOnly(bill?.invoice_date);
          const status = bill?.status || "Generated";
          let statusStyle = styles.billingStatusUpcoming;
          if (status === "Generated") statusStyle = styles.billingStatusReady;
          if (status === "Paid") statusStyle = styles.billingStatusPaid;
          if (status === "Unpaid") statusStyle = styles.billingStatusUnpaid;
          return (
          <View key={bill.cycle_month} style={styles.billingCard}>
            <View style={styles.billingHeaderRow}>
              <View>
                <Text style={styles.billingMonth}>
                  {(cycleDate || new Date()).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
                <Text style={styles.billingMeta}>
                  Coverage {formatDate(coverageStart)} – {formatDate(coverageEnd)}
                </Text>
              </View>

              <Text
                style={[
                  styles.billingStatus,
                  statusStyle,
                ]}
              >
                {status}
              </Text>
            </View>

            <Text style={styles.billingMeta}>
              Invoice date (auto on the 1st): {formatDate(invoiceDate)}
            </Text>

           <TouchableOpacity
              style={styles.billingToggleRow}
              onPress={() => toggleBillExpanded(bill.cycle_month)}
            >
              <Text style={styles.billingToggleText}>
                {expandedBills[bill.cycle_month] ? "Hide services" : "Show services"}
              </Text>
              <Ionicons
                name={expandedBills[bill.cycle_month] ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.primary}
              />
            </TouchableOpacity>

            {expandedBills[bill.cycle_month] ? (
              <View style={styles.billingLineItems}>
                {bill.items && bill.items.length > 0 ? (
                  bill.items.map((item) => (
                  <View
                    key={`${bill.cycle_month}-${item.service_id}`}
                    style={styles.billingLineItem}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billingLineLabel}>{item.service_name}</Text>
                      <Text style={styles.billingMeta}>Qty: {item.qty}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.billingAmount}>
                        {formatMoney(item.services_total_gyd)}
                      </Text>
                      <Text style={styles.billingMeta}>
                        Fee: {formatMoney(item.platform_fee_gyd)}
                      </Text>
                    </View>

                  </View>
                   ))
                ) : (
                  <Text style={styles.billingMeta}>No completed services.</Text>
                )}
              </View>
            ) : null}

            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>Services total</Text>
              <Text style={styles.billingTotalsValue}>
                {formatMoney(bill.services_total_gyd)}
              </Text>
            </View>
            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>Platform fee</Text>
              <Text style={styles.billingTotalsValue}>
                {formatMoney(bill.platform_fee_gyd)}
              </Text>
            </View>
              <View style={styles.billingTotalsRow}>
                <Text style={styles.billingTotalsLabel}>Bill credits</Text>
                <Text style={styles.billingTotalsValue}>
                  -{formatMoney(bill.bill_credits_gyd)}
                </Text>
              </View>
            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>Total due</Text>
              <Text style={styles.billingTotalsValue}>
                {formatMoney(bill.total_due_gyd)}
              </Text>
            </View>
          </View>
        )})}
    </ScrollView>
  );
}


function DayScheduleGrid({ events, startHour, endHour, renderEvent }) {
  const TIME_ZOOM = 1.5;
  const hourHeight = 145 * TIME_ZOOM;
  const pxPerMinute = hourHeight / 60;
  const timeGutterWidth = 56;
  const gridHorizontalPadding = 8;
  const gridVerticalPadding = 12;
  const startRaw = Number(startHour);
  const endRaw = Number(endHour);
  const gridStart = Number.isFinite(startRaw) ? startRaw : 0;
  const gridEndCandidate = Number.isFinite(endRaw) ? endRaw : 24;
  const gridStartClamped = Math.min(Math.max(gridStart, 0), 23);
  const gridEndClamped = Math.min(Math.max(gridEndCandidate, gridStartClamped + 1), 24);
  const totalHours = gridEndClamped - gridStartClamped;
  const totalHeight = totalHours * hourHeight;
  const trackHeight = totalHeight + gridVerticalPadding * 2;
  const contentHeight = trackHeight;
  const loggedRef = useRef(false);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android" || loggedRef.current) return;
    loggedRef.current = true;
    console.log("[DayScheduleGrid Android debug]", {
      startHour,
      endHour,
      gridStartClamped,
      gridEndClamped,
      totalHours,
      contentHeight,
    });
  }, [contentHeight, endHour, gridEndClamped, gridStartClamped, startHour, totalHours]);

  const hourTicks = useMemo(
    () => Array.from({ length: totalHours }, (_, idx) => gridStartClamped + idx),
    [gridStartClamped, totalHours]
  );

  const lineTicks = useMemo(
    () => Array.from({ length: totalHours + 1 }, (_, idx) => gridStartClamped + idx),
    [gridStartClamped, totalHours]
  );

  const formatHourLabel = useCallback((hour) => {
    const normalizedHour = ((hour % 24) + 24) % 24;
    const meridiem = normalizedHour >= 12 ? "PM" : "AM";
    const displayHour = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
    return `${displayHour}${meridiem}`;
  }, []);

  const visibleEvents = useMemo(
    () =>
      (events || []).filter((event) => {
        const rawStatus = String(event?.status?.type || event?.status || event?.state || "").trim().toLowerCase();
        return rawStatus !== "cancelled" && rawStatus !== "canceled";
      }),
    [events]
  );

  const positionedEvents = useMemo(() => {
    return visibleEvents
      .map((event) => {
        const startDate = event?.startDate || new Date(event?.start);
        const endDate = event?.endDate || new Date(event?.end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

        const gridStartMinutes = gridStartClamped * 60;
        const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
        const minutesFromStart = startMinutes - gridStartMinutes;
        const durationMinutes = Math.max(
          5,
          Math.round((endDate.getTime() - startDate.getTime()) / 60000)
        );

        const top = minutesFromStart * pxPerMinute + gridVerticalPadding;
        const height = Math.max(28, durationMinutes * pxPerMinute);

        return {
          ...event,
          top,
          height,
          durationMinutes,
        };
      })
      .filter((event) => event && event.top + event.height >= gridVerticalPadding && event.top <= trackHeight - gridVerticalPadding)
      .sort((a, b) => a.top - b.top);
  }, [gridStartClamped, gridVerticalPadding, pxPerMinute, trackHeight, visibleEvents]);

  const timelineLeft = timeGutterWidth + gridHorizontalPadding;
  const timelineWidth = Math.max(0, gridWidth - timeGutterWidth - gridHorizontalPadding * 2);

  return (
    <ScrollView
      style={styles.providerDayScheduleScroll}
      pointerEvents="auto"
      contentContainerStyle={[
        styles.providerDayScheduleScrollContent,
        Platform.OS === "android" ? { minHeight: contentHeight + gridVerticalPadding * 2 + 24 } : null,
        { paddingTop: gridVerticalPadding, paddingBottom: gridVerticalPadding + 24 },
      ]}
      showsVerticalScrollIndicator={false}
      bounces={false}
      alwaysBounceHorizontal={false}
      horizontal={false}
      nestedScrollEnabled={true}
      scrollEnabled={true}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <View
        style={styles.providerDayScheduleRow}
        onLayout={(event) => {
          const width = Math.round(event?.nativeEvent?.layout?.width || 0);
          if (width > 0 && width !== gridWidth) {
            setGridWidth(width);
          }
        }}
      >
        <View style={[styles.providerDayScheduleGutter, { width: timeGutterWidth, height: trackHeight }]}>
          {hourTicks.map((hour) => {
            const y = (hour - gridStartClamped) * hourHeight + gridVerticalPadding;
            return (
              <Text key={`label-${hour}`} style={[styles.providerDayScheduleTimeLabel, { top: y + hourHeight / 2 }]}>
                {formatHourLabel(hour)}
              </Text>
            );
          })}
        </View>

        <View style={[styles.providerDayScheduleGrid, { height: trackHeight }]}>
          {lineTicks.map((hour) => {
            const y = (hour - gridStartClamped) * hourHeight + gridVerticalPadding;
            const hasHalfHour = hour < gridEndClamped;
            return (
              <React.Fragment key={`line-${hour}`}>
                <View style={[styles.providerDayScheduleHourLine, { top: y }]} />
                {hasHalfHour ? <View style={[styles.providerDayScheduleHalfHourLine, { top: y + hourHeight / 2 }]} /> : null}
              </React.Fragment>
            );
          })}

        </View>

        <View pointerEvents="box-none" style={styles.providerDayScheduleEventsOverlay}>
          {positionedEvents.map((event) => {
            const timelinePositionStyle = {
              position: "absolute",
              top: event.top,
              left: timelineLeft,
              width: timelineWidth,
              height: event.height,
              overflow: "hidden",
            };

            return (
              <View key={event.id} style={[styles.providerDayScheduleEvent, timelinePositionStyle]}>
                {renderEvent ? renderEvent(event) : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function WeeklyStrip({
  weekStartKey,
  selectedDate,
  onSelectDate,
  bookingsByDate,
  isBookingCompleted,
  colors,
  getWeekDays,
}) {
  const weekDays = useMemo(() => getWeekDays(weekStartKey), [getWeekDays, weekStartKey]);

  const isBookingVisible = useCallback((booking) => {
    const normalizedStatus = String(booking?.status || booking?.state || "").trim().toLowerCase();
    return normalizedStatus !== "cancelled" && normalizedStatus !== "canceled";
  }, []);

  return (
    <View style={styles.providerWeeklyStrip}>
      <View style={styles.providerWeeklyRow}>
        {weekDays.map((day) => {
          const bookings = bookingsByDate?.[day.key] || [];
          const activeBookings = bookings.filter(isBookingVisible);
          const hasBookings = activeBookings.length > 0;
          const allCompleted = hasBookings && activeBookings.every((booking) => isBookingCompleted(booking));
          const isSelected = day.key === selectedDate;

          return (
            <Pressable
              key={day.key}
              style={styles.providerWeeklyCell}
              onPress={() => onSelectDate(day.key)}
            >
              <Text allowFontScaling={false} style={styles.providerWeeklyDow}>
                {day.label}
              </Text>
              <View
                style={[
                  styles.providerWeeklyDayWrap,
                  isSelected && styles.providerWeeklyDayWrapSelected,
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.providerWeeklyDayText,
                    !isSelected && styles.providerWeeklyDayTextMuted,
                  ]}
                >
                  {day.dayNumber}
                </Text>
              </View>
              {hasBookings ? (
                <View
                  style={[
                    styles.providerWeeklyDot,
                    {
                      backgroundColor: allCompleted ? colors.textMuted : colors.primary,
                    },
                  ]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}




function ProviderCalendarScreen({ token, showFlash }) {
  // Manual checklist:
  // - confirmed booking shows Cancel
  // - cancelled/completed booking hides Cancel
  // - tapping Cancel prompts confirm
  // - confirm triggers request
  // - success refreshes and shows toast
  // - failure shows toast
  // Keep the calendar in fixed-height view wrappers so it cannot expand into the appointments header/list area.
  const WEEKLY_FIRST_DAY = 1;
  const PROVIDER_CALENDAR_DEBUG = false;
  const parseLocalMidday = useCallback((dateKey) => {
    if (typeof dateKey !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return null;
    const [, yyyyStr, mmStr, ddStr] = match;
    const yyyy = Number(yyyyStr);
    const mm = Number(mmStr);
    const dd = Number(ddStr);
    if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
    const parsed = new Date(yyyy, mm - 1, dd, 12, 0, 0);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, []);
  const normalizeDateKey = useCallback((dateLike) => {
    if (!dateLike) return null;
    let parsed = null;
    if (dateLike instanceof Date) {
      parsed = dateLike;
    } else if (typeof dateLike === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
        parsed = parseLocalMidday(dateLike);
      } else if (dateLike.includes("T")) {
        parsed = new Date(dateLike);
      } else {
        return null;
      }
    } else {
      return null;
    }
    if (Number.isNaN(parsed.getTime())) return null;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [parseLocalMidday]);
  const startOfWeekKey = useCallback((dateKey) => {
    const d = parseLocalMidday(dateKey);
    if (!d) return null;
    const mondayIndex = (d.getDay() + 6) % 7;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayIndex, 12, 0, 0);
    return normalizeDateKey(start);
  }, [normalizeDateKey, parseLocalMidday]);
  const addDaysKey = useCallback((dateKey, deltaDays) => {
    const base = parseLocalMidday(dateKey);
    if (!base || !Number.isFinite(deltaDays)) return null;
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays, 12, 0, 0);
    return normalizeDateKey(next);
  }, [normalizeDateKey, parseLocalMidday]);
  const getWeekDays = useCallback((weekStartKey) => {
    const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const start = parseLocalMidday(weekStartKey);
    if (!start) return [];

    return Array.from({ length: 7 }, (_, index) => {
      const current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12, 0, 0);
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, "0");
      const dd = String(current.getDate()).padStart(2, "0");
      return {
        key: `${yyyy}-${mm}-${dd}`,
        label: weekdayLabels[index],
        dayNumber: String(current.getDate()),
      };
    });
  }, [parseLocalMidday]);
  const [viewMode, setViewMode] = useState("month");
  const [selectedDate, setSelectedDate] = useState(() => normalizeDateKey(new Date()) || "");
  const [weekStartKey, setWeekStartKey] = useState(() => {
    const todayKey = normalizeDateKey(new Date()) || "";
    return startOfWeekKey(todayKey) || todayKey;
  });
  const [weekPagerWidth, setWeekPagerWidth] = useState(0);
  const [bookings, setBookings] = useState([]);
  const [cancellingByBookingId, setCancellingByBookingId] = useState({});
  const [cancelAllLoading, setCancelAllLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const weekPagerRef = useRef(null);

  const dateRange = useMemo(() => {
    const base = new Date(`${selectedDate}T12:00:00`);
    const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
    const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return {
      start: normalizeDateKey(monthStart),
      end: normalizeDateKey(monthEnd),
    };
  }, [normalizeDateKey, selectedDate]);

  const formatDayKey = useCallback((bookingStartTime) => normalizeDateKey(bookingStartTime), [normalizeDateKey]);

  useEffect(() => {
    const nextWeekStart = startOfWeekKey(selectedDate);
    if (nextWeekStart) {
      setWeekStartKey(nextWeekStart);
    }
  }, [selectedDate, startOfWeekKey]);

  const weekPages = useMemo(() => {
    const previousWeek = addDaysKey(weekStartKey, -7);
    const nextWeek = addDaysKey(weekStartKey, 7);
    return [previousWeek, weekStartKey, nextWeek].filter(Boolean);
  }, [addDaysKey, weekStartKey]);

  useEffect(() => {
    if (!weekPagerWidth || !weekPagerRef.current) return;
    weekPagerRef.current.scrollTo({ x: weekPagerWidth, animated: false });
  }, [weekPagerWidth, weekStartKey]);

  const onWeekPagerMomentumEnd = useCallback((event) => {
    if (!weekPagerWidth) return;
    const x = event?.nativeEvent?.contentOffset?.x || 0;
    const pageIndex = Math.round(x / weekPagerWidth);
    if (pageIndex === 1) return;
    const deltaWeeks = pageIndex < 1 ? -1 : 1;
    const nextSelectedDate = addDaysKey(selectedDate, deltaWeeks * 7);
    if (nextSelectedDate) {
      setSelectedDate(nextSelectedDate);
    }
    if (weekPagerRef.current) {
      weekPagerRef.current.scrollTo({ x: weekPagerWidth, animated: false });
    }
  }, [addDaysKey, selectedDate, weekPagerWidth]);

  const isBookingCompleted = useCallback((booking) => {
    const now = Date.now();
    const endTime = booking?.end_time || booking?.end;
    if (endTime) {
      const endMs = new Date(endTime).getTime();
      return Number.isFinite(endMs) && endMs < now;
    }

    const startTime = booking?.start_time || booking?.start;
    const durationMin = Number(booking?.duration_minutes || booking?.duration || 0);
    if (!startTime) return false;
    const startMs = new Date(startTime).getTime();
    if (!Number.isFinite(startMs)) return false;
    return startMs + Math.max(durationMin, 0) * 60_000 < now;
  }, []);

  const getBookingStatusLabel = useCallback((booking) => {
    const normalizedStatus = String(booking?.status || booking?.state || "")
      .trim()
      .toLowerCase();

    const isCancelled =
      normalizedStatus === "cancelled" ||
      normalizedStatus === "canceled" ||
      Boolean(booking?.cancelled_at || booking?.canceled_at || booking?.is_cancelled || booking?.isCanceled);

    if (isCancelled) {
      return { type: "cancelled", label: "Cancelled" };
    }

    const isCompleted =
      normalizedStatus === "completed" ||
      Boolean(booking?.completed_at || booking?.is_completed) ||
      isBookingCompleted(booking);

    if (isCompleted) {
      return { type: "completed", label: "Completed" };
    }

    return { type: "scheduled", label: "Scheduled" };
  }, [isBookingCompleted]);

  const getBookingId = useCallback(
    (booking) => String(booking?.id || booking?.booking_id || ""),
    []
  );

  const isBookingCancellable = useCallback(
    (booking) => {
      const status = getBookingStatusLabel(booking);
      if (status.type === "cancelled" || status.type === "completed") return false;

      const normalizedStatus = String(booking?.status || booking?.state || "")
        .trim()
        .toLowerCase();

      return normalizedStatus === "confirmed";
    },
    [getBookingStatusLabel]
  );

  const loadBookingsForRange = useCallback(async (useRefresh = false) => {
    try {
      if (useRefresh) setRefreshing(true);
      setLoading(true);
      setError("");

      const authToken = await getAuthToken(token);
      if (!authToken) {
        setError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/providers/me/bookings`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        params: {
          start: dateRange.start,
          end: dateRange.end,
        },
      });

      const rows = Array.isArray(res.data)
        ? res.data
        : res.data?.bookings || res.data?.results || [];

      setBookings(dedupeById(rows));
    } catch (err) {
      console.log("Error loading provider calendar bookings", err?.response?.data || err?.message || err);
      setError("Could not load calendar bookings.");
      if (showFlash) {
        showFlash("error", "Could not load calendar bookings.");
      }
    } finally {
      setLoading(false);
      if (useRefresh) setRefreshing(false);
    }
  }, [dateRange.end, dateRange.start, formatDayKey, showFlash, token]);

  const handleRefresh = useCallback(() => loadBookingsForRange(true), [loadBookingsForRange]);

  const cancelBookingById = useCallback(
    async (bookingId, authTokenOverride) => {
      const authToken = authTokenOverride || (await getAuthToken(token));
      if (!authToken) {
        const noAuthError = new Error("No access token found. Please log in again.");
        noAuthError.code = "NO_AUTH_TOKEN";
        throw noAuthError;
      }

      await axios.post(
        `${API}/providers/me/bookings/${bookingId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

    },
    [token]
  );

  const handleCancelAppointment = useCallback(
    (booking) => {
      if (cancelAllLoading) return;
      const bookingId = getBookingId(booking);
      if (!bookingId || cancellingByBookingId[bookingId]) return;

      Alert.alert(
        "Cancel appointment?",
        "This will notify the customer.",
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Cancel appointment",
            style: "destructive",
            onPress: async () => {
              if (cancellingByBookingId[bookingId]) return;

              setCancellingByBookingId((prev) => ({ ...prev, [bookingId]: true }));
              try {
                await cancelBookingById(bookingId);

                if (showFlash) showFlash("success", "Appointment cancelled");
                await loadBookingsForRange();
              } catch (err) {
                const message =
                  err?.response?.data?.detail ||
                  err?.response?.data?.message ||
                  "Could not cancel appointment. Please try again.";
                if (showFlash) showFlash("error", message);
              } finally {
                setCancellingByBookingId((prev) => ({ ...prev, [bookingId]: false }));
              }
            },
          },
        ]
      );
    },
    [cancelAllLoading, cancelBookingById, cancellingByBookingId, getBookingId, loadBookingsForRange, showFlash]
  );

  useEffect(() => {
    loadBookingsForRange();
  }, [loadBookingsForRange]);

  const isActiveBooking = useCallback((booking) => {
    const normalizedStatus = String(booking?.status || booking?.state || "").trim().toLowerCase();
    return normalizedStatus !== "cancelled" && normalizedStatus !== "canceled";
  }, []);

  const bookingsByDate = useMemo(() => {
    return bookings.reduce((acc, booking) => {
      const key = formatDayKey(booking?.start_time || booking?.start);
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(booking);
      return acc;
    }, {});
  }, [bookings, formatDayKey]);

  const selectedBookings = useMemo(() => {
    const day = selectedDate;
    return bookings.filter((booking) => {
      if (!isActiveBooking(booking)) return false;
      return formatDayKey(booking?.start_time || booking?.start) === day;
    });
  }, [bookings, formatDayKey, isActiveBooking, selectedDate]);
  const sortedSelectedBookings = useMemo(
    () =>
      selectedBookings
        .slice()
        .sort((a, b) => new Date(a?.start_time || a?.start) - new Date(b?.start_time || b?.start)),
    [selectedBookings]
  );
  const cancellableDayBookings = useMemo(
    () => sortedSelectedBookings.filter((booking) => isBookingCancellable(booking)),
    [isBookingCancellable, sortedSelectedBookings]
  );

  const handleCancelAllForSelectedDay = useCallback(() => {
    if (cancelAllLoading || viewMode !== "day") return;
    const cancellableBookings = sortedSelectedBookings.filter((booking) => isBookingCancellable(booking));
    const totalToCancel = cancellableBookings.length;
    if (!totalToCancel) return;

    Alert.alert(
      "Cancel all appointments?",
      `This will cancel ${totalToCancel} appointments on ${selectedDate}. This can’t be undone.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel All",
          style: "destructive",
          onPress: async () => {
            if (cancelAllLoading) return;

            setCancelAllLoading(true);
            let cancelledCount = 0;
            try {
              const authToken = await getAuthToken(token);
              if (!authToken) {
                if (showFlash) showFlash("error", "No access token found. Please log in again.");
                return;
              }

              for (const booking of cancellableBookings) {
                const bookingId = getBookingId(booking);
                if (!bookingId || !isBookingCancellable(booking)) continue;

                setCancellingByBookingId((prev) => ({ ...prev, [bookingId]: true }));
                try {
                  await cancelBookingById(bookingId, authToken);
                  cancelledCount += 1;
                } catch (err) {
                  console.log("Error cancelling appointment in cancel-all", err?.response?.data || err?.message || err);
                } finally {
                  setCancellingByBookingId((prev) => ({ ...prev, [bookingId]: false }));
                }
              }

              if (showFlash) {
                if (cancelledCount === totalToCancel) {
                  showFlash("success", `Cancelled ${cancelledCount} appointments.`);
                } else {
                  showFlash(
                    "error",
                    `Cancelled ${cancelledCount} of ${totalToCancel}. Some could not be cancelled.`
                  );
                }
              }
            } finally {
              setCancelAllLoading(false);
              await loadBookingsForRange();
            }
          },
        },
      ]
    );
  }, [
    cancelAllLoading,
    cancelBookingById,
    getBookingId,
    isBookingCancellable,
    loadBookingsForRange,
    selectedDate,
    showFlash,
    sortedSelectedBookings,
    token,
    viewMode,
  ]);

  const formatTimelineTime = useCallback((isoDateLike) => {
    const parsed = new Date(isoDateLike);
    if (Number.isNaN(parsed.getTime())) return "--:--";
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }, []);

  const getEventAccentColor = useCallback((booking) => {
    const palette = [colors.primary, "#1CA7A8", "#4C8BF5", "#8A63D2"];
    const hashSource = String(booking?.service_id || booking?.service_name || "service");
    const hash = Array.from(hashSource).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return palette[hash % palette.length];
  }, []);

  const markedDates = useMemo(() => {
    const marked = {};

    Object.keys(bookingsByDate).forEach((day) => {
      const dayBookings = bookingsByDate[day] || [];
      const activeBookings = dayBookings.filter(isActiveBooking);
      const hasBookings = activeBookings.some((booking) => isActiveBooking(booking));
      if (!hasBookings) return;
      const allCompleted = activeBookings.every((b) => isBookingCompleted(b));
      marked[day] = {
        marked: true,
        dotColor: allCompleted ? colors.textMuted : colors.primary,
      };
    });

    marked[selectedDate] = {
      ...(marked[selectedDate] || {}),
      selected: true,
      selectedColor: colors.primarySoft,
      selectedTextColor: colors.textPrimary,
    };

    return marked;
  }, [bookingsByDate, isActiveBooking, isBookingCompleted, selectedDate]);

  const timelineEvents = useMemo(
    () =>
      selectedBookings
      .map((booking) => {
          const startIso = booking?.start_time || booking?.start;
          if (!startIso) return null;
          const startDate = new Date(startIso);
          if (Number.isNaN(startDate.getTime())) return null;

          let endDate = booking?.end_time || booking?.end ? new Date(booking?.end_time || booking?.end) : null;
          if (!endDate || Number.isNaN(endDate.getTime())) {
            const durationMin = Number(booking?.duration_minutes || booking?.duration || 30);
            endDate = new Date(startDate.getTime() + Math.max(durationMin, 1) * 60_000);
          }

          const status = getBookingStatusLabel(booking);
          const completed = status.type === "completed";
          const accentColor = getEventAccentColor(booking);

          return {
            id: String(booking?.id || booking?.booking_id || `${startIso}-${booking?.service_name || "service"}`),
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            booking,
            title: booking?.service_name || "Service",
            summary: booking?.customer_name || "Customer",
            color: accentColor,
            accentColor,
            completed,
            status,
            startLabel: `${formatTimelineTime(startDate)} - ${formatTimelineTime(endDate)}`,
          };
        })
        .filter(Boolean),
    [formatTimelineTime, getBookingStatusLabel, getEventAccentColor, selectedBookings]
  );

  const calendarTheme = useMemo(
    () => ({
      backgroundColor: colors.surface,
      calendarBackground: colors.surface,
      dayTextColor: colors.textPrimary,
      monthTextColor: colors.textPrimary,
      textSectionTitleColor: colors.textSecondary,
      selectedDayBackgroundColor: colors.primarySoft,
      selectedDayTextColor: colors.textPrimary,
      todayTextColor: colors.primary,
      arrowColor: colors.primary,
      textDisabledColor: colors.textMuted,
      dotColor: colors.primary,
      selectedDotColor: colors.textPrimary,
      timelineContainerBackground: colors.surface,
      timelineBackgroundColor: colors.surface,
      timelineLineColor: colors.border,
      timelineTextColor: colors.textPrimary,
      timelineNowIndicatorColor: colors.primary,
    }),
    []
  );

  const onSelectDate = useCallback((value) => {
    if (!value) return;
    const raw = typeof value === "string" ? value : value.dateString;
    const nextDate = normalizeDateKey(raw);
    if (!nextDate) return;
    setSelectedDate(nextDate);
  }, [normalizeDateKey]);

  useEffect(() => {
    if (!PROVIDER_CALENDAR_DEBUG) return;
    const selected = parseLocalMidday(selectedDate);
    if (!selected) {
      console.log("[ProviderCalendarScreen][WeeklyDebug] invalid selectedDate", { selectedDate });
      return;
    }
    console.log("[ProviderCalendarScreen][WeeklyDebug]", {
      selectedDate,
      selectedWeekday: selected.getDay(),
      firstDay: WEEKLY_FIRST_DAY,
    });
  }, [PROVIDER_CALENDAR_DEBUG, WEEKLY_FIRST_DAY, parseLocalMidday, selectedDate]);

  const dayGridEvents = useMemo(
    () =>
      timelineEvents
        .map((event) => {
          const startDate = new Date(event.start);
          const endDate = new Date(event.end);
          if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
          return {
            ...event,
            startDate,
            endDate,
          };
        })
        .filter(Boolean),
    [timelineEvents]
  );

  const appointmentListData = viewMode === "day" ? [] : sortedSelectedBookings;
  const showAppointmentsEmptyState = viewMode !== "day";
  const getBookingCardKey = useCallback((booking) => {
    if (booking?.id != null) return String(booking.id);
    return `${booking?.booking_id || booking?.id || ""}-${booking?.start_time || booking?.start || ""}`;
  }, []);

  const ProviderBookingCard = useCallback(
    ({ booking, startDate: propsStartDate, endDate: propsEndDate, compact = false, token: _token, showFlash: _showFlash }) => {
      const bookingId = getBookingId(booking);
      const status = getBookingStatusLabel(booking);
      const statusThemeKey = getAppointmentStatusThemeKey(status?.type || status?.label);
      const statusTheme = APPOINTMENT_STATUS_THEME[statusThemeKey];
      const completed = status.type === "completed";
      const isCancelling = !!(bookingId && cancellingByBookingId[bookingId]);
      const canCancel = isBookingCancellable(booking);
      const parsedStart = propsStartDate instanceof Date
        ? propsStartDate
        : (booking?.start_time
          ? new Date(booking.start_time)
          : (booking?.start ? new Date(booking.start) : null));
      const start = parsedStart instanceof Date && !Number.isNaN(parsedStart.getTime())
        ? parsedStart
        : null;

      let parsedEnd = propsEndDate instanceof Date
        ? propsEndDate
        : (booking?.end_time
          ? new Date(booking.end_time)
          : (booking?.end ? new Date(booking.end) : null));

      if (
        (!parsedEnd || Number.isNaN(parsedEnd.getTime())) &&
        start &&
        booking?.duration_minutes
      ) {
        parsedEnd = new Date(start.getTime() + Number(booking.duration_minutes) * 60000);
      }

      const end = parsedEnd instanceof Date && !Number.isNaN(parsedEnd.getTime())
        ? parsedEnd
        : null;

      const timeLabel = start ? formatTimeRange(start, end) : "--:--";
      return (
        <View
          style={[
            styles.providerCalendarRow,
            completed && styles.providerCalendarRowCompleted,
            { borderColor: statusTheme.border, backgroundColor: statusTheme.bgTint },
          ]}
        >
          <View style={[styles.providerCalendarLeftAccentBar, { backgroundColor: statusTheme.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.providerCalendarTime}>{timeLabel}</Text>
            <Text
              style={[
                styles.providerCalendarService,
                completed && styles.providerCalendarTextCompleted,
              ]}
            >
              {booking?.service_name || "Service"}
            </Text>
            {!compact ? (
              <Text
                style={[
                  styles.providerCalendarCustomer,
                  completed && styles.providerCalendarTextCompleted,
                ]}
              >
                {booking?.customer_name || "Customer"}
              </Text>
            ) : null}
          </View>
          <View style={styles.providerCalendarRightActions}>
            <View
              style={[
                styles.providerCalendarStatusBadge,
                { borderColor: statusTheme.accent, backgroundColor: statusTheme.bgTint },
              ]}
            >
              <Text
                style={[
                  styles.providerCalendarStatusText,
                  { color: statusTheme.accent },
                ]}
                numberOfLines={1}
              >
                {status.label}
              </Text>
            </View>
            {canCancel && !compact ? (
              <TouchableOpacity
                style={[
                  styles.providerCalendarCancelButton,
                  isCancelling && styles.providerCalendarCancelButtonDisabled,
                ]}
                onPress={() => handleCancelAppointment(booking)}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <View style={styles.providerCalendarCancelButtonLoadingRow}>
                    <ActivityIndicator size="small" color={colors.error} />
                    <Text style={styles.providerCalendarCancelButtonText}>Cancelling…</Text>
                  </View>
                ) : (
                  <Text style={styles.providerCalendarCancelButtonText}>Cancel</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    },
    [
      cancellingByBookingId,
      getBookingId,
      getBookingStatusLabel,
      handleCancelAppointment,
      isBookingCancellable,
    ]
  );

  return (
    <SafeAreaView style={styles.providerCalendarScreen} edges={["left", "right", "bottom"]}>
      <View style={styles.providerCalendarContentContainer}>
        <FlatList
          data={appointmentListData}
          keyExtractor={getBookingCardKey}
          renderItem={({ item: booking }) => (
            <ProviderBookingCard
              booking={booking}
              token={token}
              showFlash={showFlash}
            />
          )}
          ListHeaderComponent={
            <View style={{ backgroundColor: colors.background }}>
              <View style={styles.providerCalendarModeSwitch}>
                {[
                  { key: "day", label: "Daily" },
                  { key: "week", label: "Weekly" },
                  { key: "month", label: "Monthly" },
                ].map((mode) => {
                  const active = mode.key === viewMode;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[
                        styles.providerCalendarModeButton,
                        active && styles.providerCalendarModeButtonActive,
                      ]}
                      onPress={() => setViewMode(mode.key)}
                    >
                      <Text
                        style={[
                          styles.providerCalendarModeText,
                          active && styles.providerCalendarModeTextActive,
                        ]}
                      >
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {viewMode === "day" && cancellableDayBookings.length > 0 ? (
                <View style={styles.providerCalendarTopActionsRow}>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    style={[
                      styles.providerCalendarCancelAllButton,
                      cancelAllLoading && styles.providerCalendarCancelAllButtonDisabled,
                    ]}
                    onPress={handleCancelAllForSelectedDay}
                    disabled={cancelAllLoading}
                  >
                    {cancelAllLoading ? (
                      <View style={styles.providerCalendarCancelButtonLoadingRow}>
                        <ActivityIndicator size="small" color={colors.error} />
                        <Text style={styles.providerCalendarCancelAllButtonText}>Cancelling…</Text>
                      </View>
                    ) : (
                      <Text style={styles.providerCalendarCancelAllButtonText}>Cancel All</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}

              <CalendarProvider date={selectedDate} onDateChanged={onSelectDate}>
                <View style={styles.providerCalendarCard}>
                {viewMode === "month" ? (
                  <View
                    style={[
                      styles.providerCalendarViewport,
                      styles.providerCalendarViewportMonth,
                    ]}
                  >
                    <Calendar
                      current={selectedDate}
                      markedDates={markedDates}
                      onDayPress={onSelectDate}
                      theme={calendarTheme}
                    />
                  </View>
                ) : viewMode === "week" ? (
                  <View
                    style={[
                      styles.providerCalendarViewport,
                      styles.providerCalendarViewportWeek,
                    ]}
                    onLayout={(event) => {
                      const width = Math.round(event?.nativeEvent?.layout?.width || 0);
                      if (width > 0 && weekPagerWidth === 0) {
                        setWeekPagerWidth(width);
                      }
                    }}
                  >
                    {weekPagerWidth > 0 ? (
                      <ScrollView
                        ref={weekPagerRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={onWeekPagerMomentumEnd}
                        contentOffset={{ x: weekPagerWidth, y: 0 }}
                        nestedScrollEnabled={false}
                        directionalLockEnabled={true}
                        alwaysBounceVertical={false}
                        alwaysBounceHorizontal={true}
                        scrollEventThrottle={16}
                      >
                        {weekPages.map((pageWeekStartKey) => (
                          <View key={pageWeekStartKey} style={{ width: weekPagerWidth }}>
                            <WeeklyStrip
                              weekStartKey={pageWeekStartKey}
                              selectedDate={selectedDate}
                              onSelectDate={(dayKey) => setSelectedDate(dayKey)}
                              bookingsByDate={bookingsByDate}
                              isBookingCompleted={isBookingCompleted}
                              colors={colors}
                              getWeekDays={getWeekDays}
                            />
                          </View>
                        ))}
                      </ScrollView>
                    ) : (
                      <View style={{ flex: 1 }} />
                    )}
                  </View>
                ) : (
                  <View style={styles.providerCalendarDailyLayout}>
                    <View
                      style={[
                        styles.providerCalendarViewport,
                        styles.providerCalendarViewportWeek,
                      ]}
                      onLayout={(event) => {
                        const width = Math.round(event?.nativeEvent?.layout?.width || 0);
                        if (width > 0 && weekPagerWidth === 0) {
                          setWeekPagerWidth(width);
                        }
                      }}
                    >
                      {weekPagerWidth > 0 ? (
                        <ScrollView
                          ref={weekPagerRef}
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          onMomentumScrollEnd={onWeekPagerMomentumEnd}
                          contentOffset={{ x: weekPagerWidth, y: 0 }}
                          nestedScrollEnabled={false}
                          directionalLockEnabled={true}
                          alwaysBounceVertical={false}
                          alwaysBounceHorizontal={true}
                          scrollEventThrottle={16}
                        >
                          {weekPages.map((pageWeekStartKey) => (
                            <View key={pageWeekStartKey} style={{ width: weekPagerWidth }}>
                              <WeeklyStrip
                                weekStartKey={pageWeekStartKey}
                                selectedDate={selectedDate}
                                onSelectDate={(dayKey) => setSelectedDate(dayKey)}
                                bookingsByDate={bookingsByDate}
                                isBookingCompleted={isBookingCompleted}
                                colors={colors}
                                getWeekDays={getWeekDays}
                              />
                            </View>
                          ))}
                        </ScrollView>
                      ) : (
                        <View style={{ flex: 1 }} />
                      )}
                    </View>
                    <View style={styles.providerCalendarViewportDay}>
                      <DayScheduleGrid
                        events={dayGridEvents}
                        startHour={0}
                        endHour={24}
                        renderEvent={(event) => (
                          <ProviderBookingCard
                            booking={event.booking}
                            startDate={event.startDate}
                            endDate={event.endDate}
                            compact={event.height < 60}
                            token={token}
                            showFlash={showFlash}
                          />
                        )}
                      />
                    </View>
                  </View>
                )}
                </View>
              </CalendarProvider>

              {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} /> : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {viewMode !== "day" ? (
                <>
                  <View style={{ height: 12 }} />
                  <View style={styles.providerCalendarHeaderBlock}>
                    <Text style={styles.sectionTitle}>Appointments for {selectedDate}</Text>
                  </View>
                </>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            showAppointmentsEmptyState ? (
              <Text style={styles.providerCalendarEmpty}>No appointments for this date.</Text>
            ) : null
          }
          contentContainerStyle={styles.providerCalendarListContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      </View>
    </SafeAreaView>
  );
}

// Tabs after login
function MainApp({
  apiClient,
  authLoading,
  token,
  setToken,
  showFlash,
  navigationRef,
  setNavReady,
}) {
  const {
    favoriteIds,
    favoriteProviders,
    favoritesLoading,
    toggleFavorite,
    isFavorite,
    syncFavoritesFromList,
    refreshFavoriteProviders,
  } = useFavoriteProviders(token?.email || token?.userId);
  return (

    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        console.log("[nav] ready");
        setNavReady(true);
      }}
    >
      {token.isProvider ? (
        // 👇 Provider view: Dashboard + Billing + Profile
        <Tab.Navigator
          initialRouteName="Dashboard"
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowLabel: true,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textSecondary,
            tabBarStyle: {
              backgroundColor: colors.surface,
              height: 76,
              paddingBottom: Platform.OS === "ios" ? 24 : 12,
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: -2 },
              elevation: 8,
            },
            tabBarLabel: ({ focused, color }) => (
              <Text
                style={{
                  color,
                  fontSize: 12,
                  fontWeight: focused ? "700" : "500",
                }}
              >
                {route.name}
              </Text>
            ),
            tabBarIcon: ({ color, focused }) => {
              let iconName = "home-outline";

              if (route.name === "Dashboard") iconName = "speedometer-outline";
              else if (route.name === "Calendar") iconName = "calendar-outline";
              else if (route.name === "Billing") iconName = "card-outline";
              else if (route.name === "Profile") iconName = "person-outline";

              if (focused) {
                iconName = iconName.replace("-outline", "");
              }

              return (
                <View
                  style={{
                    padding: 6,
                    borderRadius: 16,
                    backgroundColor: focused ? colors.primarySoft : "transparent",
                  }}
                >
                  <Ionicons
                    name={iconName}
                    size={focused ? 26 : 22}
                    color={color}
                  />
                </View>
              );
            },
          })}
        >
          <Tab.Screen name="Dashboard">
            {() => (
              <ProviderDashboardScreen
                apiClient={apiClient}
                token={token}
                showFlash={showFlash}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="Calendar">
            {() => (
              <ProviderCalendarScreen token={token} showFlash={showFlash} />
            )}
          </Tab.Screen>

          <Tab.Screen name="Billing">
            {() => (
              <ProviderBillingScreen token={token} showFlash={showFlash} />
            )}
          </Tab.Screen>


          <Tab.Screen name="Profile">
            {() => (
              <ProfileScreen
                apiClient={apiClient}
                authLoading={authLoading}
                token={token}
                setToken={setToken}
                showFlash={showFlash}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      ) : (
        // 👇 Client view: Profile + Search
            <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarShowLabel: true,
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.textSecondary,
              tabBarStyle: {
                backgroundColor: colors.surface,
                height: 76,
                paddingBottom: Platform.OS === "ios" ? 24 : 12,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                shadowColor: "#000",
                shadowOpacity: 0.08,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: -2 },
                elevation: 8,
              },
              tabBarLabel: ({ focused, color }) => (
                <Text
                  style={{
                    color,
                    fontSize: 12,
                    fontWeight: focused ? "700" : "500",
                  }}
                >
                  {route.name}
                </Text>
              ),
              tabBarIcon: ({ color, focused }) => {
                let iconName;

                if (route.name === "Home") iconName = "home-outline";
                else if (route.name === "Search") iconName = "search-outline";
                else if (route.name === "Appointments") iconName = "calendar-outline";
                else if (route.name === "Profile") iconName = "person-outline";

                if (focused) {
                  iconName = iconName.replace("-outline", "");
                }

                return (
                  <View
                    style={{
                      padding: 6,
                      borderRadius: 16,
                      backgroundColor: focused ? colors.primarySoft : "transparent",
                    }}
                  >
                    <Ionicons
                      name={iconName}
                      size={focused ? 26 : 22}
                      color={color}
                    />
                  </View>
                );
              },
            })}
            initialRouteName="Home"
          >
            <Tab.Screen name="Home">
              {({ navigation }) => (
                <ClientHomeScreen
                  navigation={navigation}
                  token={token}
                  favoriteProviders={favoriteProviders}
                  favoriteIds={favoriteIds}
                  favoritesLoading={favoritesLoading}
                  toggleFavorite={toggleFavorite}
                  isFavorite={isFavorite}
                  syncFavoritesFromList={syncFavoritesFromList}
                  refreshFavoriteProviders={refreshFavoriteProviders}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Search">
              {({ navigation, route }) => (
                <SearchScreen
                  token={token}
                  showFlash={showFlash}
                  navigation={navigation}
                  route={route}
                  toggleFavorite={toggleFavorite}
                  isFavorite={isFavorite}
                  syncFavoritesFromList={syncFavoritesFromList}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Appointments">
              {() => <AppointmentsScreen token={token} showFlash={showFlash} />}
            </Tab.Screen>
            <Tab.Screen name="Profile">
              {() => (
                <ProfileScreen
                  apiClient={apiClient}
                  authLoading={authLoading}
                  token={token}
                  setToken={setToken}
                  showFlash={showFlash}
                />
              )}
            </Tab.Screen>
          </Tab.Navigator>


      )}
    </NavigationContainer>
  );
}




//Flash message component

function FlashMessage({ flash }) {
  if (!flash || !flash.text) return null;

  const isError = flash.type === "error";

  const backgroundColor = isError ? colors.error : colors.success;
  const borderColor = isError ? colors.error : colors.primaryPressed;
  const textColor = colors.textPrimary;

  return (

    <View
      style={[
        styles.flashContainer,
        { backgroundColor, borderColor },
      ]}
    >
      <Text style={[styles.flashText, { color: textColor }]}>
        {flash.text}
      </Text>
    </View>
  );
}


// 🔹 App orchestrates landing/login/signup/forgot-password vs main app

const DEEPLINK_DEBUG = false;

function App() {

  const mountIdRef = useRef(Math.random().toString(16).slice(2));
  console.log("APP MOUNT ID:", mountIdRef.current);
  useEffect(() => console.log("APP useEffect ran for mount", mountIdRef.current), []);

  const [token, setToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("landing"); // 'landing' | 'login' | 'signup' | 'forgot' | 'finishSetup'
  const [isAdmin, setIsAdmin] = useState(false);
  const [facebookSetup, setFacebookSetup] = useState(null);
  const [pendingDeepLinkUsername, setPendingDeepLinkUsername] = useState(null);
  const [navReady, setNavReady] = useState(false);
  const navReadyRef = useRef(false);
  const navigationRef = useRef(null);
  const authBootstrapRef = useRef({ inFlight: false, completed: false });
  const tokenRef = useRef(token);
  const lastDeeplinkHandledAtRef = useRef(0);
  const lastHandledUrlRef = useRef(null);
  const url = ExpoLinking.useURL();

  const [flash, setFlash] = useState(null);

  const handleUnauthorized = useCallback(async () => {
     try {
       await clearAllAuthTokens(); // ✅ clears access + refresh (and your new fallbacks)
     } catch (storageError) {
       console.log(
         "[auth] Failed to clear all auth tokens",
         storageError?.message || storageError
       );
     }

     try {
       await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY); // optional, but fine
     } catch (storageError) {
       console.log(
         "[auth] Failed to clear legacy token",
         storageError?.message || storageError
       );
     }

     setToken(null);
    }, []);


  // const handleUnauthorized = useCallback(async () => {
  //   try {
  //     await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  //   } catch (storageError) {
  //     console.log(
  //       "[auth] Failed to clear legacy token",
  //       storageError?.message || storageError
  //     );
  //   }
  //   setToken(null);
  // }, []);

  const apiClient = useMemo(
    () =>
      createApiClient({
        baseURL: API,
        onUnauthorized: handleUnauthorized,
      }),
    [handleUnauthorized]
  );



  const formatFlashText = useCallback((text) => {
    if (typeof text === "string") return text;
    if (text == null) return "Something went wrong.";

    const formatErrorItem = (item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return String(item);

      const message = item.msg || item.message;
      if (Array.isArray(item.loc) && item.loc.length > 0) {
        const field = item.loc[item.loc.length - 1];
        return message ? `${field}: ${message}` : String(item);
      }
      if (message) return message;
      return JSON.stringify(item);
    };

    if (Array.isArray(text)) {
      return text.map(formatErrorItem).filter(Boolean).join("\n");
    }

    if (typeof text === "object") {
      if (Array.isArray(text.detail)) {
        return formatFlashText(text.detail);
      }
      if (typeof text.detail === "string") return text.detail;
      if (typeof text.message === "string") return text.message;
      if (typeof text.msg === "string") return text.msg;
      return JSON.stringify(text);
    }

    return String(text);
  }, []);

  const showFlash = useCallback((type, text) => {
    setFlash({ type, text: formatFlashText(text) });
    setTimeout(() => {
      setFlash(null);
    }, 4500);
  }, [formatFlashText]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    navReadyRef.current = navReady;
  }, [navReady]);

  useEffect(() => {
    if (!token) setNavReady(false);
  }, [token]);

  const navigateToClientSearch = useCallback(
  (username, navRef, nonce) => {
    if (!navRef?.current) return false;

    const params = { incomingUsername: username, deeplinkNonce: nonce };

    navRef.current.navigate({
      name: "Search",
      params,
      merge: false,
    });

    return true;
  },
  []
);


  const handleIncomingUrl = useCallback((url, source) => {
    return false; // disable deep links for now
  }, []); 


  // const handleIncomingUrl = useCallback((url, source) => {
  //   // console.log("[deeplink] handleIncomingUrl", source, url);
  //   if (DEEPLINK_DEBUG) showFlash("info", `[DL] ${source}: ${url || "(null)"}`);
  //   if (url && url === lastHandledUrlRef.current) {
  //     // console.log("[deeplink] duplicate url ignored", url);
  //     return false;
  //   }
  //   const username = extractUsernameFromUrl(url);
  //   // console.log("[deeplink] extracted username", username);
  //   if (!username) {
  //     if (DEEPLINK_DEBUG) showFlash("error", "[DL] parse failed");
  //     return false;
  //   }
  //   if (DEEPLINK_DEBUG) showFlash("success", `[DL] user: ${username}`);
  //   if (tokenRef.current?.isProvider === true) {
  //     showFlash("error", "Open as a client to view provider links.");
  //     return true;
  //   }

  //   lastHandledUrlRef.current = url;
  //   lastDeeplinkHandledAtRef.current = Date.now();

  //   const queued = { username, nonce: Date.now() };
  //   // console.log("[deeplink] queued", queued.username, queued.nonce);
  //   setPendingDeepLinkUsername(queued);
  //   return true;
  // }, [showFlash]);

  useEffect(() => {
    let isActive = true;

    Linking.getInitialURL().then((url) => {
      if (!isActive) return;
      // console.log("[deeplink] getInitialURL", url);
      if (DEEPLINK_DEBUG) {
        showFlash("info", `[DL] getInitialURL: ${url || "(null)"}`);
      }
      if (url) handleIncomingUrl(url, "initial");
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      // console.log("[deeplink] url event", url);
      handleIncomingUrl(url, "event");
    });

    return () => {
      isActive = false;
      sub.remove();
    };
  }, [handleIncomingUrl]);

  useEffect(() => {
    if (!url) return;
    // console.log("[deeplink] useURL update", url);
    handleIncomingUrl(url, "useURL");
  }, [handleIncomingUrl, url]);

  useEffect(() => {
    if (!pendingDeepLinkUsername) return;
    {/*} console.log(
      "[deeplink] pending checks",
      "hasToken",
      Boolean(token),
      "isProvider",
      token?.isProvider,
      "navReady",
      navReady,
      "navRef",
      Boolean(navigationRef.current)
    );*/}
    if (!token) return;
    if (token.isProvider) {
      showFlash("error", "Open as a client to view provider links.");
      setPendingDeepLinkUsername(null);
      return;
    }
    if (!navReady) return;
    if (!navigationRef.current) return;

    const ok = navigateToClientSearch(
      pendingDeepLinkUsername.username,
      navigationRef,
      pendingDeepLinkUsername.nonce
    );
    console.log(
      "[deeplink] pending navigate attempt",
      pendingDeepLinkUsername.username,
      "ok",
      ok
    );
    if (ok) setPendingDeepLinkUsername(null);
  }, [pendingDeepLinkUsername, token, navReady, showFlash]);

  useEffect(() => {
    let isActive = true;
    const restoreSession = async () => {
      if (authBootstrapRef.current.inFlight || authBootstrapRef.current.completed) {
        return;
      }
      authBootstrapRef.current.inFlight = true;
      const bootstrapStartedAt = Date.now();
      console.log("[auth] bootstrap start");
      try {
        const restoredToken = await withTimeout(
          getAuthToken(),
          AUTH_TOKEN_TIMEOUT_MS,
          "getAuthToken"
        );
        console.log("[auth] token loaded:", Boolean(restoredToken));

        if (!restoredToken) {
          if (isActive) setToken(null);
        } else {
          try {
            const meRes = await withTimeout(
              apiClient.get("/users/me", {
                headers: {
                  Authorization: `Bearer ${restoredToken}`,
                },
                timeout: AUTH_ME_TIMEOUT_MS,
              }),
              AUTH_ME_TIMEOUT_MS,
              "/users/me"
            );
            console.log("[auth] /users/me success", meRes?.status);
            if (isActive) {
              setToken({
                token: restoredToken,
                userId: meRes.data?.id || meRes.data?.user_id,
                email: meRes.data?.email,
                username: meRes.data?.username,
                isProvider: Boolean(meRes.data?.is_provider),
                isAdmin: Boolean(meRes.data?.is_admin),
              });
              setIsAdmin(Boolean(meRes.data?.is_admin));
            }
          } catch (err) {
            console.log(
              "[auth] Failed to load user info during bootstrap",
              err?.message || err
            );
            console.log(
              "[auth] /users/me failed",
              err?.response?.status || err?.code || "unknown"
            );
            if (err?.response?.status === 401 || err?.response?.status === 403) {
              try {
                await withTimeout(clearAllAuthTokens(), 2500, "clearAllAuthTokens");
              } catch (storageError) {
                console.log(
                  "[auth] Failed to clear all auth tokens",
                  storageError?.message || storageError
                );
              }
            
              try {
                await withTimeout(
                  AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY),
                  1500,
                  "clearLegacyToken"
                );
              } catch (storageError) {
                console.log(
                  "[auth] Failed to clear legacy token",
                  storageError?.message || storageError
                );
              }
            
              if (isActive) setToken(null);
            } else if (isActive) {
              setToken({ token: restoredToken });
            }
          }
        }
      } catch (err) {
        console.log(
          "[auth] Failed to restore session",
          err?.message || err
        );
        if (isActive) setToken(null);
      } finally {
        authBootstrapRef.current.inFlight = false;
        authBootstrapRef.current.completed = true;
        if (isActive) {
          setAuthLoading(false);
          console.log(
            "[auth] bootstrap end",
            `${Date.now() - bootstrapStartedAt}ms`
          );
        }
      }
    };

    restoreSession();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (!authLoading) return undefined;

    const watchdog = setTimeout(() => {
      if (authLoading) {
        console.log("[auth] authLoading watchdog timeout");
        setAuthLoading(false);
      }
    }, AUTH_BOOTSTRAP_WATCHDOG_MS);

    return () => clearTimeout(watchdog);
  }, [authLoading]);

  useEffect(() => {
    console.log("[auth] authLoading:", authLoading);
  }, [authLoading]);

  if (authLoading) {

    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
          <FlashMessage flash={flash} />
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading BookitGY…</Text>

            {/* DEBUG LINES */}
            {/* <Text style={styles.loadingText}>authLoading=true</Text>
            <Text style={styles.loadingText}>bootStep={bootStep || "unknown"}</Text>
            <Text style={styles.loadingText}>mount={mountIdRef.current}</Text> */}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
      
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
        <FlashMessage flash={flash} />

        {!token ? (
          <>
            {authMode === "landing" && (
              <LandingScreen
                goToLogin={() => setAuthMode("login")}
                goToSignup={() => setAuthMode("signup")}
              />
            )}

            {authMode === "login" && (
              <LoginScreen
                setToken={setToken}
                setIsAdmin={setIsAdmin}
                onFacebookSetupRequired={(payload) => {
                  setFacebookSetup(payload);
                  setAuthMode("finishSetup");
                }}
                goToSignup={() => setAuthMode("signup")}
                goToForgot={() => setAuthMode("forgot")}
                goBack={() => setAuthMode("landing")}
                showFlash={showFlash}
              />
            )}

            {authMode === "signup" && (
              <SignupScreen
                goToLogin={() => setAuthMode("login")}
                goBack={() => setAuthMode("landing")}
                showFlash={showFlash}
              />
            )}
            {authMode === "forgot" && (
              <ForgotPasswordScreen
                goToLogin={() => setAuthMode("login")}
                goBack={() => setAuthMode("landing")}
                showFlash={showFlash}
              />
            )}

            {authMode === "finishSetup" && (
              <FinishSetupScreen
                facebookSetup={facebookSetup}
                setToken={setToken}
                setIsAdmin={setIsAdmin}
                goBackToLogin={() => {
                  setFacebookSetup(null);
                  setAuthMode("login");
                }}
                showFlash={showFlash}
              />
            )}
          </>
        ) : (
          <MainApp
            apiClient={apiClient}
            authLoading={authLoading}
            token={token}
            setToken={setToken}
            showFlash={showFlash}
            navigationRef={navigationRef}
            setNavReady={setNavReady}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}




const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 20,
  },
  input: {
    width: "100%",
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    minHeight: 48,
    textAlignVertical: "center",
    ...Platform.select({
      android: {
        includeFontPadding: false,
      },
    }),
  },
  inputError: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  inputErrorText: {
    color: colors.error,
    fontSize: 12,
    marginTop: -6,
    marginBottom: 12,
  },
  passwordRequirements: {
    width: "100%",
    marginTop: -6,
    marginBottom: 12,
  },
  passwordRequirement: {
    fontSize: 12,
    marginBottom: 2,
  },
  passwordRequirementMet: {
    color: colors.success,
  },
  passwordRequirementUnmet: {
    color: colors.error,
  },
  inputPlaceholder: {
    color: colors.textMuted,
  },
  forgotLink: {
    marginBottom: 6,
    alignSelf: "center",
    paddingVertical: 4,
  },
  forgotLinkText: {
    color: colors.textSecondary,
    textDecorationLine: "underline",
    textAlign: "center",
    flexShrink: 1,
  },
  subtitle: { fontSize: 22, color: colors.textSecondary, marginTop: 20, textAlign: "center" },
  text: { fontSize: 18, color: colors.textSecondary, marginTop: 15, textAlign: "center" },

    flashContainer: {
    position: "absolute",
    top: 40,
    left: 20,
    right: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 100,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

   homeScroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 0
  },
  homeCard: {
    width: "100%",
  },
  homeWrapper: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  pinnedHeader: {
    backgroundColor: "#0B1220",
  },
  pinnedHeaderSafeArea: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  homeHeader: {
    marginBottom: 20,
  },
  headerLogo: {
    width: HEADER_LOGO_WIDTH,
    height: HEADER_LOGO_HEIGHT,
  },
  homeGreeting: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  homeSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 6,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  quickCategorySection: {
    marginTop: 20,
    marginBottom: 8,
  },
  quickCategoryList: {
    paddingVertical: 4,
  },
  quickCategoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    marginRight: 10,
  },
  quickCategoryText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },


  carouselList: {
    paddingVertical: 4,
    paddingRight: 12,
  },

  providerCardSkeleton: {
    width: 270,
    borderRadius: 16,
    backgroundColor: colors.surface,
    marginRight: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  providerCardCarousel: {
    width: 270,
    marginRight: 12,
  },
  providerCardList: {
    marginBottom: 12,
  },
  cardImageWrapper: {
    height: 140,
    backgroundColor: colors.surfaceElevated,
    position: "relative",
  },

cardHeartButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 12,
    width: 36,
    height: 36,
    backgroundColor: "rgba(17,24,39,0.9)",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  cardBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  cardBody: {
    padding: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardMetaMuted: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  cardDescription: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceElevated,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
    marginBottom: 8,
  },
  carouselActiveLabel: {
    marginTop: 12,
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "600",
    textAlign: "center",
  },

  flashText: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "500",
  },

    center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

   homeScroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 16,
  },
  homeCard: {
    width: "100%",
  },

  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: "center",
  },
  profileScroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: 20,
    paddingTop: 32,
  },
  profileHeaderCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  profileAvatarColumn: {
    alignItems: "center",
    marginRight: 16,
  },
  profileIdentityText: {
    flex: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 8,
  },
  profileAvatarLink: {
    marginTop: 8,
  },
  profileAvatarLinkText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.primary,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleBadgeAdmin: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.error,
  },
  roleBadgeProvider: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  roleBadgeClient: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  profileSection: {
    marginBottom: 16,
  },
  profileSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowDisabled: {
    opacity: 0.6,
  },
  listRowLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  listRowIcon: {
    marginRight: 10,
  },
  listRowTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  listRowChevron: {
    fontSize: 18,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: {
    fontSize: 17,
    fontWeight: "500",
    color: colors.textPrimary,
    marginTop: 4,
  },
  adminBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  adminTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 4,
  },
  adminText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  actionsContainer: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 10,
  },
  profileLinkText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  profileLinkWarning: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 10,
  },
  profileLinkActions: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  linkActionButton: {
    backgroundColor: "transparent",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  linkActionButtonDisabled: {
    opacity: 0.5,
  },
  linkActionButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textPrimary,
  },

  carouselHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  carouselBody: {
    flexDirection: "row",
    alignItems: "center",
  },
  carouselBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  carouselBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  carouselAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 12,
  },
  carouselAvatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 12,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  carouselAvatarInitial: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  carouselNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  carouselButton: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  carouselButtonDisabled: {
    opacity: 0.5,
  },
  carouselButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  carouselCounter: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "600",
  },

  actionButton: {
    backgroundColor: "transparent",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    alignItems: "center",
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  logoutButton: {
    backgroundColor: "transparent",
    borderColor: colors.error,
    marginTop: 10,
  },
  logoutButtonText: {
    color: colors.error,
  },
  logoutRow: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  logoutRowText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.error,
  },
  deleteAccountRow: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  deleteAccountRowText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  modalButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    marginLeft: 12,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
  },
  modalButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  modalDeleteButton: {
    borderColor: colors.error,
  },
  modalDeleteButtonText: {
    color: colors.error,
    fontWeight: "700",
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },

  toggleCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleCardPressed: {
    opacity: 0.9,
  },
  toggleTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  toggleHelper: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },

    providerScroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 16,
  },
  subtitleSmall: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  serviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

favoriteToggleButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },

  serviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  serviceMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  serviceHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  nearbyEmptyCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  nearbyEmptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: 6,
  },
  nearbyEmptyBody: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  nearbyEmptyHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 8,
  },

    workingHoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hoursInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 60,
    textAlign: "center",
    marginHorizontal: 4,
    backgroundColor: colors.surfaceElevated,
    color: colors.textPrimary,
  },

  hoursFlashGlobal: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    zIndex: 9999,
    elevation: 10,
  },
  hoursFlashSuccess: {
    backgroundColor: colors.success,
  },
  hoursFlashError: {
    backgroundColor: colors.error,
  },
  hoursFlashText: {
    color: colors.textPrimary,
    fontSize: 13,
    textAlign: "center",
  },

  hoursHelp: {
  fontSize: 12,
  color: colors.textMuted,
  marginTop: 4,
  marginBottom: 8,
},

appointmentScroll: {
    padding: 24,
    backgroundColor: colors.background,
    flexGrow: 1,
  },
  appointmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  refreshText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 13,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  appointmentItem: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    overflow: "hidden",
  },
  appointmentLeftAccentBar: {
    width: 4,
    borderRadius: 999,
    marginRight: 10,
    alignSelf: "stretch",
  },
  appointmentTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  appointmentMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },

appointmentCancelButton: {
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 6,
  backgroundColor: colors.error,
  alignSelf: "flex-start",
},

appointmentCancelButtonText: {
  color: colors.textPrimary,
  fontSize: 12,
  fontWeight: "600",
},

  appointmentStatusRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  appointmentStatusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  appointmentStatus: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  appointmentNavigate: {
    paddingLeft: 12,
    justifyContent: "center",
  },
  appointmentCount: {
    fontSize: 13,
    color: colors.textMuted,
  },

bookingRow: {
  marginTop: 8,
  paddingTop: 8,
  borderTopWidth: 1,
  borderTopColor: colors.border,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
},
bookingMain: {
  flex: 1,
  paddingRight: 8,
},
bookingTime: {
  fontSize: 13,
  color: colors.textMuted,
},
bookingService: {
  fontSize: 16,
  fontWeight: "600",
  color: colors.textPrimary,
  marginTop: 2,
},
bookingMeta: {
  fontSize: 13,
  color: colors.textSecondary,
  marginTop: 2,
},
bookingActions: {
  alignItems: "flex-end",
},
bookingEdit: {
  fontSize: 12,
  color: colors.primary,
},
bookingCancel: {
  fontSize: 12,
  color: colors.error,
  marginTop: 4,
},

  bookingNavigate: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 4,
  },

//   navigateButtonText: {
//   color: "#007AFF",      // or your theme color
//   fontSize: 16,
//   fontWeight: "600",
//   textDecorationLine: "none",  // remove underline / link style
// },

// navigateButton: {
//   paddingHorizontal: 14,
//   paddingVertical: 8,
//   backgroundColor: "#E6F5FF",
//   borderRadius: 8,
//   alignSelf: "flex-start",
// },

navigateButtonContainer: {
  marginTop: 12,
  width: "100%",
  alignItems: "center",
},

navigateButton: {
  backgroundColor: colors.primary,
  paddingVertical: 10,
  paddingHorizontal: 18,
  borderRadius: 999,                 // pill shape
  alignItems: "center",
  justifyContent: "center",
},

navigateButtonText: {
  color: colors.textPrimary,
  fontSize: 15,
  fontWeight: "600",
},



mapContainer: {
  marginTop: 12,
  width: "100%",
  height: 160,
  borderRadius: 12,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: colors.border,
},

searchSafeArea: {
  flex: 1,
  backgroundColor: colors.background,
},
searchHeader: {
  paddingHorizontal: 16,
  paddingTop: 8,
  paddingBottom: 12,
  backgroundColor: colors.background,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
},
searchHeaderTitle: {
  fontSize: 16,
  fontWeight: "600",
  color: colors.textPrimary,
  marginBottom: 8,
},
searchBar: {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: colors.surfaceElevated,
  borderRadius: 14,
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: colors.border,
  shadowColor: "#000",
  shadowOpacity: 0.06,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
},
searchInput: {
  flex: 1,
  marginLeft: 8,
  fontSize: 15,
  color: colors.textPrimary,
},
chipsRow: {
  marginTop: 10,
},
chipsContent: {
  paddingVertical: 4,
},
filterChip: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: "transparent",
  marginRight: 8,
},
filterChipSelected: {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
},
filterChipText: {
  fontSize: 12,
  color: colors.textSecondary,
  fontWeight: "600",
},
filterChipTextSelected: {
  color: colors.textPrimary,
},
locationErrorText: {
  marginTop: 6,
  fontSize: 12,
  color: colors.error,
},
searchContent: {
  paddingHorizontal: 16,
  paddingTop: 12,
  paddingBottom: 32,
},
resultsSection: {
  marginBottom: 16,
},
resultsHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
},
resultsCount: {
  fontSize: 12,
  color: colors.textMuted,
  fontWeight: "600",
},
emptyStateCard: {
  backgroundColor: colors.surface,
  borderRadius: 14,
  padding: 16,
  borderWidth: 1,
  borderColor: colors.border,
},
emptyStateTitle: {
  fontSize: 15,
  fontWeight: "700",
  color: colors.textPrimary,
  marginBottom: 6,
},
emptyStateText: {
  fontSize: 13,
  color: colors.textSecondary,
  lineHeight: 18,
},
skeletonList: {
  gap: 12,
},
skeletonCard: {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: colors.surface,
  borderRadius: 14,
  padding: 14,
  borderWidth: 1,
  borderColor: colors.border,
},
skeletonAvatar: {
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: colors.surfaceElevated,
},
skeletonDetails: {
  flex: 1,
  marginLeft: 12,
},
skeletonLine: {
  height: 12,
  borderRadius: 6,
  backgroundColor: colors.surfaceElevated,
  marginBottom: 8,
},
skeletonLineShort: {
  height: 10,
  width: "60%",
  borderRadius: 6,
  backgroundColor: colors.surfaceElevated,
},

  providerScroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  profileTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitleSmall: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  serviceRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: colors.surfaceElevated,
    flexDirection: "row",
  },
  serviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  serviceMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  serviceHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    marginTop: 4,
  },
  datePill: {
    width: 60,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  datePillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  datePillDisabled: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    opacity: 0.6,
  },
  datePillDow: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  datePillDay: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  timesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  timeSlotButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  timeSlotLabel: {
    fontSize: 13,
    color: colors.textPrimary,
  },

  timeSlotButtonSelected: {
  backgroundColor: colors.primary,
  borderColor: colors.primary,
},
timeSlotLabelSelected: {
  color: colors.textPrimary,
},

bookButton: {
  marginTop: 12,
  paddingVertical: 12,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.primary,
},
bookButtonDisabled: {
  backgroundColor: colors.textMuted,
},
bookButtonLabel: {
  fontSize: 15,
  fontWeight: "600",
  color: colors.textPrimary,
  
},

professionChipsContainer: {
  flexDirection: "row",
  flexWrap: "wrap",
  marginTop: 8,
  marginBottom: 4,
},
professionChip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surfaceElevated,
  marginRight: 6,
  marginBottom: 6,
},
professionChipSelected: {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
},
professionChipText: {
  fontSize: 12,
  color: colors.textSecondary,
},
professionChipTextSelected: {
  color: colors.textPrimary,
  fontWeight: "600",
},
customProfessionRow: {
  flexDirection: "row",
  alignItems: "center",
  marginTop: 8,
  marginBottom: 4,
},
customProfessionAddButton: {
  marginLeft: 8,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 8,
  backgroundColor: colors.primary,
},
customProfessionAddText: {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: "600",
},

radiusPill: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
  marginRight: 8,
},
radiusPillSelected: {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
},
radiusPillText: {
  fontSize: 12,
  color: colors.textSecondary,
},
radiusPillTextSelected: {
  color: colors.textPrimary,
  fontWeight: "600",
},

hoursInput: {
  // whatever you already have
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
  backgroundColor: colors.surfaceElevated,
  color: colors.textPrimary,
},

hoursInputFocused: {
  borderColor: colors.primary,
},

providerSummaryCard: {
  backgroundColor: colors.surface,
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 12,
  marginBottom: 12,
  shadowColor: "#000",
  shadowOpacity: 0.05,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
},

providerSummaryLabel: {
  fontSize: 13,
  color: colors.textMuted,
},

providerSummaryValue: {
  fontSize: 17,
  fontWeight: "600",
  color: colors.textPrimary,
},

providerShareProfileLinkRow: {
  alignItems: "flex-start",
  marginBottom: 12,
  marginTop: 4,
},
providerShareProfileLinkButton: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: colors.primarySoft,
  borderWidth: 1,
  borderColor: colors.primary,
},
providerShareProfileLinkButtonText: {
  fontSize: 12,
  fontWeight: "600",
  color: colors.primary,
},

providerBillingScroll: {
  flexGrow: 1,
  backgroundColor: colors.background,
  padding: 20,
  paddingTop: 60,
},

billingCard: {
  backgroundColor: colors.surface,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: colors.border,
  shadowColor: "#000",
  shadowOpacity: 0.04,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
},

billingHeaderRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 6,
},

billingMonth: {
  fontSize: 18,
  fontWeight: "700",
  color: colors.textPrimary,
},

billingMeta: {
  fontSize: 13,
  color: colors.textSecondary,
},

billingStatus: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: "700",
},

billingStatusReady: {
  backgroundColor: colors.primarySoft,
  color: colors.textPrimary,
  borderColor: colors.primary,
  borderWidth: 1,
},

billingStatusPaid: {
  backgroundColor: colors.primarySoft,
  color: colors.textPrimary,
  borderColor: colors.primary,
  borderWidth: 1,
},

billingStatusUnpaid: {
  backgroundColor: colors.surfaceElevated,
  color: colors.error,
  borderColor: colors.error,
  borderWidth: 1,
},

billingStatusUpcoming: {
  backgroundColor: colors.surfaceElevated,
  color: colors.textSecondary,
  borderColor: colors.border,
  borderWidth: 1,
},

billingToggleRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "flex-start",
  marginTop: 10,
},

billingToggleText: {
  fontSize: 14,
  fontWeight: "700",
  color: colors.primary,
  marginRight: 6,
},


billingLineItems: {
  marginTop: 12,
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: 8,
},

billingLineItem: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
},

billingLineLabel: {
  fontSize: 15,
  fontWeight: "600",
  color: colors.textPrimary,
  marginBottom: 2,
},

billingAmount: {
  fontSize: 15,
  fontWeight: "700",
  color: colors.textPrimary,
  marginLeft: 12,
},

billingTotalsRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 8,
},

billingTotalsLabel: {
  fontSize: 14,
  color: colors.textSecondary,
},

billingTotalsValue: {
  fontSize: 16,
  fontWeight: "700",
  color: colors.textPrimary,
},

  providerAvatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: colors.surfaceElevated,
  },
  providerAvatarSmallFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  providerAvatarSmallInitial: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
  },

    profileAvatarWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileAvatarImage: {
    width: "100%",
    height: "100%",
  },
  profileAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarInitial: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  authPrimaryButton: {
  backgroundColor: colors.primary,
  paddingVertical: 14,
  borderRadius: 6,
  alignItems: "center",
  marginBottom: 12,
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 3,
  elevation: 3,
},

authPrimaryButtonText: {
  color: colors.textPrimary,
  fontSize: 16,
  fontWeight: "600",
},

authSecondaryButton: {
  backgroundColor: "transparent",
  paddingVertical: 14,
  borderRadius: 6,
  alignItems: "center",
  borderWidth: 1,
  borderColor: colors.primary,
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 3,
  elevation: 3,
},

  authSecondaryButtonText: {
  color: colors.primary,
  fontSize: 16,
  fontWeight: "600",
},
facebookButton: {
  backgroundColor: "#1877F2",
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: "center",
},
facebookButtonText: {
  color: "#ffffff",
  fontSize: 16,
  fontWeight: "600",
},
signupButton: {
  backgroundColor: colors.primary,
  paddingVertical: 14,
  borderRadius: 6,
  alignItems: "center",
  marginBottom: 12,
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 3,
  elevation: 3,
},
signupButtonDisabled: {
  backgroundColor: colors.textMuted,
  opacity: 0.6,
},
signupButtonText: {
  color: colors.textPrimary,
  fontSize: 16,
  fontWeight: "600",
},
saveServiceButton: {
  paddingVertical: 12,
  borderRadius: 6,
  alignItems: "center",
  justifyContent: "center",
},
saveServiceButtonEnabled: {
  backgroundColor: colors.primary,
  opacity: 1,
},
saveServiceButtonDisabled: {
  backgroundColor: colors.textMuted,
  opacity: 0.6,
},
saveServiceButtonContent: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
},
saveServiceButtonSpinner: {
  marginRight: 8,
},
saveServiceButtonText: {
  color: colors.textPrimary,
  fontSize: 16,
  fontWeight: "600",
},
signupTextButton: {
  alignItems: "center",
  paddingVertical: 8,
},
signupTextButtonDisabled: {
  opacity: 0.4,
},
signupTextButtonText: {
  color: colors.primary,
  fontSize: 16,
  fontWeight: "600",
},

  avoider: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  logoWrapper: {
    alignItems: "center",
    marginBottom: 24,
  },
  logo: {
    width: 260,
    height: 260,
    resizeMode: "contain",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 16,
  },

    catalogGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  catalogItem: {
    width: "30%",
    marginRight: 8,
    marginBottom: 12,
  },
  catalogImage: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
  },
  catalogCaption: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  catalogDeleteText: {
    fontSize: 11,
    color: colors.error,
    marginTop: 2,
  },

    searchCatalogStrip: {
    marginTop: 8,
    marginBottom: 8,
  },
  searchCatalogImage: {
    width: 140,
    height: 180,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: colors.surfaceElevated,
  },

  providerCalendarScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  providerCalendarContentContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  providerCalendarModeSwitch: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  providerCalendarModeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  providerCalendarModeButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  providerCalendarModeText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },
  providerCalendarModeTextActive: {
    color: colors.textPrimary,
  },
  providerCalendarTopActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 0,
    marginTop: 10,
    marginBottom: 6,
  },
  providerCalendarCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 8,
  },
  providerCalendarViewport: {
    overflow: "hidden",
    borderRadius: 10,
  },
  providerCalendarViewportMonth: {
    height: 360,
  },
  providerCalendarViewportWeek: {
    height: 168,
    overflow: "hidden",
  },
  providerWeeklyStrip: {
    width: "100%",
    paddingVertical: 10,
  },
  providerWeeklyRow: {
    flexDirection: "row",
    width: "100%",
    paddingHorizontal: 8,
  },
  providerWeeklyCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 70,
  },
  providerWeeklyDow: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 13,
    height: 13,
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
    marginBottom: 10,
  },
  providerWeeklyDayWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  providerWeeklyDayWrapSelected: {
    backgroundColor: colors.primarySoft,
  },
  providerWeeklyDayText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  providerWeeklyDayTextMuted: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  providerWeeklyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  providerCalendarDailyLayout: {
    borderRadius: 10,
    overflow: "hidden",
  },
  providerCalendarDayStrip: {
    minHeight: 104,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  providerCalendarViewportDay: {
    height: 500,
    backgroundColor: colors.surface,
    width: "100%",
    overflow: Platform.OS === "android" ? "visible" : "hidden",
  },
  providerDayScheduleScroll: {
    flex: 1,
    width: "100%",
    overflow: Platform.OS === "android" ? "visible" : "hidden",
  },
  providerDayScheduleScrollContent: {
    minWidth: "100%",
  },
  providerDayScheduleRow: {
    flexDirection: "row",
    width: "100%",
    position: "relative",
  },
  providerDayScheduleGutter: {
    position: "relative",
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
  },
  providerDayScheduleTimeLabel: {
    position: "absolute",
    left: 6,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    transform: [{ translateY: -8 }],
  },
  providerDayScheduleGrid: {
    flex: 1,
    position: "relative",
    backgroundColor: colors.surface,
  },
  providerDayScheduleHourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
  providerDayScheduleHalfHourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  providerDayScheduleEvent: {
    borderRadius: 12,
    overflow: "hidden",
  },
  providerDayScheduleEventsOverlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "box-none",
  },
  providerDayScheduleEventCompleted: {
    opacity: 0.6,
  },
  providerDayScheduleEventAccent: {
    width: 4,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  providerDayScheduleEventBody: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  providerDayScheduleEventTime: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  providerDayScheduleEventTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  providerDayScheduleEventSummary: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  providerDayScheduleStatusBadge: {
    alignSelf: "flex-start",
    marginTop: 7,
    marginRight: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  providerDayScheduleStatusBadgeCancelled: {
    borderColor: colors.error,
  },
  providerDayScheduleStatusBadgeCompleted: {
    borderColor: colors.success,
  },
  providerDayScheduleStatusText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "700",
  },
  providerDayScheduleStatusTextCancelled: {
    color: colors.error,
  },
  providerDayScheduleStatusTextCompleted: {
    color: colors.success,
  },
  providerCalendarHeaderBlock: {
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  providerCalendarListContent: {
    paddingBottom: 24,
  },
  providerCalendarEmpty: {
    color: colors.textMuted,
    marginTop: 10,
    fontSize: 14,
  },
  providerCalendarRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  providerCalendarLeftAccentBar: {
    width: 4,
    borderRadius: 999,
    marginRight: 10,
    alignSelf: "stretch",
  },
  providerCalendarRowCompleted: {
    opacity: 0.75,
  },
  providerCalendarTime: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  providerCalendarService: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  providerCalendarCustomer: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  providerCalendarTextCompleted: {
    color: colors.textMuted,
  },
  providerCalendarStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    backgroundColor: colors.surfaceElevated,
  },
  providerCalendarStatusBadgeCancelled: {
    borderColor: colors.error,
  },
  providerCalendarStatusBadgeCompleted: {
    borderColor: colors.success,
  },
  providerCalendarStatusText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  providerCalendarStatusTextCancelled: {
    color: colors.error,
  },
  providerCalendarStatusTextCompleted: {
    color: colors.success,
  },
  providerCalendarRightActions: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    minHeight: 72,
  },
  providerCalendarCancelButton: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "rgba(255,107,107,0.10)",
  },
  providerCalendarCancelButtonDisabled: {
    opacity: 0.7,
  },
  providerCalendarCancelButtonLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  providerCalendarCancelButtonText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: "700",
  },
  providerCalendarCancelAllButton: {
    marginLeft: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "rgba(255,107,107,0.14)",
  },
  providerCalendarCancelAllButtonDisabled: {
    opacity: 0.7,
  },
  providerCalendarCancelAllButtonText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: "800",
  },

})

export default App;
