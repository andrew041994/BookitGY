import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
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
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearToken, loadToken, saveToken } from "./src/components/tokenStorage";
import ProviderCard from "./src/components/ProviderCard";
import { createApiClient } from "./src/api/client";
import * as Location from "expo-location";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider,SafeAreaView } from "react-native-safe-area-context";
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
const AUTH_TOKEN_TIMEOUT_MS = 2000;
const AUTH_ME_TIMEOUT_MS = 12000;
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

const resolveImageUrl = (url) => {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    const normalizedPath = url.startsWith("/") ? url : `/${url}`;
    return `${API}${normalizedPath}`;
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

function navigateToClientSearch(username, navigationRef) {
  if (!navigationRef?.current) return false;
  const deeplinkNonce = Date.now();
  const params = { incomingUsername: username, deeplinkNonce };
  const rootState = navigationRef.current.getRootState?.();
  const routeNames = rootState?.routeNames || [];

  if (routeNames.includes("ClientTabs")) {
    navigationRef.current.navigate("ClientTabs", {
      screen: "Search",
      params,
    });
    return true;
  }

  navigationRef.current.navigate("Search", params);
  return true;
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
function LoginScreen({
  setToken,
  setIsAdmin,
  goToSignup,
  goToForgot,
  goBack,
  showFlash,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);


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

    // Successful login
      // Successful login
      setToken({
        token: res.data.access_token,
        userId: res.data.user_id,
        email: res.data.email,
        isProvider: res.data.is_provider,
        isAdmin: res.data.is_admin,
      });

      setIsAdmin(!!res.data.is_admin);

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

          {goToForgot && (
            <TouchableOpacity onPress={goToForgot} style={styles.forgotLink}>
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
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




function SignupScreen({ goToLogin, goBack, showFlash }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [isProvider, setIsProvider] = useState(false); // 👈 new
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

    if (!trimmedUsername) errors.username = "Username is required";
    if (!trimmedEmail) {
      errors.email = "Email is required";
    } else if (!isValidEmail(trimmedEmail)) {
      errors.email = "Email is invalid";
    }
    if (!trimmedPhone) errors.phone = "Phone is required";
    if (trimmedPassword.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }
    if (trimmedConfirm !== trimmedPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    return {
      errors,
      canSubmit: Object.keys(errors).length === 0,
    };
  }, [username, email, phone, password, confirmPassword]);

  const signup = async () => {
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
              <Button
                title="Sign Up"
                onPress={signup}
                color={colors.primary}
                disabled={!signupValidation.canSubmit}
              />
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
      await clearToken();
      if (setToken) {
        setToken(null);
      }
      if (showFlash) {
        showFlash("success", "Logged out successfully");
      }
    } catch (err) {
      console.error("Error during logout", err);
      if (showFlash) {
        showFlash("error", "Could not log out. Please try again.");
      }
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

        setUser(res.data);
        if (typeof res.data.is_provider === "boolean") {
          setIsProviderUser(res.data.is_provider);
        }
        setEditProfile({
          full_name: res.data.full_name || "",
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
    [apiClient, showFlash, token]
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
        phone: user.phone || "",
        whatsapp: user.whatsapp || "",
        location: user.location || "",
      });
    }
    setShowEdit((prev) => !prev);
  };

  const saveProfileChanges = async () => {
    try {
      setEditSaving(true);
      const storedToken = await loadToken();
      if (!storedToken) {
        if (showFlash) showFlash("error", "No access token found. Please log in again.");
        return;
      }

      const payload = {
        full_name: editProfile.full_name,
        phone: editProfile.phone,
        whatsapp: editProfile.whatsapp,
        location: editProfile.location,
      };

        const res = await apiClient.put("/users/me", payload);


      // Refresh local user state so top card updates
      setUser((prev) => ({
        ...prev,
        full_name: res.data.full_name,
        phone: res.data.phone,
        whatsapp: res.data.whatsapp,
        location: res.data.location,
      }));

      if (showFlash) showFlash("success", "Profile updated");
      setShowEdit(false);
    } catch (err) {
      console.log("Error saving profile", err.response?.data || err.message);
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

      {isProviderPublic && (
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
      )}

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
            placeholder="Full name"
            value={editProfile.full_name}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, full_name: text }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder="Phone"
            keyboardType="phone-pad"
            value={editProfile.phone}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, phone: text }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder="WhatsApp (optional)"
            value={editProfile.whatsapp}
            onChangeText={(text) =>
              setEditProfile((prev) => ({ ...prev, whatsapp: text }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder="Location (e.g. Georgetown)"
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
              disabled={editSaving}
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
            onPress={() => handleComingSoon("Help")}
          />
          <ListRow
            title="Terms of service"
            icon="document-text-outline"
            onPress={() => handleComingSoon("Terms of service")}
          />
          <ListRow
            title="Privacy policy"
            icon="lock-closed-outline"
            onPress={() => handleComingSoon("Privacy policy")}
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

      <TouchableOpacity style={styles.logoutRow} onPress={logout}>
        <Text style={styles.logoutRowText}>Logout</Text>
      </TouchableOpacity>

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
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");

  const quickCategories = useMemo(
    () => ["Barber", "Hair", "Nails", "Massage", "Makeup", "Lash", "Tutor"],
    []
  );

  const greetingName = useMemo(() => {
    const firstName = token?.firstName || token?.first_name;
    if (firstName) return firstName;
    if (token?.email) return token.email;
    return "there";
  }, [token?.email, token?.firstName, token?.first_name]);

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

  const loadNearbyProviders = useCallback(async () => {
    try {
      setNearbyLoading(true);
      setNearbyError("");

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNearbyError(
          "Location permission is required to show nearby providers."
        );
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      const coords = {
        lat: loc.coords.latitude,
        long: loc.coords.longitude,
      };

      const res = await axios.get(`${API}/providers`);
      const list = Array.isArray(res.data)
        ? res.data
        : res.data?.providers || [];

      const withinRadius = list
        .map((p) => ({
          ...p,
          distance_km: haversineKm(coords.lat, coords.long, p.lat, p.long),
        }))
        .filter((p) => typeof p.distance_km === "number" && p.distance_km <= 15)
        .sort(
          (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
        );

      setNearbyProviders(withinRadius);
      setCurrentProvider(withinRadius[0] || null);
      syncFavoritesFromList(withinRadius);
    } catch (err) {
      console.log(
        "Error loading nearby providers",
        err?.response?.data || err?.message
      );
      setNearbyError("Could not load nearby providers.");
    } finally {
      setNearbyLoading(false);
    }
  }, [syncFavoritesFromList]);

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

  return (
    <View style={styles.homeWrapper}>
        <View style={styles.pinnedHeader}>
          <SafeAreaView style={styles.pinnedHeaderSafeArea}>
            <Image
              source={BookitGYLogoTransparent}
              style={styles.headerLogo}
            />
          </SafeAreaView>
        </View>
      <ScrollView
        contentContainerStyle={styles.homeScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.homeHeader}>
          <Text style={styles.homeGreeting}>Hi, {greetingName}</Text>
          <Text style={styles.homeSubtitle}>
            What are you looking for today?
          </Text>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by profession, provider, or service"
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => handleSearchNavigate(searchText)}
            onSubmitEditing={() => handleSearchNavigate(searchText)}
            returnKeyType="search"
          />
        </View>

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

          {!nearbyLoading && !nearbyError && !hasCarousel ? (
            <Text style={styles.serviceHint}>
              No providers found within 15 km yet.
            </Text>
          ) : null}

          {!nearbyLoading && !nearbyError && hasCarousel ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselList}
              onMomentumScrollEnd={handleCarouselScroll}
            >
              {nearbyProviders.map((provider) => {
                const avatar = resolveImageUrl(
                  provider.avatar_url || provider.profile_photo_url
                );
                const saved = isFavorite(provider);
                const providerId = getProviderId(provider) || provider.name;
                const professionLabel = provider.professions?.length
                  ? provider.professions.join(", ")
                  : (provider.services || []).join(" · ");
                const distanceKm =
                  typeof provider.distance_km === "number"
                    ? provider.distance_km
                    : null;

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
                    ctaLabel="View"
                    style={styles.providerCardCarousel}
                  />
                );
              })}
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
              {favoriteProviders.map((provider) => {
                const avatar = resolveImageUrl(
                  provider.avatar_url || provider.profile_photo_url
                );
                const saved = isFavorite(provider);
                const providerId = getProviderId(provider) || provider.name;
                const professionLabel = provider.professions?.length
                  ? provider.professions.join(", ")
                  : (provider.services || []).join(" · ");
                const distanceKm =
                  typeof provider.distance_km === "number"
                    ? provider.distance_km
                    : null;

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
                    ctaLabel="View"
                    style={styles.providerCardCarousel}
                  />
                );
              })}
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

    return (
      <View
        key={booking.id || booking.booking_id || `${startIso}-${booking.service_name}`}
        style={styles.appointmentItem}
      >
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
            <Text style={styles.appointmentStatus}>
              Status: {statusLabel}
            </Text>

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
  const scrollRef = useRef(null);
  const resultsOffset = useRef(0);
  //Radius 
  const distanceChips = [0, 5, 10, 15, 20];

  useEffect(() => {
    if (!incomingUsername) return;
    setSearchQuery(incomingUsername);
    setHasSearched(true);
    setShouldScrollToResults(true);
  }, [incomingUsername, deeplinkNonce]);

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
    const trimmedQuery = searchQuery.trim();
    if (!hasSearched || !trimmedQuery) {
      setFilteredProviders([]);
      return;
    }

    const q = trimmedQuery.toLowerCase();

    const providerList = Array.isArray(providers) ? providers : [];
    const providerFromNav = route?.params?.provider;
    const navProviderId = getProviderId(providerFromNav);
    const navProviderName = (providerFromNav?.name || "").trim().toLowerCase();

    // If we navigated in with a specific provider, keep the results scoped
    // to that provider ID so namesakes don't appear.
    if (
      navProviderId &&
      navProviderName &&
      trimmedQuery.toLowerCase() === navProviderName
    ) {
      const exactMatch = providerList.find(
        (p) => getProviderId(p) === navProviderId
      );

      setFilteredProviders([exactMatch || providerFromNav]);
      return;
    }

    let list = providerList.map((p) => {
      let distance_km = null;
      if (clientLocation && p.lat != null && p.long != null) {
        distance_km = haversineKm(
          clientLocation.lat,
          clientLocation.long,
          p.lat,
          p.long
        );
      }
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
  }, [providers, searchQuery, radiusKm, clientLocation, hasSearched, route?.params?.provider]);



  const ensureClientLocation = async () => {
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
  };

  const handleRadiusChange = async (value) => {
    setRadiusKm(value);
    if (value > 0 && !clientLocation) {
      await ensureClientLocation();
    }
  };

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
              onChangeText={setSearchQuery}
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
              filteredProviders.map((p) => {
                const avatar = resolveImageUrl(
                  p.avatar_url || p.profile_photo_url
                );
                const favorite = isFavorite(p);
                const distanceKm =
                  typeof p.distance_km === "number" && clientLocation
                    ? p.distance_km
                    : null;
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
                    ctaLabel="Book"
                    isSelected={
                      selectedProvider &&
                      getProviderId(selectedProvider) === getProviderId(p)
                    }
                    style={styles.providerCardList}
                  />
                );
              })}
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

const validateServiceFields = useCallback((name, price, duration) => {
  const errors = { name: "", price: "", duration: "" };
  const trimmedName = name.trim();
  const priceNumber = Number(price);
  const durationNumber = Number(duration);

  if (!trimmedName) {
    errors.name = "Service name is required.";
  }

  if (!price || Number.isNaN(priceNumber) || priceNumber <= 0) {
    errors.price = "Enter a price greater than 0.";
  }

  if (!duration || Number.isNaN(durationNumber) || durationNumber <= 0) {
    errors.duration = "Enter a duration greater than 0.";
  }

  return errors;
}, []);

const serviceErrors = useMemo(
  () => validateServiceFields(newName, newPrice, newDuration),
  [newName, newPrice, newDuration, validateServiceFields]
);

const isServiceFormValid =
  !serviceErrors.name && !serviceErrors.price && !serviceErrors.duration;


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
  const currentErrors = validateServiceFields(
    newName,
    newPrice,
    newDuration
  );
  const isValid =
    !currentErrors.name &&
    !currentErrors.price &&
    !currentErrors.duration;

  if (!isValid) {
    if (showFlash) {
      showFlash(
        "error",
        currentErrors.name || currentErrors.price || currentErrors.duration
      );
    }
    return;
  }

  const priceNumber = Number(newPrice);
  const durationNumber = Number(newDuration);

  try {
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

    if (showFlash) showFlash("success", "Provider profile saved");
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

      <View style={styles.pinnedHeader}>
        <SafeAreaView style={styles.pinnedHeaderSafeArea}>
          <Image
            source={BookitGYLogoTransparent}
            style={styles.headerLogo}
          />
        </SafeAreaView>
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
                style={[styles.input, { height: 80 }]}
                placeholder="Description"
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
              />

              <View style={{ width: "100%", marginTop: 4 }}>
                <Button
                  title="Save service"
                  onPress={handleAddService}
                  color={colors.primary}
                  disabled={!isServiceFormValid}
                />
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
                  value={profile.full_name}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, full_name: text }))
                  }
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone"
                  value={profile.phone}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, phone: text }))
                  }
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={styles.input}
                  placeholder="WhatsApp (optional)"
                  value={profile.whatsapp}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, whatsapp: text }))
                  }
                />
                <TextInput
                  style={styles.input}
                  placeholder="Location (e.g. Georgetown)"
                  value={profile.location}
                  onChangeText={(text) =>
                    setProfile((prev) => ({ ...prev, location: text }))
                  }
                />
                <TextInput
                  style={[styles.input, { height: 80 }]}
                  placeholder="Short bio / description"
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


