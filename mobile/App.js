import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";

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
  AppState,
  useWindowDimensions,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import * as Sharing from "expo-sharing";

import {
  NavigationContainer,
  CommonActions,
  useFocusEffect,
  useIsFocused,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearAllAuthTokens,
  loadToken,
  saveRefreshToken,
  saveToken,
} from "./src/components/tokenStorage";
import ProviderCard from "./src/components/ProviderCard";
import ProviderShareCard from "./src/components/ProviderShareCard";
import * as Location from "expo-location";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
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
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { apiClient } from "./src/api";
import { submitBookingRating } from "./src/api/bookings";
import { getRatingSummary } from "./src/components/RatingSummary";
import {
  durationPartsToMinutes,
  formatDuration,
  minutesToDurationParts,
  validateDurationParts,
} from "./src/utils/duration";
// import { AccessToken, LoginManager } from "react-native-fbsdk-next";
import BookitGYLogoTransparent from "./assets/bookitgy-logo-transparent.png"
import { theme } from "./src/theme";
// import * as Sentry from "sentry-expo";

let Clipboard = null;
let ViewShot = null;
let captureRef = null;
try {
  Clipboard = require("expo-clipboard");
} catch (e) {}
try {
  const viewShotModule = require("react-native-view-shot");
  ViewShot =
    viewShotModule?.default ||
    viewShotModule?.ViewShot ||
    (typeof viewShotModule === "function" ? viewShotModule : null);
  captureRef =
    viewShotModule?.captureRef ||
    viewShotModule?.default?.captureRef ||
    null;
} catch (e) {}

enableScreens(false);
WebBrowser.maybeCompleteAuthSession();




// import { API } from "./App"; // wherever you define your base URL





const API =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL ||
  "https://bookitgy.onrender.com";

const CLOUDINARY_CLOUD_NAME =
  process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  Constants.expoConfig?.extra?.CLOUDINARY_CLOUD_NAME ||
  Constants.manifest?.extra?.CLOUDINARY_CLOUD_NAME ||
  "";

const CLOUDINARY_UPLOAD_PRESET =
  process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ||
  Constants.expoConfig?.extra?.CLOUDINARY_UPLOAD_PRESET ||
  Constants.manifest?.extra?.CLOUDINARY_UPLOAD_PRESET ||
  "";

const CLOUDINARY_BOOKING_MESSAGES_FOLDER =
  process.env.EXPO_PUBLIC_CLOUDINARY_BOOKING_MESSAGES_FOLDER ||
  Constants.expoConfig?.extra?.CLOUDINARY_BOOKING_MESSAGES_FOLDER ||
  Constants.manifest?.extra?.CLOUDINARY_BOOKING_MESSAGES_FOLDER ||
  "bookitgy/booking_messages";

console.log("### API base URL =", API);


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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

const PROVIDER_BLOCKED_STATUS_THEME = {
  accent: "#C0392B",
  bgTint: "rgba(192,57,43,0.10)",
  border: "rgba(192,57,43,0.35)",
};

const getServiceDurationMinutes = (service) => {
  if (service?.duration_minutes != null) {
    return Number(service.duration_minutes) || 0;
  }
  return durationPartsToMinutes({
    days: service?.duration_days || 0,
    hours: service?.duration_hours || 0,
    minutes: service?.duration_minutes_part || 0,
  });
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

const isOnboardingIncomplete = (userData) => {
  if (!userData || typeof userData !== "object") return false;
  if (userData?.needs_onboarding === true) return true;
  return String(userData?.phone || "").trim().length === 0;
};

const persistFacebookSession = async ({
  responseData,
  setToken,
  setIsAdmin,
}) => {
  await saveToken(responseData.access_token);
  await saveRefreshToken(responseData.refresh_token);

  let meData = null;
  try {
    const meRes = await apiClient.get(`/users/me`);
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

const GUYANA_TIME_ZONE = "America/Guyana";
const GUYANA_LOCALE = "en-US";

const isSameGuyanaCalendarDay = (start, end) => {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return false;
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return false;

  const keyOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: GUYANA_TIME_ZONE,
  };

  return (
    start.toLocaleDateString(GUYANA_LOCALE, keyOptions) ===
    end.toLocaleDateString(GUYANA_LOCALE, keyOptions)
  );
};

const formatProviderAppointmentSpan = (start, end) => {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return {
      isSameDay: true,
      compactLabel: "--:--",
      startLabel: "Starts: --",
      endLabel: "Ends: --",
    };
  }

  const timeLabel = (value) =>
    value.toLocaleTimeString(GUYANA_LOCALE, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: GUYANA_TIME_ZONE,
    });

  const shortDateLabel = (value) =>
    value.toLocaleDateString(GUYANA_LOCALE, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: GUYANA_TIME_ZONE,
    });

  const fullDateLabel = (value) =>
    value.toLocaleDateString(GUYANA_LOCALE, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: GUYANA_TIME_ZONE,
    });

  const hasEnd = end instanceof Date && !Number.isNaN(end.getTime());
  const sameDay = hasEnd ? isSameGuyanaCalendarDay(start, end) : true;

  if (hasEnd && sameDay) {
    return {
      isSameDay: true,
      compactLabel: `${shortDateLabel(start)} · ${timeLabel(start)} – ${timeLabel(end)}`,
      startLabel: null,
      endLabel: null,
    };
  }

  if (hasEnd) {
    return {
      isSameDay: false,
      compactLabel: null,
      startLabel: `Starts: ${fullDateLabel(start)} · ${timeLabel(start)}`,
      endLabel: `Ends: ${fullDateLabel(end)} · ${timeLabel(end)}`,
    };
  }

  return {
    isSameDay: true,
    compactLabel: `${shortDateLabel(start)} · ${timeLabel(start)} – --:--`,
    startLabel: null,
    endLabel: null,
  };
};

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
      const res = await apiClient.get(`/providers`);
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
function LandingScreen({ goToLogin, goToSignup, onGooglePress, googleLoading }) {
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

            <View style={{ width: "100%", marginBottom: 12 }}>
              {googleLoading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <TouchableOpacity
                  style={styles.googleButton}
                  onPress={onGooglePress}
                  disabled={googleLoading}
                >
                  <Ionicons name="logo-google" size={20} color="#4285F4" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </TouchableOpacity>
              )}
            </View>

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
  pendingGoogleLink,
  onCancelGoogleLink,
  clearPendingGoogleLink,
  onEmailNotVerified,
  goToSignup,
  goToForgot,
  goBack,
  showFlash,
  onGooglePress,
  googleLoading,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);

  const pendingGoogleLinkEmailLabel = pendingGoogleLink?.email || "this email";


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

    const res = await apiClient.post(`/auth/login`, body, {
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

    if (pendingGoogleLink?.tokenPayload) {
      try {
        await apiClient.post(`/auth/link-google`, pendingGoogleLink.tokenPayload);
        showFlash?.("success", "Google account linked.");
        clearPendingGoogleLink?.();
      } catch (linkError) {
        const linkErrorCode = normalizeErrorCode(linkError?.response?.data);
        if (linkErrorCode === "GOOGLE_ALREADY_LINKED") {
          showFlash?.("error", "This Google account is already linked to another account.");
          clearPendingGoogleLink?.();
        } else {
          console.log("Google link error:", linkError?.response?.data || linkError?.message || linkError);
          showFlash?.("error", "Unable to link your Google account right now.");
          clearPendingGoogleLink?.();
        }
      }
    }

    let meData = null;
    try {
      const meRes = await apiClient.get(`/users/me`);
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
      const detail = e.response?.data?.detail;
      const errorCode = normalizeErrorCode(e.response?.data);
      const verifyHint = `${detail || ""}`.toLowerCase();

      if (
        errorCode === "EMAIL_NOT_VERIFIED" ||
        verifyHint.includes("verify") ||
        verifyHint.includes("not verified")
      ) {
        if (showFlash) {
          showFlash(
            "error",
            "Please verify your email first. Check your inbox for the confirmation link."
          );
        }
        onEmailNotVerified?.(normalizedEmail);
        return;
      }

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
        const res = await apiClient.post(`/auth/facebook/complete`, payload);
        await persistFacebookSession({
          responseData: res.data,
          setToken,
          setIsAdmin,
        });
        clearPendingGoogleLink?.();
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

        {pendingGoogleLink?.tokenPayload && (
          <View style={styles.linkGoogleBanner}>
            <Text style={styles.linkGoogleBannerText}>
              {`Log in to link Google: ${pendingGoogleLinkEmailLabel}`}
            </Text>
            <TouchableOpacity onPress={onCancelGoogleLink}>
              <Text style={styles.linkGoogleBannerAction}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

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

          <View style={{ width: "100%", marginBottom: 12 }}>
            {googleLoading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <TouchableOpacity
                style={styles.googleButton}
                onPress={onGooglePress}
                disabled={googleLoading}
              >
                <Ionicons name="logo-google" size={20} color="#4285F4" />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </TouchableOpacity>
            )}
          </View>

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

function VerifyEmailScreen({ email, goToLogin }) {
  const displayedEmail = (email || "your email").trim() || "your email";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.subtitle}>
        We sent a verification link to {displayedEmail}. You must verify your email before you can log in.
      </Text>

      <TouchableOpacity style={[styles.authSecondaryButton, { marginTop: 24 }]} onPress={goToLogin}>
        <Text style={styles.authSecondaryButtonText}>Back to Login</Text>
      </TouchableOpacity>

      {/* TODO: Add "Resend Email" button when backend resend-verification endpoint is available. */}
    </View>
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
      const res = await apiClient.post(`/auth/forgot-password`, {
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
  setupContext,
  setToken,
  setIsAdmin,
  goBackToLogin,
  showFlash,
}) {
  const [phone, setPhone] = useState(setupContext?.initialPhone || "");
  const [email, setEmail] = useState(setupContext?.initialEmail || "");
  const [isProvider, setIsProvider] = useState(
    setupContext?.initialIsProvider || false
  );
  const [submitting, setSubmitting] = useState(false);

  const requiresEmail = !!setupContext?.requiresEmail;

  const submitFinishSetup = async () => {
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    if (!trimmedPhone) {
      showFlash?.("error", "Phone is required.");
      return;
    }

    if (!/^\d+$/.test(trimmedPhone)) {
      showFlash?.("error", "Phone must contain only digits.");
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
      if (setupContext?.mode === "facebook") {
        const payload = {
          facebook_access_token: setupContext?.facebookAccessToken,
          phone: trimmedPhone,
          is_provider: isProvider,
        };

        if (trimmedEmail) {
          payload.email = trimmedEmail.toLowerCase();
        }

        const res = await apiClient.post(`/auth/facebook/complete`, payload);
        await persistFacebookSession({
          responseData: res.data,
          setToken,
          setIsAdmin,
        });
      } else {
        await apiClient.post(`/auth/complete-profile`, {
          phone: trimmedPhone,
          is_provider: isProvider,
        });

        const meRes = await apiClient.get(`/users/me`);
        const meData = meRes.data;
        const latestToken = await loadToken();
        setToken({
          token: latestToken,
          userId: meData?.id || meData?.user_id,
          email: meData?.email,
          username: meData?.username,
          isProvider: Boolean(meData?.is_provider),
          isAdmin: Boolean(meData?.is_admin),
        });
        setIsAdmin(Boolean(meData?.is_admin));
      }

      showFlash?.("success", "Logged in successfully");
    } catch (error) {
      const errorCode = normalizeErrorCode(error?.response?.data);
      const detailMessage = String(error?.response?.data?.detail || "").toLowerCase();
      if (errorCode === "PHONE_TAKEN" || detailMessage.includes("phone") && detailMessage.includes("use")) {
        showFlash?.("error", "This phone number is already in use.");
      } else if (setupContext?.mode === "facebook") {
        showFlash?.("error", getFacebookCompleteErrorMessage(errorCode));
      } else {
        showFlash?.("error", "Unable to complete setup. Please try again.");
      }
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
              placeholder="Phone (592XXXXXXX)"
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
                <Text style={styles.toggleLabel}>Register as Service Provider</Text>
                <Text style={styles.toggleHelper}>
                  Turn this on if you offer services to clients.
                </Text>
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




function SignupScreen({ goToLogin, goBack, showFlash, onSignupSuccess }) {
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
      await apiClient.post(`/auth/signup`, {
        email: normalizedEmail,
        password: trimmedPassword,
        username: trimmedUsername,
        phone: trimmedPhone,          // plain phone as user entered
        location: "Georgetown",
        whatsapp: whatsappValue,      // normalized WhatsApp format
        is_provider: isProvider,      // tell backend this is a provider
      });

      if (showFlash) {
        showFlash("success", "Account created! Check your email to verify.");
      } else {
        Alert.alert("Success", "Account created! Check your email to verify.");
      }

      onSignupSuccess?.(normalizedEmail);
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
function ProfileScreen({ authLoading, setToken, showFlash, token }) {
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
  const providerShareCardRef = useRef(null);
  const [shareCardVisible, setShareCardVisible] = useState(false);
  const [sharingProviderCard, setSharingProviderCard] = useState(false);
  const [isShareBrandingReady, setIsShareBrandingReady] = useState(false);
  const isShareBrandingReadyRef = useRef(false);
  const [providerProfile, setProviderProfile] = useState(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    isShareBrandingReadyRef.current = isShareBrandingReady;
  }, [isShareBrandingReady]);

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

          console.log("[profile] refresh data", meRes?.data);

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
            setProviderProfile(provRes.data || null);
            if (provRes.data.avatar_url) {
              avatar = provRes.data.avatar_url;
            }
          } catch (err) {
            setProviderProfile(null);
            console.log(
              "Error loading provider avatar for profile",
              err.response?.data || err.message
            );
          }
        } else {
          setProviderProfile(null);
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
      const res = await apiClient.put("/users/me", payload);
      console.log("[profile] save response status", res?.status);

      const meRes = await apiClient.get("/users/me");
      console.log("[profile] refresh data", meRes?.data);
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

    const res = await apiClient.get("/bookings/me");

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

  const providerShareProfessions = useMemo(() => {
    const candidateSources = [
      providerProfile?.professions,
      user?.provider_profile?.professions,
      user?.professions,
    ];

    const rawProfessions =
      candidateSources.find((source) => Array.isArray(source) && source.length > 0) || [];

    return rawProfessions
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          return entry.name || entry.title || entry.label || entry.profession || "";
        }
        return "";
      })
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }, [providerProfile?.professions, user]);
  const handleProviderSharePreviewLayout = useCallback((event) => {
    const containerWidth = event?.nativeEvent?.layout?.width || 0;
    if (containerWidth <= 0) return;
    const scale = containerWidth / 600;
    setPreviewScale(scale);
  }, []);

  const providerShareRatingValue = useMemo(() => {
    const ratingCandidates = [
      providerProfile?.avg_rating,
      providerProfile?.rating,
      user?.provider_profile?.avg_rating,
      user?.provider_profile?.rating,
      user?.avg_rating,
      user?.rating,
    ];

    const resolvedRating = ratingCandidates
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value));

    return resolvedRating > 0 ? Number(resolvedRating.toFixed(1)) : 0;
  }, [
    providerProfile?.avg_rating,
    providerProfile?.rating,
    user?.provider_profile?.avg_rating,
    user?.provider_profile?.rating,
    user?.avg_rating,
    user?.rating,
  ]);

  console.log("[provider-share-rating]", {
    providerProfileAvg: providerProfile?.avg_rating,
    providerProfileRating: providerProfile?.rating,
    userProviderProfileAvg: user?.provider_profile?.avg_rating,
    userAvg: user?.avg_rating,
    resolved: providerShareRatingValue,
  });

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
  Alert.alert("Cancel booking", "Are you sure you want to cancel this booking?", [
    { text: "No", style: "cancel" },
    {
      text: "Yes, cancel",
      style: "destructive",
      onPress: async () => {
        try {
          await apiClient.post(`/bookings/${bookingId}/cancel`);

          setBookings((prev) =>
            (prev || []).map((b) =>
              b.id === bookingId ? { ...b, status: "cancelled" } : b
            )
          );

          if (showFlash) showFlash("success", "Booking cancelled");
        } catch (err) {
          console.log("Error cancelling booking (client)", err.response?.data || err.message);
          if (showFlash) showFlash("error", "Could not cancel booking.");
        }
      },
    },
  ]);
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

  const handleShareProviderCard = async () => {
    const hasViewShot = Boolean(ViewShot);
    const hasCaptureRef = typeof captureRef === "function";
    const hasCardRef = Boolean(providerShareCardRef.current);

    console.log("[ProviderShareCard] share preflight", {
      hasViewShot,
      hasCaptureRef,
      hasCardRef,
    });

    if (!hasViewShot || !hasCaptureRef) {
      showFlash?.("error", "Sharing is not available in this build yet.");
      return;
    }

    try {
      setSharingProviderCard(true);
      isShareBrandingReadyRef.current = false;
      setIsShareBrandingReady(false);
      setShareCardVisible(true);

      // The modal ViewShot ref may not exist immediately after making the modal visible, so wait briefly for mount before capture.
      await new Promise((resolve) => {
        const startedAt = Date.now();
        const waitForModalMount = () => {
          if (providerShareCardRef.current || Date.now() - startedAt >= 325) {
            resolve();
            return;
          }
          requestAnimationFrame(waitForModalMount);
        };

        waitForModalMount();
      });

      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
          });
        });
      });

      if (!providerShareCardRef.current) {
        showFlash?.("error", "Sharing is not available in this build yet.");
        return;
      }

      // iOS can capture the visible modal card before the branding image finishes painting.
      await new Promise((resolve) => {
        if (isShareBrandingReadyRef.current) {
          resolve();
          return;
        }

        const startedAt = Date.now();
        const waitForBranding = () => {
          if (isShareBrandingReadyRef.current || Date.now() - startedAt >= 850) {
            resolve();
            return;
          }
          requestAnimationFrame(waitForBranding);
        };

        waitForBranding();
      });

      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });

      console.log("[ProviderShareCard] capture state", {
        hasCardRef: Boolean(providerShareCardRef.current),
        isShareBrandingReady: isShareBrandingReadyRef.current,
      });

      const imageUri = await captureRef(providerShareCardRef.current, {
        format: "png",
        quality: 1,
        width: 1200,
        height: Math.round(1200 / 1.9),
      });

      if (!imageUri) {
        showFlash?.("error", "Could not generate your provider card image.");
        return;
      }

      const isNativeShareAvailable = await Sharing.isAvailableAsync();
      if (!isNativeShareAvailable) {
        showFlash?.("error", "Sharing is not available on this device.");
        return;
      }

      await Sharing.shareAsync(imageUri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "My BookitGY provider card",
      });
    } catch (err) {
      console.log("Error sharing provider card", err?.message || err);
      showFlash?.("error", "Could not generate your provider card image.");
    } finally {
      setSharingProviderCard(false);
      setShareCardVisible(false);
    }
  };

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
    <>
      <Modal
        animationType="none"
        transparent
        visible={shareCardVisible && Boolean(ViewShot)}
        statusBarTranslucent
      >
        <View style={styles.providerShareCaptureOverlay} pointerEvents="none">
          <ViewShot
            ref={providerShareCardRef}
            options={{ format: "png", quality: 1 }}
            style={styles.providerShareCaptureCardWrap}
          >
            <ProviderShareCard
              avatarUrl={displayAvatarUrl}
              username={user.username || user.full_name || "bookitgy_provider"}
              professions={providerShareProfessions}
              ratingValue={providerShareRatingValue}
              brandingSource={BookitGYLogoTransparent}
              onBrandingLoadEnd={() => {
                isShareBrandingReadyRef.current = true;
                setIsShareBrandingReady(true);
              }}
            />
          </ViewShot>
        </View>
      </Modal>

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

      {isProvider && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Share your provider card</Text>
          <Text style={styles.hoursHelp}>
            Create a polished card image to share on WhatsApp, Facebook, Instagram, and Stories.
          </Text>
          <View
            style={styles.providerSharePreviewWrap}
            onLayout={handleProviderSharePreviewLayout}
          >
            <View
              style={[
                styles.providerSharePreviewCardWrap,
                { transform: [{ scale: previewScale }] },
              ]}
            >
              <ProviderShareCard
                avatarUrl={displayAvatarUrl}
                username={user.username || user.full_name || "bookitgy_provider"}
                professions={providerShareProfessions}
                ratingValue={providerShareRatingValue}
                brandingSource={BookitGYLogoTransparent}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.providerShareButton,
              sharingProviderCard && styles.providerShareButtonDisabled,
            ]}
            onPress={handleShareProviderCard}
            disabled={sharingProviderCard}
          >
            <Text style={styles.actionButtonText}>
              {sharingProviderCard ? "Generating card..." : "Share card image"}
            </Text>
          </TouchableOpacity>
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
    </>
  );
}



function ClientHomeScreen({
  navigation,
  token,
  unreadNotificationCount = 0,
  onPressNotifications,
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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <NotificationBell
          unreadCount={unreadNotificationCount}
          onPress={onPressNotifications || (() => navigation.navigate('Notifications'))}
        />
      ),
    });
  }, [navigation, onPressNotifications, unreadNotificationCount]);

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

    const res = await apiClient.get(`/providers`, { timeout: 8000 });
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

  //     const res = await apiClient.get(`/providers`);
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






const getCleanApiErrorMessage = (err, fallbackMessage) => {
  const detail =
    err?.response?.data?.detail ||
    err?.response?.data?.message ||
    err?.message;
  if (!detail) return fallbackMessage;
  if (typeof detail === "string") return detail;
  return fallbackMessage;
};

const getBookingChatReadOnlyReason = (booking) => {
  if (!booking) return null;

  const normalizedStatus = String(booking?.status || booking?.state || "")
    .trim()
    .toLowerCase();

  const isCancelled =
    normalizedStatus === "cancelled" ||
    normalizedStatus === "canceled" ||
    Boolean(
      booking?.cancelled_at ||
      booking?.canceled_at ||
      booking?.is_cancelled ||
      booking?.isCanceled
    );

  if (isCancelled) {
    return "Messaging is unavailable because this appointment has been cancelled.";
  }

  const isCompleted =
    normalizedStatus === "completed" ||
    Boolean(booking?.completed_at || booking?.is_completed);

  if (isCompleted) {
    return "Messaging is unavailable because this appointment is completed.";
  }

  return null;
};