// Tabs after login
function MainApp({ apiClient, authLoading, token, setToken, showFlash, navigationRef }) {
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

function App() {

  const mountIdRef = useRef(Math.random().toString(16).slice(2));
  console.log("APP MOUNT ID:", mountIdRef.current);
  useEffect(() => console.log("APP useEffect ran for mount", mountIdRef.current), []);

  const [token, setToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("landing"); // 'landing' | 'login' | 'signup' | 'forgot'
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingDeepLinkUsername, setPendingDeepLinkUsername] = useState(null);
  const navigationRef = useRef(null);
  const authBootstrapRef = useRef({ inFlight: false, completed: false });
  const tokenRef = useRef(token);

  const [flash, setFlash] = useState(null);
  const handleUnauthorized = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
    } catch (storageError) {
      console.log(
        "[auth] Failed to clear legacy token",
        storageError?.message || storageError
      );
    }
    setToken(null);
  }, []);

  const apiClient = useMemo(
    () =>
      createApiClient({
        baseURL: API,
        onUnauthorized: handleUnauthorized,
      }),
    [handleUnauthorized]
  );



  const formatFlashText = (text) => {
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
  };

  const showFlash = (type, text) => {
    setFlash({ type, text: formatFlashText(text) });
    setTimeout(() => {
      setFlash(null);
    }, 4500);
  };

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    let isActive = true;

    Linking.getInitialURL().then((url) => {
      if (!isActive) return;
      let didNavigate = false;
      console.log("[deeplink] received initial url", url);
      const username = extractUsernameFromUrl(url);
      console.log("[deeplink] extracted username", username);
      if (username) {
        if (tokenRef.current && !tokenRef.current.isProvider) {
          didNavigate = navigateToClientSearch(username, navigationRef);
          setPendingDeepLinkUsername(null);
        } else {
          setPendingDeepLinkUsername({ username, nonce: Date.now() });
        }
      }
      console.log(
        "[deeplink] initial url",
        url,
        "username",
        username,
        "immediateNavigate",
        didNavigate
      );
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      let didNavigate = false;
      console.log("[deeplink] received url event", url);
      const username = extractUsernameFromUrl(url);
      console.log("[deeplink] extracted username", username);
      if (username) {
        if (tokenRef.current && !tokenRef.current.isProvider) {
          didNavigate = navigateToClientSearch(username, navigationRef);
          setPendingDeepLinkUsername(null);
        } else {
          setPendingDeepLinkUsername({ username, nonce: Date.now() });
        }
      }
      console.log(
        "[deeplink] url event",
        url,
        "username",
        username,
        "immediateNavigate",
        didNavigate
      );
    });

    return () => {
      isActive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pendingDeepLinkUsername || !token) return;

    if (token.isProvider) {
      console.log(
        "[deeplink] provider user ignoring username",
        pendingDeepLinkUsername.username
      );
      if (showFlash) {
        showFlash("error", "Open as a client to view provider links.");
      }
      setPendingDeepLinkUsername(null);
      return;
    }

    const didNavigate = navigateToClientSearch(
      pendingDeepLinkUsername.username,
      navigationRef
    );
    console.log(
      "[deeplink] pending username",
      pendingDeepLinkUsername.username,
      "navigate",
      didNavigate
    );
    setPendingDeepLinkUsername(null);
  }, [pendingDeepLinkUsername, token, showFlash]);

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
                await withTimeout(clearToken(), 1500, "clearToken");
              } catch (storageError) {
                console.log(
                  "[auth] Failed to clear secure token",
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
          </>
        ) : (
          <MainApp
            apiClient={apiClient}
            authLoading={authLoading}
            token={token}
            setToken={setToken}
            showFlash={showFlash}
            navigationRef={navigationRef}
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
    minHeight: 100,
  },
  pinnedHeaderSafeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  homeHeader: {
    marginBottom: 20,
  },
  headerLogo: {
    width: 130,
    height: 120,
    // resizeMode: "contain",
    transform: [{ translateY: -12 }],
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

  appointmentStatus: {
    marginTop: 6,
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




})

export default App;