function BookingChatModal({
  visible,
  onClose,
  booking,
  currentUserId,
  currentUserIsProvider = false,
  showFlash,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);
  const [chatUsers, setChatUsers] = useState({ provider: null, client: null });
  const listRef = useRef(null);
  const insets = useSafeAreaInsets();

  const bookingId = booking?.id || booking?.booking_id;
  const chatReadOnlyReason = getBookingChatReadOnlyReason(booking);
  const isChatReadOnly = Boolean(chatReadOnlyReason);
  const headerParticipant = useMemo(() => {
    if (!booking) return { username: "Chat", avatar_url: null };

    const toComparableId = (value) => {
      if (value == null) return null;
      const str = String(value).trim();
      return str.length ? str : null;
    };

    const resolveParticipantAvatar = (participant, fallback) =>
      resolveImageUrl(participant?.avatar_url) ||
      resolveImageUrl(participant?.profile_photo_url) ||
      resolveImageUrl(participant?.profile_image_url) ||
      resolveImageUrl(participant?.user?.avatar_url) ||
      resolveImageUrl(participant?.user?.profile_photo_url) ||
      resolveImageUrl(participant?.user?.profile_image_url) ||
      resolveImageUrl(participant?.provider?.avatar_url) ||
      resolveImageUrl(participant?.provider?.profile_photo_url) ||
      resolveImageUrl(participant?.provider?.profile_image_url) ||
      resolveImageUrl(participant?.client?.avatar_url) ||
      resolveImageUrl(participant?.client?.profile_photo_url) ||
      resolveImageUrl(participant?.client?.profile_image_url) ||
      resolveImageUrl(fallback?.avatar_url) ||
      resolveImageUrl(fallback?.profile_photo_url) ||
      resolveImageUrl(fallback?.profile_image_url) ||
      resolveImageUrl(fallback?.user?.avatar_url) ||
      resolveImageUrl(fallback?.user?.profile_photo_url) ||
      resolveImageUrl(fallback?.user?.profile_image_url) ||
      null;

    const normalizeParticipant = (participant, fallback) => ({
      ...participant,
      username:
        participant?.username ||
        participant?.name ||
        fallback?.username ||
        fallback?.name ||
        "Chat",
      avatar_url: resolveParticipantAvatar(participant, fallback),
    });

    const loggedInUserId = toComparableId(currentUserId);
    const providerAuthUserId = toComparableId(
      booking?.provider?.user_id || booking?.provider_user_id || chatUsers?.provider?.user_id
    );
    const clientAuthUserId = toComparableId(
      booking?.client?.user_id ||
        booking?.customer?.user_id ||
        booking?.client_user_id ||
        booking?.customer_user_id ||
        chatUsers?.client?.user_id
    );

    const provider = normalizeParticipant(chatUsers?.provider || booking?.provider || {}, {
      username: booking?.provider_username || booking?.provider_name,
      avatar_url:
        booking?.provider_avatar_url ||
        booking?.provider_profile_photo_url ||
        booking?.provider_profile_image_url,
    });

    const client = normalizeParticipant(
      chatUsers?.client || booking?.client || booking?.customer || {},
      {
        username:
          booking?.client_username ||
          booking?.client_name ||
          booking?.customer_username ||
          booking?.customer_name,
        avatar_url:
          booking?.client_avatar_url ||
          booking?.customer_avatar_url ||
          booking?.client_profile_photo_url ||
          booking?.customer_profile_photo_url ||
          booking?.client_profile_image_url ||
          booking?.customer_profile_image_url,
      }
    );

    if (loggedInUserId && providerAuthUserId && loggedInUserId === providerAuthUserId) {
      return client;
    }
    if (loggedInUserId && clientAuthUserId && loggedInUserId === clientAuthUserId) {
      return provider;
    }

    return currentUserIsProvider ? client : provider;
  }, [booking, currentUserId, currentUserIsProvider, chatUsers]);

  const logImageMessageShapeSummary = useCallback((context, details) => {
    console.log("[chat-image-debug] shape-summary", {
      context,
      ...details,
    });
  }, []);

  const getResolvedAvatarFromEntity = useCallback((entity) => {
    return (
      resolveImageUrl(entity?.avatar_url) ||
      resolveImageUrl(entity?.profile_photo_url) ||
      resolveImageUrl(entity?.profile_image_url) ||
      resolveImageUrl(entity?.user?.avatar_url) ||
      resolveImageUrl(entity?.user?.profile_photo_url) ||
      resolveImageUrl(entity?.user?.profile_image_url) ||
      null
    );
  }, []);

  const loadMessages = useCallback(
    async (useRefresh = false) => {
      if (!bookingId) return;
      try {
        if (useRefresh) setRefreshing(true);
        else setLoading(true);

        const res = await apiClient.get(`/bookings/${bookingId}/messages`);
        let providerFromMessages = res?.data?.provider || null;
        const providerAvatarFromMessages = getResolvedAvatarFromEntity(providerFromMessages);

        console.log("[booking-chat-avatar-debug] provider avatar in messages payload", {
          booking_id: bookingId,
          has_provider: Boolean(providerFromMessages),
          has_avatar: Boolean(providerAvatarFromMessages),
        });

        if (!providerAvatarFromMessages) {
          try {
            const providersRes = await apiClient.get(`/providers`);
            const providers = Array.isArray(providersRes?.data)
              ? providersRes.data
              : providersRes?.data?.providers || [];

            const normalizeId = (value) => (value == null ? null : String(value).trim());
            const normalizeText = (value) =>
              value == null ? null : String(value).trim().toLowerCase();

            const candidateIds = [
              booking?.provider?.id,
              booking?.provider_id,
              booking?.provider?.provider_id,
              booking?.provider?.user_id,
              booking?.provider?.user?.id,
              res?.data?.provider?.id,
              res?.data?.provider?.provider_id,
              res?.data?.provider?.user_id,
              res?.data?.provider?.user?.id,
            ]
              .map(normalizeId)
              .filter(Boolean);

            const candidateUsernames = [
              booking?.provider?.username,
              booking?.provider_username,
              booking?.provider?.user?.username,
              res?.data?.provider?.username,
              res?.data?.provider?.user?.username,
            ]
              .map(normalizeText)
              .filter(Boolean);

            const candidateNames = [
              booking?.provider?.name,
              booking?.provider_name,
              res?.data?.provider?.name,
            ]
              .map(normalizeText)
              .filter(Boolean);

            console.log("[booking-chat-avatar-debug] provider fallback candidate summary", {
              booking_id: bookingId,
              provider_from_messages: res?.data?.provider || null,
              candidate_ids_count: candidateIds.length,
              candidate_usernames_count: candidateUsernames.length,
              candidate_names_count: candidateNames.length,
            });

            const matchedProvider = providers.find((provider) => {
              const providerIds = [
                provider?.id,
                provider?.provider_id,
                provider?.user_id,
                provider?.user?.id,
              ]
                .map(normalizeId)
                .filter(Boolean);

              const providerUsernames = [provider?.username, provider?.user?.username]
                .map(normalizeText)
                .filter(Boolean);

              const providerName = normalizeText(provider?.name);

              return (
                providerIds.some((id) => candidateIds.includes(id)) ||
                providerUsernames.some((username) => candidateUsernames.includes(username)) ||
                (providerName && candidateNames.includes(providerName))
              );
            });

            const fallbackAvatar = getResolvedAvatarFromEntity(matchedProvider);
            if (fallbackAvatar) {
              providerFromMessages = {
                ...(matchedProvider || {}),
                ...(providerFromMessages || {}),
                avatar_url: fallbackAvatar,
                profile_photo_url: fallbackAvatar,
              };
            }

            console.log("[booking-chat-avatar-debug] provider fallback lookup result", {
              booking_id: bookingId,
              candidates_count:
                candidateIds.length + candidateUsernames.length + candidateNames.length,
              matched: Boolean(matchedProvider),
              has_fallback_avatar: Boolean(fallbackAvatar),
            });
          } catch (fallbackErr) {
            console.log(
              "[booking-chat-avatar-debug] provider fallback lookup failed",
              fallbackErr?.message || fallbackErr
            );
          }
        }

        const rows = Array.isArray(res?.data?.messages) ? res.data.messages : [];
        setChatUsers({
          provider: providerFromMessages,
          client: res?.data?.client || null,
        });
        const imageRows = rows.filter(
          (row) => row?.attachment?.attachment_type === "image" || Boolean(row?.attachment?.file_url)
        );

        if (imageRows.length) {
          console.log("[chat-image-debug] GET /bookings/{booking_id}/messages image-only response", {
            booking_id: bookingId,
            status: res?.status,
            image_message_count: imageRows.length,
            image_messages: imageRows.map((row) => {
              const attachment = row?.attachment || null;
              const resolvedImageUrl = resolveImageUrl(attachment?.file_url);
              return {
                id: row?.id,
                text: row?.text,
                attachment,
                renderer_inputs: {
                  attachment_file_url: attachment?.file_url ?? null,
                  resolved_image_url: resolvedImageUrl,
                  will_render_image: Boolean(resolvedImageUrl),
                },
              };
            }),
          });
        }

        setMessages(rows);

        await apiClient.post(`/bookings/messages/read`, { booking_id: bookingId });
      } catch (err) {
        const msg = getCleanApiErrorMessage(err, "Could not load chat messages.");
        showFlash && showFlash("error", msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [bookingId, showFlash, booking, getResolvedAvatarFromEntity]
  );

  useEffect(() => {
    if (visible) return;
    setChatUsers({ provider: null, client: null });
  }, [visible, bookingId]);

  useEffect(() => {
    if (!visible || !bookingId) return;
    loadMessages();
    const interval = setInterval(() => {
      loadMessages(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [visible, bookingId, loadMessages]);

  useEffect(() => {
    if (!visible || !messages.length) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd?.({ animated: true });
    });
  }, [messages, visible]);

  const handlePickImage = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showFlash && showFlash("error", "Allow photo library access to attach images.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
        selectionLimit: 1,
      });

      if (result.canceled) return;
      const asset = result?.assets?.[0];
      console.log("[chat-image-debug] selected image asset", asset || null);
      if (!asset?.uri || (asset?.type && asset.type !== "image")) {
        showFlash && showFlash("error", "Please select a valid image from your library.");
        return;
      }

      setSelectedImage(asset);
    } catch (err) {
      showFlash && showFlash("error", "Could not open photo library.");
    }
  }, [showFlash]);

  const uploadChatImageToCloudinary = useCallback(async (asset) => {
    const filename = asset.fileName || asset.uri.split("/").pop() || "chat-image.jpg";
    const ext = (filename.split(".").pop() || "jpg").toLowerCase();
    const mimeType =
      asset.mimeType ||
      (ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg");

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      throw new Error("Chat image upload is not configured.");
    }

    const formData = new FormData();
    const normalizedFile = {
      uri: asset.uri,
      name: filename,
      type: mimeType,
    };
    console.log("[chat-image-debug] normalized upload file object", normalizedFile);
    formData.append("file", normalizedFile);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", CLOUDINARY_BOOKING_MESSAGES_FOLDER);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.secure_url) {
      throw new Error(uploadData?.error?.message || "Image upload failed.");
    }

    return {
      attachment_type: "image",
      file_url: uploadData.secure_url,
      mime_type: uploadData.resource_type === "image" ? mimeType : null,
      file_size_bytes: Number.isFinite(uploadData.bytes)
        ? uploadData.bytes
        : null,
      width: Number.isFinite(uploadData.width) ? uploadData.width : null,
      height: Number.isFinite(uploadData.height) ? uploadData.height : null,
      original_filename: uploadData.original_filename || filename,
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (sending) return;

    const trimmedText = text.trim();
    if (!trimmedText && !selectedImage) {
      showFlash && showFlash("error", "Message must include text or an image.");
      return;
    }

    if (isChatReadOnly) {
      showFlash && showFlash("error", chatReadOnlyReason);
      return;
    }

    try {
      setSending(true);
      let attachmentPayload = null;

      if (selectedImage?.uri) {
        console.log("[chat-image-send] selected image", { uri: selectedImage.uri });
        console.log("[chat-image-send] upload start", { booking_id: bookingId });
        attachmentPayload = await uploadChatImageToCloudinary(selectedImage);
        console.log("[chat-image-send] upload success", {
          file_url: attachmentPayload?.file_url,
          width: attachmentPayload?.width,
          height: attachmentPayload?.height,
        });
      }

      const payload = {
        booking_id: bookingId,
        text: trimmedText || null,
        attachment: attachmentPayload,
      };
      const isImageMessage = Boolean(payload?.attachment?.attachment_type === "image");
      if (isImageMessage) {
        console.log("[chat-image-debug] final outgoing /bookings/messages payload", payload);
      }
      console.log("[chat-image-send] send route", { method: "POST", route: "/bookings/messages" });

      const postRes = await apiClient.post(`/bookings/messages`, payload);

      if (isImageMessage) {
        console.log("[chat-image-debug] /bookings/messages response", {
          status: postRes?.status,
          data: postRes?.data,
        });

        const outgoingAttachmentKeys = Object.keys(payload?.attachment || {}).sort();
        const responseAttachment = postRes?.data?.message?.attachment || postRes?.data?.attachment || null;
        const responseAttachmentKeys = Object.keys(responseAttachment || {}).sort();
        const onlyInOutgoing = outgoingAttachmentKeys.filter((key) => !responseAttachmentKeys.includes(key));
        const onlyInResponse = responseAttachmentKeys.filter((key) => !outgoingAttachmentKeys.includes(key));
        logImageMessageShapeSummary("post-send", {
          outgoing_attachment_keys: outgoingAttachmentKeys,
          response_attachment_keys: responseAttachmentKeys,
          only_in_outgoing_attachment: onlyInOutgoing,
          only_in_response_attachment: onlyInResponse,
        });
      }

      console.log("[chat-image-send] send success", { booking_id: bookingId });
      setText("");
      setSelectedImage(null);
      await loadMessages(true);
    } catch (err) {
      console.log("[chat-image-send] send failure", err?.response?.data || err?.message || err);
      const msg = getCleanApiErrorMessage(err, "Could not send message.");
      showFlash && showFlash("error", msg);
    } finally {
      setSending(false);
    }
  }, [
    bookingId,
    chatReadOnlyReason,
    isChatReadOnly,
    loadMessages,
    selectedImage,
    sending,
    showFlash,
    text,
    uploadChatImageToCloudinary,
  ]);

  const renderItem = ({ item }) => {
    const mine = Number(item?.sender_user_id) === Number(currentUserId);
    const imageUrl = resolveImageUrl(item?.attachment?.file_url);
    if (item?.attachment?.attachment_type === "image" || item?.attachment?.file_url) {
      console.log("[chat-image-debug] renderer image decision fields", {
        id: item?.id,
        attachment_type: item?.attachment?.attachment_type ?? null,
        attachment_file_url: item?.attachment?.file_url ?? null,
        resolved_image_url: imageUrl,
        will_render_image: Boolean(imageUrl),
      });
    }
    const createdAt = item?.created_at ? new Date(item.created_at) : null;
    const timeText = createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";

    return (
      <View style={[styles.chatRow, mine ? styles.chatRowMine : styles.chatRowOther]}>
        <View style={[styles.chatBubble, mine ? styles.chatBubbleMine : styles.chatBubbleOther]}>
          {item?.text ? <Text style={styles.chatText}>{item.text}</Text> : null}
          {imageUrl ? (
            <TouchableOpacity onPress={() => setViewerImage(imageUrl)} activeOpacity={0.85}>
              <Image source={{ uri: imageUrl }} style={styles.chatImage} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
          {timeText ? <Text style={styles.chatTime}>{timeText}</Text> : null}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.chatSafeArea} edges={["left", "right", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.chatKeyboardWrapper}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.chatHeader, { paddingTop: Math.max(insets.top, 8) }]}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.chatCloseText}>Close</Text>
            </TouchableOpacity>
            <View style={styles.chatHeaderParticipant}>
              {headerParticipant?.avatar_url ? (
                <Image
                  source={{ uri: headerParticipant.avatar_url }}
                  style={styles.chatHeaderAvatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.chatHeaderAvatarFallback}>
                  <Text style={styles.chatHeaderAvatarInitial}>
                    {(headerParticipant?.username || "Chat").charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.chatHeaderTitle} numberOfLines={1} ellipsizeMode="tail">
                {headerParticipant?.username || "Chat"}
              </Text>
            </View>
            <View style={{ width: 46 }} />
          </View>

          {isChatReadOnly ? (
            <View style={styles.chatCancelledBanner}>
              <Text style={styles.chatCancelledText}>
                {chatReadOnlyReason}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading messages…</Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => `${item.id}`}
              renderItem={renderItem}
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              onRefresh={() => loadMessages(true)}
              refreshing={refreshing}
              ListEmptyComponent={
                <Text style={styles.serviceMeta}>Send a message about this booking</Text>
              }
            />
          )}

          <View
            style={[
              styles.chatComposer,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            {selectedImage?.uri ? (
              <View style={styles.chatSelectedImageWrap}>
                <Image source={{ uri: selectedImage.uri }} style={styles.chatSelectedImage} />
                <TouchableOpacity onPress={() => setSelectedImage(null)}>
                  <Text style={styles.chatRemoveImageText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.chatComposerRow}>
              <TouchableOpacity
                style={styles.chatAttachButton}
                onPress={handlePickImage}
                disabled={sending || isChatReadOnly}
              >
                <Ionicons name="image-outline" size={20} color={colors.textPrimary} />
              </TouchableOpacity>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Type a message"
                placeholderTextColor={colors.textMuted}
                style={styles.chatInput}
                editable={!sending && !isChatReadOnly}
              />

              <TouchableOpacity
                style={[
                  styles.chatSendButton,
                  (sending || isChatReadOnly || (!text.trim() && !selectedImage)) && styles.chatSendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={sending || isChatReadOnly || (!text.trim() && !selectedImage)}
              >
                <Text style={styles.chatSendButtonText}>{sending ? "..." : "Send"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={!!viewerImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewerImage(null)}
      >
        <Pressable style={styles.chatViewerBackdrop} onPress={() => setViewerImage(null)}>
          {viewerImage ? (
            <Image source={{ uri: viewerImage }} style={styles.chatViewerImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </Modal>
  );
}

function AppointmentsScreen({ token, showFlash, pendingChatConversationId, clearPendingChatConversationId }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [chatBooking, setChatBooking] = useState(null);
  const [ratingBooking, setRatingBooking] = useState(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Booking datetimes are stored/served as Guyana-local wall time (UTC-4, no DST).
  // Parse naive strings explicitly as Guyana so device timezone does not affect logic.
  const GUYANA_UTC_OFFSET_HOURS = 4;
  const parseGuyanaDateMs = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isNaN(t) ? null : t;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    // Respect explicit timezone payloads (Z / +/-HH:MM) as absolute instants.
    if (/z$|[+-]\d{2}:?\d{2}$/i.test(raw)) {
      const ts = Date.parse(raw);
      return Number.isNaN(ts) ? null : ts;
    }

    // Treat naive payload as Guyana local time.
    const m = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?)?$/
    );
    if (!m) {
      const ts = Date.parse(raw);
      return Number.isNaN(ts) ? null : ts;
    }

    const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0"] = m;
    const msNorm = ms.padEnd(3, "0").slice(0, 3);
    return Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h) + GUYANA_UTC_OFFSET_HOURS,
      Number(mi),
      Number(s),
      Number(msNorm)
    );
  };

  const getNowGuyanaMs = () => Date.now();

  const normalizeStart = (booking) => {
    const iso = booking?.start_time || booking?.start;
    const ts = parseGuyanaDateMs(iso);
    return ts == null ? null : new Date(ts);
  };

  const normalizeStatus = (statusValue) =>
    String(statusValue || "").trim().toLowerCase();

  const isCancelledBooking = (booking) => {
    const status = normalizeStatus(booking?.status || booking?.state);
    return status.includes("cancel");
  };

  const isCompletedBooking = (booking) => {
    const status = normalizeStatus(booking?.status || booking?.state);
    return status.includes("complete");
  };

  const bookingHasEnded = (booking, nowTs) => {
    const endIso = booking?.end_time || booking?.end;
    const endTs = parseGuyanaDateMs(endIso);
    if (endTs != null) {
      return endTs <= nowTs;
    }

    const startDate = normalizeStart(booking);
    if (!startDate) return false;
    return startDate.getTime() <= nowTs;
  };

  const isInProgressBooking = (booking, nowTs) => {
    if (isCancelledBooking(booking) || isCompletedBooking(booking)) return false;
    const startIso = booking?.start_time || booking?.start;
    const endIso = booking?.end_time || booking?.end;
    const startTs = parseGuyanaDateMs(startIso);
    const endTs = parseGuyanaDateMs(endIso);
    if (startTs == null) return false;
    if (endTs != null) {
      return nowTs >= startTs && nowTs < endTs;
    }
    return nowTs >= startTs && !bookingHasEnded(booking, nowTs);
  };

  const isUpcomingBooking = (booking, nowTs) => {
    const startDate = booking?._start || normalizeStart(booking);
    if (!startDate) return false;
    if (isCancelledBooking(booking) || isCompletedBooking(booking)) return false;
    return nowTs < startDate.getTime();
  };

  const formatBookingDate = (iso) => {
    const ts = parseGuyanaDateMs(iso);
    const d = ts == null ? null : new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/Guyana",
    });
  };

  const formatBookingTime = (iso) => {
    const ts = parseGuyanaDateMs(iso);
    const d = ts == null ? null : new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Guyana",
    });
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

        const res = await apiClient.get(`/bookings/me`);

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

              await apiClient.post(
                `/bookings/${bookingId}/cancel`,
                {}
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


  useEffect(() => {
    if (!pendingChatConversationId || !bookings?.length) return;
    const match = bookings.find((b) => Number(b?.conversation_id) === Number(pendingChatConversationId));
    if (match) {
      setChatBooking(match);
      clearPendingChatConversationId?.();
    }
  }, [bookings, clearPendingChatConversationId, pendingChatConversationId]);
  const datedBookings = bookings.map((b) => ({
    ...b,
    _start: normalizeStart(b),
  }));

  const nowTs = getNowGuyanaMs();
  const upcomingBookings = datedBookings
    .filter((b) => isUpcomingBooking(b, nowTs))
    .sort((a, b) => a._start - b._start);

  const inProgressBookings = datedBookings
    .filter((b) => isInProgressBooking(b, nowTs))
    .sort((a, b) => a._start - b._start);

  const finishedBookings = datedBookings
    .filter((b) => !isUpcomingBooking(b, nowTs) && !isInProgressBooking(b, nowTs))
    .sort((a, b) => {
      const aTime = a?._start?.getTime?.() ?? 0;
      const bTime = b?._start?.getTime?.() ?? 0;
      return bTime - aTime;
    });

  const deriveStatus = (booking) => {
    const startIso = booking.start_time || booking.start;
    const endIso = booking.end_time || booking.end;
    const normalizedStart = parseGuyanaDateMs(startIso);
    const normalizedEnd = parseGuyanaDateMs(endIso);
    const nowTs = getNowGuyanaMs();

    if (isCancelledBooking(booking)) return "cancelled";
    if (isCompletedBooking(booking) || booking?.completed_at || booking?.is_completed) {
      return "completed";
    }

    if (normalizedEnd != null) {
      if (nowTs >= normalizedEnd) return "completed";
      if (normalizedStart != null && nowTs >= normalizedStart) return "in progress";
    }

    return booking.status || booking.state || "pending";
  };

  const renderBooking = (booking, isUpcoming = false) => {
    const startIso = booking.start_time || booking.start;
    const endIso = booking.end_time || booking.end;
    const dateLabel = formatBookingDate(startIso);
    const timeLabel = formatBookingTime(startIso);
    const endDateLabel = formatBookingDate(endIso);
    const endTimeLabel = formatBookingTime(endIso);
    const durationMinutes = Number(
      booking?.service_duration_minutes ??
        booking?.duration_minutes ??
        booking?.duration ??
        0
    );
    const durationLabel = formatDuration(durationMinutes);
    const statusLabel = deriveStatus(booking);
    // status color mapping
    const statusThemeKey = getAppointmentStatusThemeKey(statusLabel);
    const statusTheme = APPOINTMENT_STATUS_THEME[statusThemeKey];
    const bookingId = booking.id || booking.booking_id;
    const bookingBelongsToClient =
      booking?.client_id == null || token?.userId == null
        ? true
        : Number(booking?.client_id) === Number(token?.userId);
    const canRateBooking =
      !isUpcoming &&
      statusThemeKey === "completed" &&
      bookingBelongsToClient &&
      booking?.can_rate === true &&
      booking?.has_rating !== true;
    const hasBookingRating =
      statusThemeKey === "completed" &&
      (booking?.has_rating === true || Number(booking?.rating_stars) > 0);
    const readOnlyStars = Number(booking?.rating_stars || booking?.stars || 0);

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
              Starts: {dateLabel} {timeLabel ? `· ${timeLabel}` : ""}
            </Text>
          )}
          {(endDateLabel || endTimeLabel) && (
            <Text style={styles.appointmentMeta}>
              Ends: {endDateLabel} {endTimeLabel ? `· ${endTimeLabel}` : ""}
            </Text>
          )}
          <Text style={styles.appointmentMeta}>Duration: {durationLabel}</Text>
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
            <TouchableOpacity
              style={styles.appointmentMessageButton}
              onPress={() => setChatBooking(booking)}
            >
              <Text style={styles.appointmentMessageButtonText}>Message</Text>
            </TouchableOpacity>
          </View>

          {canRateBooking && bookingId ? (
            <TouchableOpacity
              style={styles.rateProviderButton}
              onPress={() => {
                setRatingBooking(booking);
                setRatingStars(0);
              }}
            >
              <Text style={styles.rateProviderButtonText}>Rate Provider</Text>
            </TouchableOpacity>
          ) : null}

          {hasBookingRating && readOnlyStars > 0 ? (
            <Text style={styles.bookingRatingReadOnly}>
              Your rating: {"★".repeat(readOnlyStars)}
            </Text>
          ) : null}
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
  <>
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
            <Text style={styles.sectionTitle}>In Progress</Text>
            <Text style={styles.appointmentCount}>
              {inProgressBookings.length} booking
              {inProgressBookings.length === 1 ? "" : "s"}
            </Text>
          </View>

          {inProgressBookings.length === 0 ? (
            <Text style={styles.serviceMeta}>No appointments in progress.</Text>
          ) : (
            inProgressBookings.map((booking) => renderBooking(booking, false))
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

  <BookingChatModal
    visible={!!chatBooking}
    onClose={() => setChatBooking(null)}
    booking={chatBooking}
    currentUserId={token?.userId}
    currentUserIsProvider={Boolean(token?.isProvider ?? token?.is_provider)}
    showFlash={showFlash}
  />

  <Modal
    visible={!!ratingBooking}
    animationType="fade"
    transparent
    onRequestClose={() => {
      if (!ratingSubmitting) {
        setRatingBooking(null);
        setRatingStars(0);
      }
    }}
  >
    <View style={styles.modalOverlay}>
      <View style={styles.ratingModalCard}>
        <Text style={styles.sectionTitle}>Rate Provider</Text>
        <Text style={styles.serviceMeta}>
          {ratingBooking?.provider_name || "Your provider"}
        </Text>

        <View style={styles.ratingStarsRow}>
          {[1, 2, 3, 4, 5].map((star) => {
            const selected = ratingStars >= star;
            return (
              <TouchableOpacity
                key={star}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${star} star${star > 1 ? "s" : ""}`}
                style={styles.ratingStarButton}
                disabled={ratingSubmitting}
                onPress={() => setRatingStars(star)}
              >
                <Text style={[styles.ratingStarText, selected && styles.ratingStarTextSelected]}>
                  ★
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.modalActions}>
          <TouchableOpacity
            style={styles.modalButton}
            disabled={ratingSubmitting}
            onPress={() => {
              setRatingBooking(null);
              setRatingStars(0);
            }}
          >
            <Text style={styles.modalButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chatSendButton,
              styles.ratingSubmitButton,
              (ratingSubmitting || ratingStars < 1) && styles.chatSendButtonDisabled,
            ]}
            disabled={ratingSubmitting || ratingStars < 1}
            onPress={async () => {
              const bookingId = ratingBooking?.id || ratingBooking?.booking_id;
              if (!bookingId || ratingStars < 1 || ratingSubmitting) return;

              try {
                setRatingSubmitting(true);
                await submitBookingRating(bookingId, ratingStars);

                setBookings((prev) =>
                  (prev || []).map((entry) => {
                    const entryId = entry?.id || entry?.booking_id;
                    if (String(entryId) !== String(bookingId)) return entry;
                    return {
                      ...entry,
                      can_rate: false,
                      has_rating: true,
                      rating_stars: ratingStars,
                    };
                  })
                );

                if (showFlash) showFlash("success", "Thanks for rating your provider.");
                setRatingBooking(null);
                setRatingStars(0);
              } catch (err) {
                const statusCode = err?.response?.status;
                const detail =
                  err?.response?.data?.detail ||
                  err?.response?.data?.message ||
                  "Could not submit your rating.";

                if (statusCode === 409 || String(detail).toLowerCase().includes("already")) {
                  if (showFlash) showFlash("error", "This booking has already been rated.");
                } else if (statusCode === 403 || statusCode === 401) {
                  if (showFlash) showFlash("error", "You are not allowed to rate this booking.");
                } else if (statusCode === 422) {
                  if (showFlash) showFlash("error", "Please select a rating from 1 to 5 stars.");
                } else if (String(detail).toLowerCase().includes("complete")) {
                  if (showFlash) showFlash("error", "You can only rate completed bookings.");
                } else if (showFlash) {
                  showFlash("error", detail);
                }
              } finally {
                setRatingSubmitting(false);
              }
            }}
          >
            <Text style={styles.chatSendButtonText}>
              {ratingSubmitting ? "Submitting..." : "Submit"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
  </>
);
}

    




function SearchScreen({ token, showFlash, navigation, route, toggleFavorite, isFavorite, syncFavoritesFromList}) {
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
  const [selectedProviderId, setSelectedProviderId] = useState(null);
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
  const searchInputRef = useRef(null);
  const resultsOffset = useRef(0);
  const servicesOffset = useRef(0);
  const initializedNavProviderKeyRef = useRef(null);
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

      const res = await apiClient.get(`/providers`);

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
    setSelectedProviderId(null);
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
    const initKey = incomingId || providerFromNav?.username || providerFromNav?.name;
    if (!initKey || initializedNavProviderKeyRef.current === initKey) return;

    // Single source of truth: only initialize from route params once,
    // then rely on selectedProviderId + handleSelectProvider for all updates.
    initializedNavProviderKeyRef.current = initKey;

    setSearchQuery(providerFromNav.name || "");
    setHasSearched(true);
    setFilteredProviders([providerFromNav]);
    handleSelectProvider(providerFromNav);
  }, [route?.params?.provider, handleSelectProvider]);

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
  }, [providers, searchQuery, radiusKm, clientLocation, hasSearched, incomingUsername, clearSelectedProvider]);



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

  const handleServicesLayout = (event) => {
    servicesOffset.current = event.nativeEvent.layout.y;
  };


  const loadAvailability = useCallback(
    async (providerId, serviceId) => {
      try {
        setAvailabilityLoading(true);
        setAvailabilityError("");

        const res = await apiClient.get(
          `/providers/${providerId}/availability`,
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

      const res = await apiClient.get(`/providers/${providerId}/catalog`);

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
    const providerId = getProviderId(provider);
    setSelectedProvider(provider);
    setSelectedProviderId(providerId || null);
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

    if (scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: servicesOffset.current || resultsOffset.current,
          animated: true,
        });
      });
    }

    try {
      setServicesLoading(true);

      const res = await apiClient.get(
        `/providers/${providerId}/services`
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

      if (!selectedProviderId) return;

      await loadAvailability(selectedProviderId, service.id);
    },
    [loadAvailability, selectedProviderId]
  );

  const isProviderSelected = Boolean(selectedProviderId && selectedProvider);
  const displayProviders = isProviderSelected && selectedProvider
    ? [selectedProvider]
    : filteredProviders;

  const clientCoords = getClientCoords();
  let searchHasDistance = false;
  let searchLastProviderCoords = null;
  let searchLastDistanceKm = null;
  const searchCards = displayProviders.map((p) => {
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
        isSelected={selectedProviderId && selectedProviderId === getProviderId(p)}
        style={styles.providerCardList}
      />
    );
  });

  if (!searchHasDistance && displayProviders.length) {
    console.log("[distance] search list missing distances", {
      clientCoords,
      providerCoords: searchLastProviderCoords,
      distanceKm: searchLastDistanceKm,
    });
  }

  const handleChangeProvider = useCallback(() => {
    clearSelectedProvider();
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [clearSelectedProvider]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const list = await loadProviders();

    if (selectedProviderId) {
      const match = (list || []).find(
        (p) => getProviderId(p) === selectedProviderId
      );

      if (match) {
        await handleSelectProvider(match);
      } else {
        setSelectedProvider(null);
        setSelectedProviderId(null);
        setServices([]);
        setAvailability([]);
        setCatalogImages([]);
      }
    }

    setRefreshing(false);
  }, [handleSelectProvider, loadProviders, selectedProviderId]);

  const handleBookAppointment = async () => {
    if (!selectedService || !selectedSlot || !selectedProviderId) return;

    const providerId = selectedProviderId;
    if (!providerId) return;

    try {
      setBookingLoading(true);


      await apiClient.post("/bookings", {
        service_id: selectedService.id,
        start_time: selectedSlot,
      });


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
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search by profession or provider…"
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={(value) => {
                if (isProviderSelected) {
                  clearSelectedProvider();
                }
                if (!normalizeSearchValue(value)) {
                  setSearchQuery(value);
                  setHasSearched(false);
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
                  {displayProviders.length} provider{displayProviders.length === 1 ? "" : "s"}
                </Text>
              ) : null}
            </View>

            {isProviderSelected && (
              <View style={styles.selectedProviderActions}>
                <TouchableOpacity onPress={handleChangeProvider}>
                  <Text style={styles.changeProviderText}>Change provider</Text>
                </TouchableOpacity>
              </View>
            )}

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
              displayProviders.length === 0 && (
                <Text style={styles.emptyStateText}>
                  {incomingUsername
                    ? "We couldn't find that provider. Please check the username."
                    : "No providers found. Try adjusting your search or distance filter."}
                </Text>
              )}

            {!providersLoading &&
              !providersError &&
              hasSearched &&
              displayProviders.length > 0 &&
              searchCards}
          </View>

                        {/* Services list for selected provider */}
                      {selectedProvider && (
                        <View style={styles.card} onLayout={handleServicesLayout}>
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
                                {formatDuration(getServiceDurationMinutes(s))}
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
                    <Text style={styles.serviceMeta}>
                      Estimated duration: {formatDuration(getServiceDurationMinutes(selectedService))}
                    </Text>

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
                        {(availabilityMap[selectedDate] || []).map((slotIso) => {
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






function ProviderDashboardScreen({
  navigation,
  token,
  showFlash,
  unreadNotificationCount = 0,
  onPressNotifications,
  pendingChatConversationId,
  clearPendingChatConversationId,
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const providerDashboardLogoSize = Math.max(
    100,
    Math.min(120, Math.round(windowWidth * 0.3))
  );

  // const providerLabel = profile?.full_name || "Provider";
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDurationDays, setNewDurationDays] = useState("");
  const [newDurationHours, setNewDurationHours] = useState("");
  const [newDurationMinutes, setNewDurationMinutes] = useState("");
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
  const [chatBooking, setChatBooking] = useState(null);
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
const providerRatingSummary = getRatingSummary(
  {
    ...(providerSummary || {}),
    ...(provider || {}),
    ...(profile || {}),
  },
  "No ratings"
);

useLayoutEffect(() => {
  navigation.setOptions({
    headerTitle: "",
    headerRight: () => (
      <NotificationBell
        unreadCount={unreadNotificationCount}
        onPress={onPressNotifications || (() => navigation.navigate('Notifications'))}
      />
    ),
  });
}, [navigation, onPressNotifications, unreadNotificationCount]);

const parseServiceNumber = useCallback((value) => {
  const normalized = String(value || "").replace(/[,\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}, []);

const validateServiceFields = useCallback((name, price, durationParts) => {
  const errors = { name: "", price: "", duration: "" };
  const trimmedName = String(name || "").trim();
  const priceNumber = parseServiceNumber(price);
  const durationError = validateDurationParts(durationParts);

  if (!trimmedName) {
    errors.name = "Service name is required.";
  }

  if (!priceNumber || priceNumber <= 0) {
    errors.price = "Enter a price greater than 0.";
  }

  if (durationError) {
    errors.duration = durationError;
  }

  return errors;
}, [parseServiceNumber]);

const serviceErrors = useMemo(
  () =>
    validateServiceFields(newName, newPrice, {
      days: parseServiceNumber(newDurationDays) || 0,
      hours: parseServiceNumber(newDurationHours) || 0,
      minutes: parseServiceNumber(newDurationMinutes) || 0,
    }),
  [
    newName,
    newPrice,
    newDurationDays,
    newDurationHours,
    newDurationMinutes,
    validateServiceFields,
    parseServiceNumber,
  ]
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
    // Re-fetch provider dashboard data when screen regains focus
    loadTodayBookings();
    loadUpcomingBookings();
    loadProviderSummary();
    loadBookings();
    loadProviderProfile();

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
    setNewDurationDays("");
    setNewDurationHours("");
    setNewDurationMinutes("");
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

      const res = await apiClient.get(`/providers/me/bookings`);

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

    const res = await apiClient.get(`/providers/me/working-hours`);

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



const loadTodayBookings = useCallback(async () => {
  try {
    const authToken = await getAuthToken(token);
    if (!authToken) return;

    const res = await apiClient.get(`/providers/me/bookings/today`);
    setTodayBookings(res.data || []);
    setTodayError("");
  } catch (err) {
    setTodayError(err.response?.data?.detail || "Could not load today's bookings.");
  }
}, [token]);



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

            await apiClient.post(
              `/providers/me/bookings/${bookingId}/cancel`,
              {}
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

      const res = await apiClient.get(`/providers/me/services`);

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

    
    await apiClient.put(`/providers/me/working-hours`, payload);


    // if (showFlash) showFlash("success", "Working hours saved");
    setHoursFlash({ type: "success", message: "Working hours saved" });
    setTimeout(() => setHoursFlash(null), 4000);
    setShowHours(false);
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

  const durationParts = {
    days: parseServiceNumber(newDurationDays) || 0,
    hours: parseServiceNumber(newDurationHours) || 0,
    minutes: parseServiceNumber(newDurationMinutes) || 0,
  };
  const currentErrors = validateServiceFields(newName, newPrice, durationParts);
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
  const durationNumber = durationPartsToMinutes(durationParts);

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
      duration_days: durationParts.days,
      duration_hours: durationParts.hours,
      duration_minutes_part: durationParts.minutes,
      price_gyd: priceNumber,
    };

    // ✅ Create service on backend and get the created record back
    const res = await apiClient.post(
      `/providers/me/services`,
      payload
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

      const res = await apiClient.delete(`/providers/me/services/${serviceId}`);

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
        avg_rating: res.data.avg_rating,
        rating_count: Number(res.data.rating_count || 0),
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

    const res = await apiClient.get(`/providers/me/catalog`);

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

    const res = await apiClient.post(`/providers/me/catalog`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
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

            await apiClient.delete(`/providers/me/catalog/${imageId}`);

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
    const res = await apiClient.put(
      `/providers/me/profile`,
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
    setShowProfileEditor(false);
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
      console.log("[profile] refresh data", meRes?.data);

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
    const res = await apiClient.get(
      `/providers/me/bookings/upcoming`
    );
    setUpcomingBookings(res.data || []);
  } catch (error) {
    setUpcomingError(true);
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
    await apiClient.put(
      `/users/me`,
      { lat: coords.lat, long: coords.long }
    );

    // 2) ALSO update the provider record so searches & client view use it
    await apiClient.put(
      `/providers/me/location`,
      { lat: coords.lat, long: coords.long }
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

    const res = await apiClient.get(`/providers/me/summary`);
    setProviderSummary(res.data);
  } catch (err) {
    console.log(
      "Error loading provider summary",
      err.response?.data || err.message
    );
  }
};

  useEffect(() => {
    if (!pendingChatConversationId || !bookings?.length) return;
    const match = bookings.find((b) => Number(b?.conversation_id) === Number(pendingChatConversationId));
    if (match) {
      setChatBooking(match);
      clearPendingChatConversationId?.();
    }
  }, [bookings, clearPendingChatConversationId, pendingChatConversationId]);

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

      <View style={styles.providerDashboardPinnedHeader}>
          <View
            style={[
              styles.providerDashboardLogoWrap,
              { top: -86,},
            ]}
          >
          <Image
            source={BookitGYLogoTransparent}
            style={{
              width: providerDashboardLogoSize,
              height: providerDashboardLogoSize,
            }}
            resizeMode="contain"
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.providerScroll,
          {
            paddingTop: insets.top + providerDashboardLogoSize -30,
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.providerDashboardIntro}>
          <Text style={styles.homeGreeting}>Provider dashboard</Text>
          <Text style={styles.homeSubtitle}>Welcome, {providerLabel}</Text>
          <Text style={styles.providerDashboardRatingText}>
            {providerRatingSummary.hasRatings
              ? `★ ${providerRatingSummary.ratingValue.toFixed(1)}${providerRatingSummary.ratingCount > 0 ? ` (${providerRatingSummary.ratingCount} rating${providerRatingSummary.ratingCount === 1 ? "" : "s"})` : ""}`
              : "No ratings"}
          </Text>
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
                const appointmentSpan = formatProviderAppointmentSpan(start, end);

                return (
                  <View key={b.id} style={styles.bookingRow}>
                    <View style={styles.bookingMain}>
                      {appointmentSpan.isSameDay ? (
                        <Text style={styles.bookingTime}>{appointmentSpan.compactLabel}</Text>
                      ) : (
                        <>
                          <Text style={styles.bookingTime}>{appointmentSpan.startLabel}</Text>
                          <Text style={styles.bookingTime}>{appointmentSpan.endLabel}</Text>
                        </>
                      )}
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
                      <TouchableOpacity
                        style={styles.bookingMessageButton}
                        onPress={() => setChatBooking(b)}
                      >
                        <Text style={styles.bookingEdit}>Message</Text>
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
                  const appointmentSpan = formatProviderAppointmentSpan(start, end);

                  return (
                    <View key={b.id} style={styles.bookingRow}>
                      <View style={styles.bookingMain}>
                        {appointmentSpan.isSameDay ? (
                          <Text style={styles.bookingTime}>{appointmentSpan.compactLabel}</Text>
                        ) : (
                          <>
                            <Text style={styles.bookingTime}>{appointmentSpan.startLabel}</Text>
                            <Text style={styles.bookingTime}>{appointmentSpan.endLabel}</Text>
                          </>
                        )}
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
                        <TouchableOpacity
                          style={styles.bookingMessageButton}
                          onPress={() => setChatBooking(b)}
                        >
                          <Text style={styles.bookingEdit}>Message</Text>
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
                placeholder="Duration days (if applicable)"
                placeholderTextColor={colors.textSecondary}
                value={newDurationDays}
                onChangeText={setNewDurationDays}
                keyboardType="numeric"
              />
              <TextInput
                style={[
                  styles.input,
                  serviceErrors.duration ? styles.inputError : null,
                ]}
                placeholder="Duration hours (if applicable)"
                placeholderTextColor={colors.textSecondary}
                value={newDurationHours}
                onChangeText={setNewDurationHours}
                keyboardType="numeric"
              />
              <TextInput
                style={[
                  styles.input,
                  serviceErrors.duration ? styles.inputError : null,
                ]}
                placeholder="Duration minutes"
                placeholderTextColor={colors.textSecondary}
                value={newDurationMinutes}
                onChangeText={setNewDurationMinutes}
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
                    {formatDuration(getServiceDurationMinutes(s))}
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

      <BookingChatModal
        visible={!!chatBooking}
        onClose={() => setChatBooking(null)}
        booking={chatBooking}
        currentUserId={token?.userId}
        currentUserIsProvider={Boolean(token?.isProvider ?? token?.is_provider)}
        showFlash={showFlash}
      />
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

      const billingEndpoint = `/providers/me/billing/cycles?limit=6`;

      const response = await apiClient.get(billingEndpoint);

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
  blockedTimesByDate,
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
          const dayBlockedTimes = blockedTimesByDate?.[day.key] || [];
          const activeBookings = bookings.filter(isBookingVisible);
          const hasBookings = activeBookings.length > 0;
          const hasBlocks = dayBlockedTimes.length > 0;
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
              {hasBookings || hasBlocks ? (
                <View
                  style={[
                    styles.providerWeeklyDot,
                    {
                      backgroundColor: hasBlocks
                        ? colors.error
                        : allCompleted
                          ? colors.textMuted
                          : colors.primary,
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
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [blockType, setBlockType] = useState("one_time");
  const [blockDate, setBlockDate] = useState(() => normalizeDateKey(new Date()) || "");
  const [blockStartTime, setBlockStartTime] = useState("09:00");
  const [blockDurationHours, setBlockDurationHours] = useState("1");
  const [blockDurationMinutes, setBlockDurationMinutes] = useState("0");
  const [blockReason, setBlockReason] = useState("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [deletingBlockedId, setDeletingBlockedId] = useState(null);
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

  const parseTimeInput = useCallback((value) => {
    const raw = String(value || "").trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }, []);

  const getBlockedTimeId = useCallback((blockedTime) => String(blockedTime?.id || blockedTime?.blocked_time_id || ""), []);

  const normalizeBlockedErrorMessage = useCallback((err, fallback) => {
    const detail = String(err?.response?.data?.detail || err?.response?.data?.message || "").trim();
    const lower = detail.toLowerCase();
    if (!detail) return fallback;
    if (detail === "You already have appointments on this day. Please cancel those appointments before blocking the entire day.") {
      return detail;
    }
    if (lower.includes("already have appointments") && lower.includes("blocking the entire day")) {
      return "You already have appointments on this day. Please cancel those appointments before blocking the entire day.";
    }
    if (lower.includes("overlaps") && lower.includes("appointment")) {
      return "This blocked time overlaps an existing appointment.";
    }
    if (lower.includes("overlaps") && lower.includes("blocked")) {
      return "This blocked time overlaps another blocked time.";
    }
    return detail || fallback;
  }, []);

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

      const [bookingsRes, blockedTimesRes] = await Promise.all([
        apiClient.get(`/providers/me/bookings`, {
          params: {
            start: dateRange.start,
            end: dateRange.end,
          },
        }),
        apiClient.get(`/providers/me/blocked-times`, {
          params: {
            start_date: dateRange.start,
            end_date: dateRange.end,
          },
        }),
      ]);

      const rows = Array.isArray(bookingsRes.data)
        ? bookingsRes.data
        : bookingsRes.data?.bookings || bookingsRes.data?.results || [];

      const blockedRows = Array.isArray(blockedTimesRes.data)
        ? blockedTimesRes.data
        : blockedTimesRes.data?.blocked_times || blockedTimesRes.data?.results || [];

      setBookings(dedupeById(rows));
      setBlockedTimes(dedupeById(blockedRows));
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

  const resetBlockForm = useCallback((nextDate) => {
    setBlockType("one_time");
    setBlockDate(nextDate || selectedDate);
    setBlockStartTime("09:00");
    setBlockDurationHours("1");
    setBlockDurationMinutes("0");
    setBlockReason("");
  }, [selectedDate]);

  const openBlockModal = useCallback(() => {
    resetBlockForm(selectedDate);
    setBlockModalVisible(true);
  }, [resetBlockForm, selectedDate]);

  const handleSubmitBlockedTime = useCallback(async () => {
    const normalizedDate = normalizeDateKey(blockDate);
    if (!normalizedDate) {
      if (showFlash) showFlash("error", "Please select a valid date.");
      return;
    }

    const trimmedReason = String(blockReason || "").trim();

    if (blockType === "one_time") {
      const parsedTime = parseTimeInput(blockStartTime);
      if (!parsedTime) {
        if (showFlash) showFlash("error", "Please enter a valid start time (HH:MM).");
        return;
      }

      const hours = Number.parseInt(String(blockDurationHours || "0"), 10);
      const minutes = Number.parseInt(String(blockDurationMinutes || "0"), 10);
      const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
      const safeMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;

      if (safeHours === 0 && safeMinutes === 0) {
        if (showFlash) showFlash("error", "Duration must be greater than zero.");
        return;
      }

      setBlockSubmitting(true);
      try {
        await apiClient.post(`/providers/me/blocked-times`, {
          date: normalizedDate,
          start_time: `${String(parsedTime.hours).padStart(2, "0")}:${String(parsedTime.minutes).padStart(2, "0")}:00`,
          duration_hours: safeHours,
          duration_minutes: safeMinutes,
          reason: trimmedReason || null,
        });
        if (showFlash) showFlash("success", "Blocked time created.");
        setBlockModalVisible(false);
        await loadBookingsForRange();
      } catch (err) {
        const message = normalizeBlockedErrorMessage(err, "Could not create blocked time.");
        if (showFlash) showFlash("error", message);
      } finally {
        setBlockSubmitting(false);
      }
      return;
    }

    setBlockSubmitting(true);
    try {
      await apiClient.post(`/providers/me/blocked-times/all-day`, {
        date: normalizedDate,
        reason: trimmedReason || null,
      });
      if (showFlash) showFlash("success", "All-day block created.");
      setBlockModalVisible(false);
      await loadBookingsForRange();
    } catch (err) {
      const message = normalizeBlockedErrorMessage(err, "Could not create all-day block.");
      if (showFlash) showFlash("error", message);
    } finally {
      setBlockSubmitting(false);
    }
  }, [
    blockDate,
    blockDurationHours,
    blockDurationMinutes,
    blockReason,
    blockStartTime,
    blockType,
    loadBookingsForRange,
    normalizeBlockedErrorMessage,
    normalizeDateKey,
    parseTimeInput,
    showFlash,
  ]);

  const handleDeleteBlockedTime = useCallback((blockedTime) => {
    const blockedId = getBlockedTimeId(blockedTime);
    if (!blockedId || deletingBlockedId) return;

    const timeLabel = blockedTime?.is_all_day
      ? "All day"
      : formatTimeRange(new Date(blockedTime?.start_at), new Date(blockedTime?.end_at));

    Alert.alert(
      "Delete blocked time?",
      `Remove this block (${timeLabel})?`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingBlockedId(blockedId);
            try {
              await apiClient.delete(`/providers/me/blocked-times/${blockedId}`);
              if (showFlash) showFlash("success", "Blocked time deleted.");
              await loadBookingsForRange();
            } catch (err) {
              const message = normalizeBlockedErrorMessage(err, "Could not delete blocked time.");
              if (showFlash) showFlash("error", message);
            } finally {
              setDeletingBlockedId(null);
            }
          },
        },
      ]
    );
  }, [deletingBlockedId, formatTimeRange, getBlockedTimeId, loadBookingsForRange, normalizeBlockedErrorMessage, showFlash]);

  const cancelBookingById = useCallback(
    async (bookingId, authTokenOverride) => {
      const authToken = authTokenOverride || (await getAuthToken(token));
      if (!authToken) {
        const noAuthError = new Error("No access token found. Please log in again.");
        noAuthError.code = "NO_AUTH_TOKEN";
        throw noAuthError;
      }

      await apiClient.post(
        `/providers/me/bookings/${bookingId}/cancel`,
        {}
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

  const blockedTimesByDate = useMemo(() => {
    return blockedTimes.reduce((acc, blockedTime) => {
      const key = formatDayKey(blockedTime?.start_at);
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(blockedTime);
      return acc;
    }, {});
  }, [blockedTimes, formatDayKey]);

  const selectedBlockedTimes = useMemo(() => {
    const day = selectedDate;
    return blockedTimes.filter((blockedTime) => formatDayKey(blockedTime?.start_at) === day);
  }, [blockedTimes, formatDayKey, selectedDate]);

  const sortedSelectedBlockedTimes = useMemo(
    () =>
      selectedBlockedTimes
        .slice()
        .sort((a, b) => new Date(a?.start_at) - new Date(b?.start_at)),
    [selectedBlockedTimes]
  );

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

    Object.keys(blockedTimesByDate).forEach((day) => {
      const hasBlocks = (blockedTimesByDate[day] || []).length > 0;
      if (!hasBlocks) return;
      marked[day] = {
        ...(marked[day] || {}),
        marked: true,
        dotColor: colors.error,
      };
    });

    marked[selectedDate] = {
      ...(marked[selectedDate] || {}),
      selected: true,
      selectedColor: colors.primarySoft,
      selectedTextColor: colors.textPrimary,
    };

    return marked;
  }, [blockedTimesByDate, bookingsByDate, isActiveBooking, isBookingCompleted, selectedDate]);

  const timelineEvents = useMemo(
    () => [
      ...selectedBookings
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
            id: `booking-${String(booking?.id || booking?.booking_id || `${startIso}-${booking?.service_name || "service"}`)}`,
            eventType: "booking",
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
      ...sortedSelectedBlockedTimes
        .map((blockedTime) => {
          const startDate = new Date(blockedTime?.start_at);
          const endDate = new Date(blockedTime?.end_at);
          if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

          return {
            id: `blocked-${getBlockedTimeId(blockedTime) || `${startDate.toISOString()}-${endDate.toISOString()}`}`,
            eventType: "blocked",
            blockedTime,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            title: blockedTime?.is_all_day ? "All-day block" : "Blocked time",
            summary: blockedTime?.reason || (blockedTime?.is_all_day ? "Unavailable all day" : "Unavailable"),
            color: PROVIDER_BLOCKED_STATUS_THEME.accent,
            accentColor: PROVIDER_BLOCKED_STATUS_THEME.accent,
            completed: false,
            status: { type: "blocked", label: "Blocked" },
            startLabel: blockedTime?.is_all_day
              ? "All day"
              : `${formatTimelineTime(startDate)} - ${formatTimelineTime(endDate)}`,
          };
        })
        .filter(Boolean),
    ].sort((a, b) => new Date(a.start) - new Date(b.start)),
    [
      formatTimelineTime,
      getBlockedTimeId,
      getBookingStatusLabel,
      getEventAccentColor,
      selectedBookings,
      sortedSelectedBlockedTimes,
    ]
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

  const appointmentListData = useMemo(() => {
    if (viewMode === "day") return [];

    const bookingRows = sortedSelectedBookings.map((booking) => ({
      rowType: "booking",
      rowId: `booking-${getBookingId(booking) || `${booking?.start_time || booking?.start || ""}-${booking?.service_name || "service"}`}`,
      booking,
    }));

    const blockedRows = sortedSelectedBlockedTimes.map((blockedTime) => ({
      rowType: "blocked",
      rowId: `blocked-${getBlockedTimeId(blockedTime) || `${blockedTime?.start_at || ""}-${blockedTime?.end_at || ""}`}`,
      blockedTime,
    }));

    return [...bookingRows, ...blockedRows].sort((a, b) => {
      const aStart = new Date(a.booking?.start_time || a.booking?.start || a.blockedTime?.start_at || 0).getTime();
      const bStart = new Date(b.booking?.start_time || b.booking?.start || b.blockedTime?.start_at || 0).getTime();
      return aStart - bStart;
    });
  }, [getBlockedTimeId, getBookingId, sortedSelectedBlockedTimes, sortedSelectedBookings, viewMode]);

  const showAppointmentsEmptyState = viewMode !== "day";
  const getCalendarRowKey = useCallback((item) => String(item?.rowId || ""), []);

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
      const start = parsedStart instanceof Date && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null;

      let parsedEnd = propsEndDate instanceof Date
        ? propsEndDate
        : (booking?.end_time
          ? new Date(booking.end_time)
          : (booking?.end ? new Date(booking.end) : null));

      if ((!parsedEnd || Number.isNaN(parsedEnd.getTime())) && start && booking?.duration_minutes) {
        parsedEnd = new Date(start.getTime() + Number(booking.duration_minutes) * 60000);
      }

      const end = parsedEnd instanceof Date && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null;
      const appointmentSpan = formatProviderAppointmentSpan(start, end);

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
            {appointmentSpan.isSameDay ? (
              <Text style={styles.providerCalendarTime}>{appointmentSpan.compactLabel}</Text>
            ) : (
              <>
                <Text style={styles.providerCalendarTime}>{appointmentSpan.startLabel}</Text>
                <Text style={styles.providerCalendarTime}>{appointmentSpan.endLabel}</Text>
              </>
            )}
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
              <Text style={[styles.providerCalendarStatusText, { color: statusTheme.accent }]} numberOfLines={1}>
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
    [cancellingByBookingId, getBookingId, getBookingStatusLabel, handleCancelAppointment, isBookingCancellable]
  );

  const ProviderBlockedCard = useCallback(
    ({ blockedTime, startDate: propsStartDate, endDate: propsEndDate, compact = false }) => {
      const blockedId = getBlockedTimeId(blockedTime);
      const isDeleting = deletingBlockedId === blockedId;
      const start = propsStartDate instanceof Date ? propsStartDate : new Date(blockedTime?.start_at);
      const end = propsEndDate instanceof Date ? propsEndDate : new Date(blockedTime?.end_at);
      const timeLabel = blockedTime?.is_all_day ? "All day" : formatTimeRange(start, end);

      return (
        <View
          style={[
            styles.providerCalendarRow,
            { borderColor: PROVIDER_BLOCKED_STATUS_THEME.border, backgroundColor: PROVIDER_BLOCKED_STATUS_THEME.bgTint },
          ]}
        >
          <View style={[styles.providerCalendarLeftAccentBar, { backgroundColor: PROVIDER_BLOCKED_STATUS_THEME.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.providerCalendarTime}>{timeLabel}</Text>
            <Text style={styles.providerCalendarService}>
              {blockedTime?.is_all_day ? "All-day block" : "Blocked time"}
            </Text>
            {!compact ? (
              <Text style={styles.providerCalendarCustomer}>
                {blockedTime?.reason ? `Reason: ${blockedTime.reason}` : "Provider unavailable"}
              </Text>
            ) : null}
          </View>
          <View style={styles.providerCalendarRightActions}>
            <View
              style={[
                styles.providerCalendarStatusBadge,
                { borderColor: PROVIDER_BLOCKED_STATUS_THEME.accent, backgroundColor: PROVIDER_BLOCKED_STATUS_THEME.bgTint },
              ]}
            >
              <Text style={[styles.providerCalendarStatusText, { color: PROVIDER_BLOCKED_STATUS_THEME.accent }]} numberOfLines={1}>
                Blocked
              </Text>
            </View>
            {!compact ? (
              <TouchableOpacity
                style={[
                  styles.providerCalendarDeleteBlockButton,
                  isDeleting && styles.providerCalendarCancelButtonDisabled,
                ]}
                onPress={() => handleDeleteBlockedTime(blockedTime)}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <View style={styles.providerCalendarCancelButtonLoadingRow}>
                    <ActivityIndicator size="small" color={colors.error} />
                    <Text style={styles.providerCalendarDeleteBlockButtonText}>Deleting…</Text>
                  </View>
                ) : (
                  <Text style={styles.providerCalendarDeleteBlockButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    },
    [deletingBlockedId, getBlockedTimeId, handleDeleteBlockedTime]
  );

  return (
    <SafeAreaView style={styles.providerCalendarScreen} edges={["left", "right", "bottom"]}>
      <View style={styles.providerCalendarContentContainer}>
        <FlatList
          data={appointmentListData}
          keyExtractor={getCalendarRowKey}
          renderItem={({ item }) => (
            item?.rowType === "blocked" ? (
              <ProviderBlockedCard blockedTime={item.blockedTime} />
            ) : (
              <ProviderBookingCard
                booking={item.booking}
                token={token}
                showFlash={showFlash}
              />
            )
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

              <View style={styles.providerCalendarTopActionsRow}>
                <TouchableOpacity
                  style={styles.providerCalendarBlockTimeButton}
                  onPress={openBlockModal}
                  disabled={blockSubmitting}
                >
                  <Text style={styles.providerCalendarBlockTimeButtonText}>Block Time</Text>
                </TouchableOpacity>
                {viewMode === "day" && cancellableDayBookings.length > 0 ? (
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
                ) : null}
              </View>

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
                              blockedTimesByDate={blockedTimesByDate}
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
                                blockedTimesByDate={blockedTimesByDate}
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
                          event?.eventType === "blocked" ? (
                            <ProviderBlockedCard
                              blockedTime={event.blockedTime}
                              startDate={event.startDate}
                              endDate={event.endDate}
                              compact={event.height < 60}
                            />
                          ) : (
                            <ProviderBookingCard
                              booking={event.booking}
                              startDate={event.startDate}
                              endDate={event.endDate}
                              compact={event.height < 60}
                              token={token}
                              showFlash={showFlash}
                            />
                          )
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

      <Modal
        visible={blockModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!blockSubmitting) setBlockModalVisible(false);
        }}
      >
        <TouchableWithoutFeedback onPress={() => { if (!blockSubmitting) setBlockModalVisible(false); }}>
          <View style={styles.providerBlockModalBackdrop}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.providerBlockModalCard}>
                <KeyboardAwareScrollView
                  contentContainerStyle={styles.providerBlockModalScrollContent}
                  keyboardShouldPersistTaps="handled"
                  enableOnAndroid={true}
                  extraScrollHeight={20}
                >
                  <Text style={styles.providerBlockModalTitle}>Block Time</Text>

                  <View style={styles.providerBlockTypeRow}>
                    <TouchableOpacity
                      style={[
                        styles.providerBlockTypeButton,
                        blockType === "one_time" && styles.providerBlockTypeButtonActive,
                      ]}
                      onPress={() => setBlockType("one_time")}
                      disabled={blockSubmitting}
                    >
                      <Text
                        style={[
                          styles.providerBlockTypeButtonText,
                          blockType === "one_time" && styles.providerBlockTypeButtonTextActive,
                        ]}
                      >
                        One-Time Block
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.providerBlockTypeButton,
                        blockType === "all_day" && styles.providerBlockTypeButtonActive,
                      ]}
                      onPress={() => setBlockType("all_day")}
                      disabled={blockSubmitting}
                    >
                      <Text
                        style={[
                          styles.providerBlockTypeButtonText,
                          blockType === "all_day" && styles.providerBlockTypeButtonTextActive,
                        ]}
                      >
                        All-Day Block
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.providerBlockLabel}>Date (YYYY-MM-DD)</Text>
                  <TextInput
                    value={blockDate}
                    onChangeText={setBlockDate}
                    editable={!blockSubmitting}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="2026-03-06"
                    placeholderTextColor={colors.textMuted}
                    style={styles.providerBlockInput}
                  />

                  {blockType === "one_time" ? (
                    <>
                      <Text style={styles.providerBlockLabel}>Start Time (HH:MM)</Text>
                      <TextInput
                        value={blockStartTime}
                        onChangeText={setBlockStartTime}
                        editable={!blockSubmitting}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="09:00"
                        placeholderTextColor={colors.textMuted}
                        style={styles.providerBlockInput}
                      />

                      <View style={styles.providerBlockDurationRow}>
                        <View style={styles.providerBlockDurationCol}>
                          <Text style={styles.providerBlockLabel}>Hours</Text>
                          <TextInput
                            value={blockDurationHours}
                            onChangeText={setBlockDurationHours}
                            editable={!blockSubmitting}
                            keyboardType="number-pad"
                            placeholder="1"
                            placeholderTextColor={colors.textMuted}
                            style={styles.providerBlockInput}
                          />
                        </View>
                        <View style={styles.providerBlockDurationCol}>
                          <Text style={styles.providerBlockLabel}>Minutes</Text>
                          <TextInput
                            value={blockDurationMinutes}
                            onChangeText={setBlockDurationMinutes}
                            editable={!blockSubmitting}
                            keyboardType="number-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            style={styles.providerBlockInput}
                          />
                        </View>
                      </View>
                    </>
                  ) : null}

                  <Text style={styles.providerBlockLabel}>Reason (optional)</Text>
                  <TextInput
                    value={blockReason}
                    onChangeText={setBlockReason}
                    editable={!blockSubmitting}
                    placeholder="Optional note"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.providerBlockInput, styles.providerBlockReasonInput]}
                    multiline
                  />

                  <View style={styles.providerBlockActionsRow}>
                    <TouchableOpacity
                      style={styles.providerBlockCancelButton}
                      onPress={() => setBlockModalVisible(false)}
                      disabled={blockSubmitting}
                    >
                      <Text style={styles.providerBlockCancelButtonText}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.providerBlockSubmitButton, blockSubmitting && styles.providerCalendarCancelButtonDisabled]}
                      onPress={handleSubmitBlockedTime}
                      disabled={blockSubmitting}
                    >
                      {blockSubmitting ? (
                        <ActivityIndicator color={colors.textPrimary} size="small" />
                      ) : (
                        <Text style={styles.providerBlockSubmitButtonText}>Save Block</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </KeyboardAwareScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const formatTimeAgo = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

function NotificationBell({ unreadCount = 0, onPress }) {
  return (
    <TouchableOpacity style={styles.notificationBellButton} onPress={onPress}>
      <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
      {unreadCount > 0 ? (
        <View style={styles.notificationBellBadge}>
          <Text style={styles.notificationBellBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function NotificationsScreen({
  navigation,
  refreshUnreadCount,
  setPendingChatConversationId,
  isProvider = false,
}) {
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/notifications/me');
      const rows = Array.isArray(res?.data?.notifications) ? res.data.notifications : [];
      setNotifications(rows);
      await refreshUnreadCount?.();
    } catch (err) {
      console.log('Error loading notifications', err?.response?.data || err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [refreshUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  const handlePressNotification = useCallback(async (item) => {
    if (!item) return;
    if (!item.is_read) {
      try {
        await apiClient.patch(`/notifications/${item.id}/read`);
      } catch (err) {
        console.log('Error marking notification as read', err?.response?.data || err?.message || err);
      }
    }

    if (item.type === 'message' && item.conversation_id) {
      setPendingChatConversationId?.(item.conversation_id);

      const routeNames = navigation?.getState?.()?.routeNames || [];
      if (routeNames.includes('Appointments')) {
        navigation.navigate('Appointments');
      } else if (routeNames.includes('Dashboard')) {
        navigation.navigate('Dashboard');
      }
    }

    await loadNotifications();
  }, [loadNotifications, navigation, setPendingChatConversationId]);

  const handleClose = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    const fallbackRoute = isProvider ? "Dashboard" : "Home";
    const routeNames = navigation?.getState?.()?.routeNames || [];
    if (routeNames.includes(fallbackRoute)) {
      navigation.navigate(fallbackRoute);
      return;
    }

    const parentNavigation = navigation?.getParent?.();
    const parentRouteNames = parentNavigation?.getState?.()?.routeNames || [];
    if (parentRouteNames.includes(fallbackRoute)) {
      parentNavigation.navigate(fallbackRoute);
      return;
    }

    navigation.dispatch(CommonActions.navigate({ name: fallbackRoute }));
  }, [isProvider, navigation]);

  return (
    <SafeAreaView style={styles.notificationsScreenContainer}>
      <View style={styles.card}>
        <View style={styles.notificationsHeaderRow}>
          <Text style={styles.profileTitle}>Notifications</Text>
          <View style={styles.notificationsHeaderActions}>
            <TouchableOpacity onPress={async () => { await apiClient.patch('/notifications/read-all'); await loadNotifications(); }}>
              <Text style={styles.bookingEdit}>Mark all read</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.bookingEdit}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator />
        ) : notifications.length === 0 ? (
          <Text style={styles.serviceMeta}>No notifications yet.</Text>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => `${item.id}`}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.notificationItem} onPress={() => handlePressNotification(item)}>
                <View style={styles.notificationBody}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <Text style={styles.notificationText}>{item.body}</Text>
                  <Text style={styles.serviceMeta}>{formatTimeAgo(item.created_at)}</Text>
                </View>
                {!item.is_read ? <View style={styles.notificationUnreadDot} /> : null}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// Tabs after login
function MainApp({
  authLoading,
  token,
  setToken,
  showFlash,
  navigationRef,
  setNavReady,
  pendingChatConversationId,
  setPendingChatConversationId,
}) {
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const unreadRefreshDebounceRef = useRef(null);

  const refreshUnreadCount = useCallback(async () => {
    if (!token?.token) {
      setUnreadNotificationCount(0);
      return;
    }

    try {
      const res = await apiClient.get('/notifications/me/unread-count');
      const count = Number(res?.data?.unread_count || 0);
      setUnreadNotificationCount(Number.isFinite(count) ? count : 0);
    } catch (err) {
      console.log('Error loading unread notification count', err?.response?.data || err?.message || err);
    }
  }, [token?.token]);


  const triggerUnreadRefresh = useCallback((reason = 'unknown') => {
    if (unreadRefreshDebounceRef.current) {
      clearTimeout(unreadRefreshDebounceRef.current);
    }

    unreadRefreshDebounceRef.current = setTimeout(() => {
      console.log(`[notifications] refreshUnreadCount triggered (${reason})`);
      refreshUnreadCount();
    }, 250);
  }, [refreshUnreadCount]);

  useEffect(() => {
    triggerUnreadRefresh('initial-load');
  }, [triggerUnreadRefresh]);

  useEffect(() => {
    return () => {
      if (unreadRefreshDebounceRef.current) {
        clearTimeout(unreadRefreshDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    console.log('[notifications] unreadNotificationCount changed:', unreadNotificationCount);
  }, [unreadNotificationCount]);

  useEffect(() => {
    if (!token?.token) return;

    console.log('[notifications] Registering foreground notification listeners in MainApp');

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data || {};
      console.log('[notifications] Foreground push received:', data);
      triggerUnreadRefresh('foreground-received');
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data || {};
      console.log('[notifications] Notification response received:', data);
      triggerUnreadRefresh('notification-response');
    });

    return () => {
      receivedSubscription?.remove?.();
      responseSubscription?.remove?.();
    };
  }, [token?.token, triggerUnreadRefresh]);

  useEffect(() => {
    if (!token?.token) return;

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        triggerUnreadRefresh('app-state-active');
      }
    });

    return () => {
      appStateSubscription?.remove?.();
    };
  }, [token?.token, triggerUnreadRefresh]);

  useEffect(() => {
    if (!token?.token) return;

    const interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;

      const currentRouteName = navigationRef?.current?.getCurrentRoute?.()?.name;
      const isHomeDashboard = currentRouteName === 'Home' || currentRouteName === 'Dashboard';
      if (!isHomeDashboard) return;

      triggerUnreadRefresh(`active-${currentRouteName}-poll`);
    }, 20000);

    return () => clearInterval(interval);
  }, [navigationRef, token?.token, triggerUnreadRefresh]);

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
            headerShown: route.name === 'Dashboard',
            sceneContainerStyle: {
              backgroundColor: colors.background,
            },
            tabBarShowLabel: true,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textSecondary,
            headerStyle: {
              backgroundColor: colors.background,
            },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: {
              color: colors.textPrimary,
            },
            headerShadowVisible: false,
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
          <Tab.Screen
            name="Dashboard"
            listeners={{
              focus: () => {
                refreshUnreadCount();
              },
            }}
          >
            {(props) => (
              <ProviderDashboardScreen
                {...props}
                token={token}
                showFlash={showFlash}
                unreadNotificationCount={unreadNotificationCount}
                onPressNotifications={() => navigationRef?.current?.navigate('Notifications')}
                pendingChatConversationId={pendingChatConversationId}
                clearPendingChatConversationId={() => setPendingChatConversationId(null)}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="Calendar">
            {(props) => (
              <ProviderCalendarScreen {...props} token={token} showFlash={showFlash} />
            )}
          </Tab.Screen>

          <Tab.Screen name="Billing">
            {(props) => (
              <ProviderBillingScreen {...props} token={token} showFlash={showFlash} />
            )}
          </Tab.Screen>


          <Tab.Screen
            name="Notifications"
            options={{
              headerShown: false,
              tabBarButton: () => null,
            }}
          >
            {({ navigation }) => (
              <NotificationsScreen
                navigation={navigation}
                refreshUnreadCount={refreshUnreadCount}
                setPendingChatConversationId={setPendingChatConversationId}
                isProvider={true}
              />
            )}
          </Tab.Screen>


          <Tab.Screen name="Profile">
            {(props) => (
              <ProfileScreen
                {...props}
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
              headerShown: route.name === "Home",
              sceneContainerStyle: {
                backgroundColor: colors.background,
              },
              tabBarShowLabel: true,
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.textSecondary,
              headerStyle: {
                backgroundColor: colors.background,
              },
              headerTintColor: colors.textPrimary,
              headerTitleStyle: {
                color: colors.textPrimary,
              },
              headerShadowVisible: false,
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
            <Tab.Screen
              name="Home"
              listeners={{
                focus: () => {
                  refreshUnreadCount();
                },
              }}
            >
              {({ navigation }) => (
                <ClientHomeScreen
                  navigation={navigation}
                  token={token}
                  unreadNotificationCount={unreadNotificationCount}
                  onPressNotifications={() => navigationRef?.current?.navigate('Notifications')}
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
            <Tab.Screen
              name="Notifications"
              options={{
                headerShown: false,
                tabBarButton: () => null,
              }}
            >
              {({ navigation }) => (
                <NotificationsScreen
                  navigation={navigation}
                  refreshUnreadCount={refreshUnreadCount}
                  setPendingChatConversationId={setPendingChatConversationId}
                  isProvider={false}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Appointments">
              {({ route }) => (
                <AppointmentsScreen
                  token={token}
                  showFlash={showFlash}
                  route={route}
                  pendingChatConversationId={pendingChatConversationId}
                  clearPendingChatConversationId={() => setPendingChatConversationId(null)}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Profile">
              {(props) => (
                <ProfileScreen
                  {...props}
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
  const [authMode, setAuthMode] = useState("landing"); // 'landing' | 'login' | 'signup' | 'forgot' | 'verifyEmail' | 'finishSetup'
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState("");
  const [pendingGoogleLink, setPendingGoogleLink] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [setupContext, setSetupContext] = useState(null);
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
  const [pendingChatConversationId, setPendingChatConversationId] = useState(null);
  const pushRegistrationInFlightRef = useRef(false);
  const lastRegisteredPushTokenRef = useRef(null);

  const registerExpoPushToken = useCallback(async () => {
    if (!token?.token || pushRegistrationInFlightRef.current) return;

    pushRegistrationInFlightRef.current = true;
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF231F7C",
        });
      }

      const currentPermissions = await Notifications.getPermissionsAsync();
      let finalStatus = currentPermissions?.status;

      if (finalStatus !== "granted") {
        const requestedPermissions = await Notifications.requestPermissionsAsync();
        finalStatus = requestedPermissions?.status;
      }

      if (finalStatus !== "granted") {
        return;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        console.log("[notifications] Missing EAS projectId; cannot get Expo push token.");
        return;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = tokenResponse?.data;
      if (!expoPushToken) return;

      const storedPushToken = await AsyncStorage.getItem("expoPushToken");
      if (
        expoPushToken === storedPushToken ||
        expoPushToken === lastRegisteredPushTokenRef.current
      ) {
        return;
      }

      await apiClient.put("/users/me", { expo_push_token: expoPushToken });
      await AsyncStorage.setItem("expoPushToken", expoPushToken);
      lastRegisteredPushTokenRef.current = expoPushToken;
    } catch (err) {
      console.log(
        "[notifications] Failed to register Expo push token",
        err?.response?.data || err?.message || err
      );
    } finally {
      pushRegistrationInFlightRef.current = false;
    }
  }, [token?.token]);

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


  useEffect(() => {
    if (!token?.token) return;
    registerExpoPushToken();
  }, [registerExpoPushToken, token?.token]);

  useEffect(() => {
    const handleNotificationResponse = (response) => {
      const data = response?.notification?.request?.content?.data || {};
      if (data?.type === 'chat' && data?.conversation_id) {
        setPendingChatConversationId(Number(data.conversation_id));
        if (navigationRef?.current) {
          navigationRef.current.navigate(token?.isProvider ? 'Dashboard' : 'Appointments');
        }
      }
    };

    const hydrateLastNotificationResponse = async () => {
      const initialResponse = await Notifications.getLastNotificationResponseAsync();
      if (initialResponse) {
        handleNotificationResponse(initialResponse);
      }
    };

    hydrateLastNotificationResponse();
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    return () => {
      sub?.remove?.();
    };
  }, [navigationRef, token?.isProvider]);


  const showFlash = useCallback((type, text) => {
    setFlash({ type, text: formatFlashText(text) });
    setTimeout(() => {
      setFlash(null);
    }, 4500);
  }, [formatFlashText]);

  const [googleLoading, setGoogleLoading] = useState(false);

  // Expo Go proxy is a fallback only; OAuth/OpenID testing is expected in development builds or standalone/TestFlight apps.
  const isExpoGo = Constants.appOwnership === "expo";
  const useProxy = isExpoGo;
  const hasLoggedGoogleEnvRef = useRef(false);

  const googleIosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "").trim();
  const googleAndroidClientId = (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "").trim();
  const googleWebClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim();

  useEffect(() => {
    if (hasLoggedGoogleEnvRef.current) return;
    hasLoggedGoogleEnvRef.current = true;
    console.log("[google] appOwnership:", Constants.appOwnership);
    console.log("[google] isExpoGo:", isExpoGo);
    console.log("[google] useProxy:", useProxy);

    const missingClientIds = [];
    if (!googleIosClientId) missingClientIds.push("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");
    if (!googleAndroidClientId) missingClientIds.push("EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID");
    if (!googleWebClientId) missingClientIds.push("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");

    if (missingClientIds.length) {
      console.warn(`[google] Missing OAuth client ID env vars: ${missingClientIds.join(", ")}`);
    }
  }, [googleAndroidClientId, googleIosClientId, googleWebClientId, isExpoGo, useProxy]);

  const discovery = AuthSession.useAutoDiscovery("https://accounts.google.com");

  const [request, response, promptAsync] = Google.useAuthRequest(
  {
    expoClientId: googleWebClientId,
    iosClientId: googleIosClientId,
    androidClientId: googleAndroidClientId,
    webClientId: googleWebClientId,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    scopes: ["openid", "profile", "email"],
  },
  discovery
);

  const decodeBase64UrlToUtf8 = useCallback((value) => {
    if (typeof value !== "string" || !value) {
      return "";
    }

    const b64 = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");

    if (typeof Buffer !== "undefined" && Buffer?.from) {
      return Buffer.from(b64, "base64").toString("utf8");
    }

    if (typeof globalThis?.atob === "function") {
      const binary = globalThis.atob(b64);
      const escaped = Array.from(binary)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("");
      return decodeURIComponent(escaped);
    }

    throw new Error("No base64 decoder available");
  }, []);

  const decodeJwtNoVerify = useCallback((jwtToken) => {
    if (typeof jwtToken !== "string") {
      throw new Error("id_token is not a string");
    }

    const parts = jwtToken.split(".");
    if (parts.length !== 3) {
      throw new Error("id_token is not a JWT");
    }

    const header = JSON.parse(decodeBase64UrlToUtf8(parts[0]));
    const payload = JSON.parse(decodeBase64UrlToUtf8(parts[1]));

    return { header, payload };
  }, [decodeBase64UrlToUtf8]);

  const DEBUG_GOOGLE_AUTH = __DEV__;

  const loginWithGoogle = useCallback(async () => {
    if (!request) {
      showFlash?.("error", "Google Sign-In is not configured yet.");
      return;
    }

    let googleAuthResult = null;
    let googleTokenPayload = null;

    setGoogleLoading(true);

    try {
      if (DEBUG_GOOGLE_AUTH) {
        console.log("[google] request", {
          appOwnership: Constants.appOwnership,
          isExpoGo,
          useProxy,
          responseType: request?.responseType,
          redirectUri: request?.redirectUri,
          requestUrl: request?.url,
          codeVerifierPresent: Boolean(request?.codeVerifier),
        });
      }

      const result = await promptAsync({ useProxy });
      googleAuthResult = result;

      if (DEBUG_GOOGLE_AUTH) {
        console.log("[google] result", {
          type: result?.type,
          codePresent: Boolean(result?.params?.code),
          oauthError: result?.params?.error || null,
          oauthErrorDescription: result?.params?.error_description || null,
        });
      }

      if (result?.type !== "success") {
        return;
      }

      const code = typeof result?.params?.code === "string" ? result.params.code.trim() : "";
      if (!code) {
        showFlash?.(
          "error",
          "Google did not return an auth code. Please try again."
        );
        return;
      }

      const redirectUri = request?.redirectUri;
      if (!redirectUri) {
        showFlash?.("error", "Google redirect URI missing. Please try again.");
        return;
      }

      if (!request?.codeVerifier) {
        showFlash?.("error", "Google PKCE verifier missing. Please try again.");
        return;
      }

      if (!discovery?.tokenEndpoint) {
        showFlash?.("error", "Google discovery not ready. Please try again.");
        return;
      }

      const exchangeClientId =
        Platform.OS === "ios" && !isExpoGo
          ? googleIosClientId
          : Platform.OS === "android" && !isExpoGo
            ? googleAndroidClientId
            : googleWebClientId;

      if (!exchangeClientId) {
        showFlash?.("error", "Google client ID missing for this build. Please contact support.");
        return;
      }

      if (DEBUG_GOOGLE_AUTH) {
        console.log("[google] exchange", {
          platform: Platform.OS,
          isExpoGo,
          exchangeClientId,
          redirectUri,
        });
      }
        console.log("GOOGLE DEBUG", {
          platform: Platform.OS,
          redirectUri: request?.redirectUri,
          clientId: exchangeClientId,
        });
      const tokenRes = await AuthSession.exchangeCodeAsync(
        {
          clientId: exchangeClientId,
          code,
          redirectUri,
          extraParams: {
            code_verifier: request.codeVerifier,
          },
        },
        discovery
      );

      const idToken = typeof tokenRes?.idToken === "string" ? tokenRes.idToken.trim() : "";

      if (DEBUG_GOOGLE_AUTH) {
        console.log("[google] tokenExchange", {
          idTokenPresent: Boolean(idToken),
          idTokenLength: idToken?.length || 0,
        });
      }

      if (!idToken) {
        showFlash?.(
          "error",
          "Google token exchange did not return an ID token."
        );
        return;
      }

      if (DEBUG_GOOGLE_AUTH) {
        try {
          const decodedIdToken = decodeJwtNoVerify(idToken);
          console.log("[google] id_token_header", {
            kid: decodedIdToken?.header?.kid,
            alg: decodedIdToken?.header?.alg,
          });
          console.log("[google] id_token_payload", {
            aud: decodedIdToken?.payload?.aud,
            iss: decodedIdToken?.payload?.iss,
            azp: decodedIdToken?.payload?.azp,
            email: decodedIdToken?.payload?.email,
            exp: decodedIdToken?.payload?.exp,
          });
        } catch (jwtDecodeError) {
          console.log(
            "[google] id_token_decode_skipped",
            jwtDecodeError?.message || jwtDecodeError
          );
        }
      }

      const payload = { id_token: idToken };
      googleTokenPayload = payload;

      const res = await apiClient.post(`/auth/google`, payload);
      await saveToken(res.data.access_token);
      await saveRefreshToken(res.data.refresh_token);

      if (res.data?.needs_onboarding) {
        setSetupContext({ mode: "google", initialPhone: "", initialIsProvider: false });
        setAuthMode("finishSetup");
        return;
      }

      let meData = null;
      try {
        const meRes = await apiClient.get(`/users/me`);
        meData = meRes.data;
      } catch (meError) {
        console.log(
          "[auth] Failed to fetch /users/me after Google login",
          meError?.message || meError
        );
      }

      setToken({
        token: res.data.access_token,
        userId: meData?.id || meData?.user_id || res.data.user_id,
        email: meData?.email || res.data.email,
        username: meData?.username,
        isProvider:
          typeof meData?.is_provider === "boolean"
            ? meData?.is_provider
            : res.data.is_provider,
        isAdmin:
          typeof meData?.is_admin === "boolean"
            ? meData?.is_admin
            : res.data.is_admin,
      });

      setIsAdmin(
        typeof meData?.is_admin === "boolean"
          ? meData?.is_admin
          : !!res.data.is_admin
      );

      setPendingGoogleLink(null);
      showFlash?.("success", "Logged in successfully");
    } catch (error) {
      console.log("[google] login_error", {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message,
      });

      const data = error?.response?.data;
      const errorCode = data?.code || data?.detail?.code || normalizeErrorCode(data);
      const statusCode = error?.response?.status;

      if (
        errorCode === "EMAIL_EXISTS_NOT_LINKED" &&
        (statusCode === 400 || statusCode === 409)
      ) {
        const googleEmail =
          googleAuthResult?.params?.email ||
          googleAuthResult?.params?.login_hint ||
          null;

        setPendingGoogleLink({
          tokenPayload: googleTokenPayload,
          email: googleEmail,
        });
        setAuthMode("login");

        showFlash?.(
          "error",
          "An account already exists with this email. Log in with your password to link Google."
        );
        return;
      }

      const backendCode = data?.code || data?.detail?.code || null;

      showFlash?.(
        "error",
        backendCode
          ? `Google login failed (${backendCode}). Please try again.`
          : "Google login failed. Please try again."
      );
    } finally {
      setGoogleLoading(false);
    }
  }, [
    DEBUG_GOOGLE_AUTH,
    decodeJwtNoVerify,
    discovery,
    googleAndroidClientId,
    googleIosClientId,
    googleWebClientId,
    isExpoGo,
    promptAsync,
    request,
    setToken,
    showFlash,
    useProxy,
  ]);

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
                timeout: AUTH_ME_TIMEOUT_MS,
              }),
              AUTH_ME_TIMEOUT_MS,
              "/users/me"
            );
            console.log("[auth] /users/me success", meRes?.status);
            const latestToken = await getAuthToken();
            if (isActive) {
              const needsOnboarding =
                isOnboardingIncomplete(meRes.data) &&
                (meRes.data?.auth_provider === "google" || meRes.data?.google_sub);

              if (needsOnboarding) {
                setSetupContext({
                  mode: "google",
                  initialPhone: meRes.data?.phone || "",
                  initialIsProvider: Boolean(meRes.data?.is_provider),
                });
                setAuthMode("finishSetup");
                setToken(null);
              } else {
                setToken({
                  token: latestToken || restoredToken,
                  userId: meRes.data?.id || meRes.data?.user_id,
                  email: meRes.data?.email,
                  username: meRes.data?.username,
                  isProvider: Boolean(meRes.data?.is_provider),
                  isAdmin: Boolean(meRes.data?.is_admin),
                });
                setIsAdmin(Boolean(meRes.data?.is_admin));
              }
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
  }, []);

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
                onGooglePress={loginWithGoogle}
                googleLoading={googleLoading}
              />
            )}

            {authMode === "login" && (
              <LoginScreen
                setToken={setToken}
                setIsAdmin={setIsAdmin}
                onFacebookSetupRequired={(payload) => {
                  setSetupContext({ mode: "facebook", ...payload });
                  setAuthMode("finishSetup");
                }}
                pendingGoogleLink={pendingGoogleLink}
                onCancelGoogleLink={() => {
                  setPendingGoogleLink(null);
                  showFlash("info", "Google linking canceled.");
                }}
                clearPendingGoogleLink={() => setPendingGoogleLink(null)}
                onEmailNotVerified={(attemptedEmail) => {
                  setPendingVerifyEmail((attemptedEmail || "").trim().toLowerCase());
                  setAuthMode("verifyEmail");
                }}
                goToSignup={() => setAuthMode("signup")}
                goToForgot={() => setAuthMode("forgot")}
                goBack={() => setAuthMode("landing")}
                showFlash={showFlash}
                onGooglePress={loginWithGoogle}
                googleLoading={googleLoading}
              />
            )}

            {authMode === "signup" && (
              <SignupScreen
                goToLogin={() => setAuthMode("login")}
                goBack={() => setAuthMode("landing")}
                showFlash={showFlash}
                onSignupSuccess={(createdEmail) => {
                  setPendingVerifyEmail((createdEmail || "").trim().toLowerCase());
                  setAuthMode("verifyEmail");
                }}
              />
            )}

            {authMode === "verifyEmail" && (
              <VerifyEmailScreen
                email={pendingVerifyEmail}
                showFlash={showFlash}
                goToLogin={() => {
                  setPendingVerifyEmail("");
                  setAuthMode("login");
                }}
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
                setupContext={setupContext}
                setToken={setToken}
                setIsAdmin={setIsAdmin}
                goBackToLogin={async () => {
                  try { await clearAllAuthTokens(); } catch (e) {}
                  try { await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY); } catch (e) {}
                  setSetupContext(null);
                  setAuthMode("login");
                }}
                showFlash={showFlash}
              />
            )}
          </>
        ) : (
          <MainApp
            authLoading={authLoading}
            token={token}
            setToken={setToken}
            showFlash={showFlash}
            navigationRef={navigationRef}
            setNavReady={setNavReady}
            pendingChatConversationId={pendingChatConversationId}
            setPendingChatConversationId={setPendingChatConversationId}
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
    overflow: "visible",
  },
  pinnedHeaderSafeArea: {
    alignItems: "center",
    justifyContent: "flex-start",
    marginTop: -52,
    marginBottom: -18,
    overflow: "visible",
  },
  homeHeader: {
    marginBottom: 20,
  },
  headerLogo: {
    width: HEADER_LOGO_WIDTH,
    height: HEADER_LOGO_HEIGHT,
  },
  providerDashboardPinnedHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 40,
    alignItems: "center",
    zIndex: 10,
    elevation: 10,
    backgroundColor: "#0B1220",
  },
  providerDashboardLogoWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  providerDashboardIntro: {
    width: "100%",
    alignItems: "flex-start",
    marginBottom: 20,
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
  providerDashboardRatingText: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
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
    paddingTop: 8,
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
  providerShareButton: {
    marginTop: 14,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  providerShareButtonDisabled: {
    opacity: 0.65,
  },
  providerSharePreviewWrap: {
    width: "100%",
    aspectRatio: 1.9,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  providerSharePreviewCardWrap: {
    width: 600,
    aspectRatio: 1.9,
  },
  providerShareCaptureOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  providerShareCaptureCardWrap: {
    width: 600,
    aspectRatio: 1.9,
    alignSelf: "center",
    padding: 0,
    backgroundColor: "transparent",
    overflow: "visible",
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
  ratingModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingStarsRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  ratingStarButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  ratingStarText: {
    fontSize: 36,
    color: colors.textMuted,
  },
  ratingStarTextSelected: {
    color: "#F4B400",
  },
  ratingSubmitButton: {
    marginLeft: 12,
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
    paddingTop: 8,
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
  rateProviderButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rateProviderButtonText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 12,
  },
  bookingRatingReadOnly: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
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
bookingMessageButton: {
  marginLeft: 12,
  marginTop: 15,
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
selectedProviderActions: {
  alignItems: "flex-start",
  marginBottom: 10,
},
changeProviderText: {
  fontSize: 13,
  fontWeight: "600",
  color: colors.primary,
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
    paddingTop: 8,
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
googleButton: {
  width: "100%",
  height: 52,
  borderRadius: 12,
  backgroundColor: "#FFFFFF",
  borderWidth: 1,
  borderColor: "#E5E5E5",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 16,
  marginTop: 12,
  shadowColor: "#000",
  shadowOpacity: 0.08,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
},
googleButtonText: {
  fontSize: 16,
  fontWeight: "600",
  color: "#333",
  marginLeft: 10,
},

linkGoogleBanner: {
  width: "100%",
  backgroundColor: "rgba(77, 163, 255, 0.12)",
  borderRadius: 8,
  borderWidth: 1,
  borderColor: "rgba(77, 163, 255, 0.45)",
  paddingHorizontal: 12,
  paddingVertical: 10,
  marginBottom: 12,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},
linkGoogleBannerText: {
  color: colors.textPrimary,
  fontSize: 13,
  flex: 1,
  marginRight: 8,
},
linkGoogleBannerAction: {
  color: colors.primary,
  fontWeight: "700",
  fontSize: 13,
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
  providerCalendarBlockTimeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: "rgba(77,163,255,0.14)",
  },
  providerCalendarBlockTimeButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  providerCalendarDeleteBlockButton: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "rgba(255,107,107,0.10)",
  },
  providerCalendarDeleteBlockButtonText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: "700",
  },
  providerBlockModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 20,
    justifyContent: "center",
  },
  providerBlockModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    maxHeight: "90%",
  },
  providerBlockModalScrollContent: {
    flexGrow: 1,
  },
  providerBlockModalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12,
  },
  providerBlockTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  providerBlockTypeButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
  },
  providerBlockTypeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  providerBlockTypeButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  providerBlockTypeButtonTextActive: {
    color: colors.textPrimary,
  },
  providerBlockLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 4,
  },
  providerBlockInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  providerBlockDurationRow: {
    flexDirection: "row",
    gap: 10,
  },
  providerBlockDurationCol: {
    flex: 1,
  },
  providerBlockReasonInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  providerBlockActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  providerBlockCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerBlockCancelButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  providerBlockSubmitButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    minWidth: 104,
    alignItems: "center",
  },
  providerBlockSubmitButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },

  appointmentMessageButton: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  appointmentMessageButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  chatSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  chatKeyboardWrapper: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatCloseText: {
    color: colors.primary,
    fontWeight: "600",
  },
  chatHeaderParticipant: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    marginHorizontal: 12,
  },
  chatHeaderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceElevated,
    marginRight: 8,
  },
  chatHeaderAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  chatHeaderAvatarInitial: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  chatHeaderTitle: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 16,
    flexShrink: 1,
  },
  chatCancelledBanner: {
    margin: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,77,79,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,77,79,0.35)",
  },
  chatCancelledText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: "600",
  },
  chatList: {
    flex: 1,
    paddingHorizontal: 12,
  },
  chatListContent: {
    paddingTop: 12,
    paddingBottom: 12,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  chatRow: {
    marginVertical: 4,
    flexDirection: "row",
  },
  chatRowMine: {
    justifyContent: "flex-end",
  },
  chatRowOther: {
    justifyContent: "flex-start",
  },
  chatBubble: {
    maxWidth: "84%",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chatBubbleMine: {
    backgroundColor: colors.primary,
  },
  chatBubbleOther: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatText: {
    color: colors.textPrimary,
    marginBottom: 4,
  },
  chatTime: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },
  chatImage: {
    width: 180,
    height: 180,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  chatComposer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chatSelectedImageWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 10,
  },
  chatSelectedImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  chatRemoveImageText: {
    color: colors.error,
    fontWeight: "600",
  },
  chatComposerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  chatAttachButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    marginRight: 8,
  },
  chatSendButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  chatSendButtonDisabled: {
    opacity: 0.45,
  },
  chatSendButtonText: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  chatViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  chatViewerImage: {
    width: "100%",
    height: "100%",
  },

  notificationBellButton: {
    marginRight: 12,
    padding: 4,
  },
  notificationBellBadge: {
    position: "absolute",
    right: -2,
    top: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  notificationBellBadgeText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: "700",
  },
  notificationsScreenContainer: {
    flex: 1,
    backgroundColor: "#0F223A",
  },
  notificationsHeaderRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  notificationsHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  notificationItem: {
    width: "100%",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  notificationBody: {
    flex: 1,
    paddingRight: 8,
  },
  notificationTitle: {
    color: colors.textPrimary,
    fontWeight: "700",
    marginBottom: 4,
  },
  notificationText: {
    color: colors.textSecondary,
    marginBottom: 4,
  },
  notificationUnreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
})

export default App;
