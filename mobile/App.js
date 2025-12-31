import React, { useState, useEffect, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Text, View, StyleSheet, TextInput, Button, Alert, ActivityIndicator, ScrollView,
         TouchableOpacity, Switch, Linking, Platform, Image,  KeyboardAvoidingView,
         TouchableWithoutFeedback, Keyboard, RefreshControl,} from "react-native";
import {
  NavigationContainer,
  getStateFromPath as defaultGetStateFromPath,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import BookitGYLogo from "./assets/bookitgy-logo.png";
import BookitGYLogoTransparent from "./assets/bookitgy-logo-transparent.png"
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider,SafeAreaView } from "react-native-safe-area-context";
import ProviderPublicProfile from "./scr/components/ProviderPublicProfile";





// import { API } from "./App"; // wherever you define your base URL





const API =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL ||
  "https://bookitgy.onrender.com";

  console.log("### API base URL =", API);

const RESERVED_USERNAME_PATHS = new Set([
  "privacy",
  "terms",
  "confirmation",
  "reset-password",
  "admin",
]);

const linking = {
  prefixes: ["https://bookitgy.com", "bookitgy://"],
  config: {
    screens: {
      Home: "",
      Search: "search",
      Appointments: "appointments",
      Profile: "profile",
      Dashboard: "dashboard",
      Billing: "billing",
      ProviderPublicProfile: ":username",
    },
  },
  getStateFromPath: (path, options) => {
    const trimmed = path?.replace(/^\//, "") || "";
    const firstSegment = trimmed.split("/")[0];

    if (RESERVED_USERNAME_PATHS.has(firstSegment)) {
      return defaultGetStateFromPath("/profile", options);
    }

    return defaultGetStateFromPath(path, options);
  },
};

  const isValidEmail = (value) => {
  const trimmed = value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
};

  const resolveImageUrl = (url) => {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    const normalizedPath = url.startsWith("/") ? url : `/${url}`;
    return `${API}${normalizedPath}`;
  };

const FAVORITES_STORAGE_KEY = (userKey) =>
  userKey ? `favoriteProviders:${userKey}` : "favoriteProviders";

const getProviderId = (provider) =>
  provider?.provider_id ?? provider?.id ?? provider?._id ?? null;

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

async function registerForPushNotificationsAsync() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Notification permissions not granted");
      return null;
    }

    // Try to infer projectId from Constants (managed or dev client)
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    if (!projectId) {
      console.log(
        'No "projectId" found in Constants – skipping push token registration in this dev build.'
      );
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch (err) {
    console.log("Error getting push token", err);
    return null;
  }
}

  


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

    // Try to register push token, but don't fail login if this breaks
    await AsyncStorage.setItem("accessToken", res.data.access_token);

      // Try to register push token, but don't fail login if this breaks
      try {
        const expoPushToken = await registerForPushNotificationsAsync();
        if (expoPushToken) {
          await axios.put(
            `${API}/users/me`,
            { expo_push_token: expoPushToken },
            {
              headers: {
                Authorization: `Bearer ${res.data.access_token}`,
              },
            }
          );
        }
      } catch (err) {
        console.log("Failed to register push token", err);
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
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={styles.inputPlaceholder.color}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

          {goToSignup && (
            <View style={{ width: "100%", marginBottom: 10 }}>
               {loading ? (
                <ActivityIndicator size="large" color="#16a34a" />
              ) : (
                <Button title="Login" onPress={login} color="#16a34a" />
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
                  color="#166534"
                />
              </View>
            )}

            {goBack && (
              <View style={{ width: "100%" }}>
                <Button title="Back" onPress={goBack} color="#6b7280" />
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
                color="#16a34a"
                disabled={submitting}
              />
            </View>

            {devResetLink && (
              <View style={{ width: "100%", marginBottom: 10 }}>
                <Text style={{ color: "#0f172a", marginBottom: 6 }}>
                  Dev reset link (only visible in dev):
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openURL(devResetLink)}
                  style={{ paddingVertical: 10 }}
                >
                  <Text
                    style={{
                      color: "#2563eb",
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
                  color="#166534"
                />
              </View>
            )}

            {goBack && (
              <View style={{ width: "100%" }}>
                <Button title="Back" onPress={goBack} color="#6b7280" />
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
        showFlash("success", "Account created! Please log in.");
      } else {
        Alert.alert("Success", "Account created! Now login");
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
    <KeyboardAvoidingView
      style={styles.avoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0} // tweak if needed

    > 
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      {/* Username Field */}
      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor={styles.inputPlaceholder.color}
        value={username}
        onChangeText={setUsername}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={styles.inputPlaceholder.color}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Phone (592XXXXXXX)"
        placeholderTextColor={styles.inputPlaceholder.color}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />

      {/* Provider toggle */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Register as service provider</Text>
        <Switch value={isProvider} onValueChange={setIsProvider} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={styles.inputPlaceholder.color}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        placeholderTextColor={styles.inputPlaceholder.color}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      <View style={{ width: "100%", marginBottom: 10 }}>
        <Button title="Sign Up" onPress={signup} color="#16a34a" />
      </View>

      {goToLogin && (
        <View style={{ width: "100%", marginBottom: 10 }}>
          <Button
            title="Already have an account? Login"
            onPress={goToLogin}
            color="#166534"
          />
        </View>
      )}

      {goBack && (
        <View style={{ width: "100%" }}>
          <Button title="Back" onPress={goBack} color="#6b7280" />
        </View>
      )}
    </View>
    </KeyboardAvoidingView>
  );
}



// Placeholder screens so MainApp compiles — replace with your real ones
function ProfileScreen({ setToken, showFlash, token }) {
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


  const uploadAvatar = async (uri) => {
    try {
      const token = await AsyncStorage.getItem("accessToken");
      if (!token) {
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
          const meRes = await axios.get(`${API}/users/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

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
          ? `${API}/providers/me/avatar`
          : `${API}/users/me/avatar`;

      const res = await axios.post(endpoint, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
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
      await AsyncStorage.removeItem("accessToken");
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

        const tokenValue = await AsyncStorage.getItem("accessToken");

        if (!tokenValue) {
          setError("No access token found. Please log in again.");
          setLoading(false);
          return;
        }

        const headers = {
          Authorization: `Bearer ${tokenValue}`,
        };

        // 1) Load base user info
        const res = await axios.get(`${API}/users/me`, { headers });

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
            const provRes = await axios.get(
              `${API}/providers/me/profile`,
              { headers }
            );
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
    [showFlash, token]
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile, token]);

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
      const token = await AsyncStorage.getItem("accessToken");
      if (!token) {
        if (showFlash) showFlash("error", "No access token found. Please log in again.");
        return;
      }

      const payload = {
        full_name: editProfile.full_name,
        phone: editProfile.phone,
        whatsapp: editProfile.whatsapp,
        location: editProfile.location,
      };

        const res = await axios.put(
          `${API}/users/me`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
      );


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

      const token = await AsyncStorage.getItem("accessToken");
      if (!token) {
        setBookingsError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/bookings/me`, {
        headers: { Authorization: `Bearer ${token}` },
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
  const providerUsername = user?.username?.trim();
  const providerProfileLink = providerUsername
    ? `https://bookitgy.com/${providerUsername}`
    : null;
  const providerProfileLinkLabel =
    providerProfileLink || "Set a username to generate your link";

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
              const token = await AsyncStorage.getItem("accessToken");
              if (!token) {
                if (showFlash)
                  showFlash("error", "No access token found. Please log in.");
                return;
              }

                  await axios.post(
                    `${API}/bookings/${bookingId}/cancel`,
                    {},
                    {
                      headers: { Authorization: `Bearer ${token}` },
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

  return (
    <ScrollView
      contentContainerStyle={styles.profileScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.profileHeader}>
        {/* Avatar */}
        <View style={{ alignItems: "center", marginBottom: 16 }}>
          <View style={styles.profileAvatarWrapper}>
            {displayAvatarUrl ? (
              <Image
                source={{ uri: displayAvatarUrl }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.profileAvatarFallback}>
                <Text style={styles.profileAvatarInitial}>
                  {(user.full_name || user.email || "C").charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity onPress={pickClientAvatar} style={{ marginTop: 8 }}>
            <Text
              style={{
                color: "#007AFF",
                fontWeight: "500",
              }}
            >
              Change profile picture
            </Text>
          </TouchableOpacity>
        </View>


        {/* Name + role */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.profileTitle}>
            {user.full_name || "My Profile"}
          </Text>
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

      <View style={styles.card}>
        {isProvider && (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.label}>Profile link</Text>
            <View style={styles.profileLinkRow}>
              <Text style={[styles.profileLinkText, { flex: 1 }]} numberOfLines={1}>
                {providerProfileLinkLabel}
              </Text>
              <TouchableOpacity
                style={styles.profileLinkCopy}
                onPress={async () => {
                  try {
                    if (!providerProfileLink) {
                      showFlash?.(
                        "error",
                        "Set a username to generate your link"
                      );
                      return;
                    }

                    await Clipboard.setStringAsync(providerProfileLink);
                    showFlash?.(
                      "success",
                      "Profile link copied to clipboard"
                    );
                  } catch (err) {
                    console.log("Error copying profile link", err?.message || err);
                    showFlash?.("error", "Could not copy profile link");
                  }
                }}
              >
                <Text style={styles.profileLinkCopyText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user.email}</Text>

        {user.phone && (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>Phone</Text>
            <Text style={styles.value}>{user.phone}</Text>
          </>
        )}

        {user.location && (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>Location</Text>
            <Text style={styles.value}>{user.location}</Text>
          </>
        )}
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
              color="#16a34a"
              disabled={editSaving}
            />
          </View>
        </View>
      )}

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
                        {/* Centered pill button */}
                        <View style={styles.navigateButtonContainer}>
                          <TouchableOpacity
                            style={styles.navigateButton}
                            onPress={() => handleNavigateToBooking(b)}
                          >
                            <Text style={styles.navigateButtonText}>Navigate</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Cancel text under the button */}
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





      <View style={styles.actionsContainer}>
        <Text style={styles.sectionTitle}>Actions</Text>

        {/* Edit profile */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={toggleEditProfile}
        >
          <Text style={styles.actionButtonText}>
            {showEdit ? "Hide edit profile" : "Edit profile"}
          </Text>
        </TouchableOpacity>

        {/* My bookings – only for clients (non-providers) */}
        {!isProvider && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={toggleMyBookings}
          >
            <Text style={styles.actionButtonText}>
              {showBookings ? "Hide my bookings" : "My bookings"}
            </Text>
          </TouchableOpacity>
        )}

        {/* Admin tools */}
        {isAdmin && (
          <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleComingSoon("Admin dashboard")}
            >
            <Text style={styles.actionButtonText}>Admin dashboard</Text>
          
          
          </TouchableOpacity>
        )}

        {/* Logout */}
        <TouchableOpacity
          style={[styles.actionButton, styles.logoutButton]}
          onPress={logout}
        >
          <Text style={[styles.actionButtonText, styles.logoutButtonText]}>
            Logout
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
    
  );
  
}



function ClientHomeScreen({
  navigation,
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

  useEffect(() => {
    refreshFavoriteProviders();
  }, [refreshFavoriteProviders]);

  return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#EFFFF3" }}>
      <ScrollView
        contentContainerStyle={styles.homeScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Image
            source={BookitGYLogoTransparent}
            style={{ width: 260, height: 260, resizeMode: "contain" }}
          />
        </View>

        <Text style={styles.subtitle} allowFontScaling={false}>
          Find and book services in {"\n"}Guyana
        </Text>

        <View
            style={{
              marginTop: 10,        // was 30 — now moved up
              width: "70%",
              alignSelf: "center",  // ensures it's centered
              marginBottom: 20, 
            }}
          >
            <TouchableOpacity
              style={[styles.bookButton, { paddingVertical: 14 }]}
              onPress={() => navigation.navigate("Search")}
            >
              <Text style={styles.bookButtonLabel}>Start searching</Text>
            </TouchableOpacity>
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
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator />
              <Text style={styles.serviceMeta}>Loading nearby providers…</Text>
            </View>
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
                const servicesLabel = (provider.services || []).join(" · ");
                const saved = isFavorite(provider);
                const providerId = getProviderId(provider) || provider.name;

                return (
                  <TouchableOpacity
                    // key={provider.id || provider.name}
                    key={providerId}
                    style={styles.providerCard}
                    activeOpacity={0.9}
                    onPress={() => handleProviderPress(provider)}
                  >
                <View style={styles.cardImageWrapper}>
                  <TouchableOpacity
                    style={styles.cardHeartButton}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      toggleFavorite(provider);
                    }}
                    accessibilityLabel={
                      saved ? "Remove from favorites" : "Save to favorites"
                    }
                  >
                    <Ionicons
                      name={saved ? "heart" : "heart-outline"}
                      size={20}
                      color={saved ? "#dc2626" : "#111827"}
                    />
                  </TouchableOpacity>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      overflow: "hidden",
                      backgroundColor: "#e5e7eb",
                      position: "absolute",
                      top: 12,
                      left: 12,
                      zIndex: 10,
                    }}
                  >
                    {avatar ? (
                      <Image
                        source={{ uri: avatar }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          flex: 1,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "#16a34a",
                        }}
                      >
                        <Ionicons name="person" size={32} color="#fff" />
                      </View>
                    )}
                  </View>

                  {/* Background placeholder behind the circle */}
                  <View
                    style={{
                      width: "100%",
                      height: "100%",
                      backgroundColor: "#dcfce7",
                    }}
                  />
              </View>


                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {provider.name}
                      </Text>

                      {provider.distance_km != null ? (
                        <Text style={styles.cardMeta}>
                          {provider.distance_km.toFixed(1)} km away
                        </Text>
                      ) : null}

                      {provider.services?.length ? (
                        <Text
                          style={styles.cardMeta}
                          numberOfLines={2}
                        >
                          {servicesLabel}
                        </Text>
                      ) : (
                        <Text
                          style={styles.cardMetaMuted}
                          numberOfLines={1}
                        >
                          No services listed yet
                        </Text>
                      )}

                      {provider.professions?.length ? (
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {provider.professions.join(", ")}
                        </Text>
                      ) : null}

                      {provider.bio ? (
                        <Text
                          style={styles.cardDescription}
                          numberOfLines={2}
                        >
                          {provider.bio}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
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
                const servicesLabel = (provider.services || []).join(" · ");
                const saved = isFavorite(provider);
                const providerId = getProviderId(provider) || provider.name;

                return (
                  <TouchableOpacity
                    key={providerId}
                    style={styles.providerCard}
                    activeOpacity={0.9}
                    onPress={() => handleProviderPress(provider)}
                  >
                    <View style={styles.cardImageWrapper}>
                      <TouchableOpacity
                        style={styles.cardHeartButton}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          toggleFavorite(provider);
                        }}
                        accessibilityLabel={
                          saved
                            ? "Remove from favorites"
                            : "Save to favorites"
                        }
                      >
                        <Ionicons
                          name={saved ? "heart" : "heart-outline"}
                          size={20}
                          color={saved ? "#dc2626" : "#111827"}
                        />
                      </TouchableOpacity>

                      <View
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 36,
                          overflow: "hidden",
                          backgroundColor: "#e5e7eb",
                          position: "absolute",
                          top: 12,
                          left: 12,
                          zIndex: 10,
                        }}
                      >
                        {avatar ? (
                          <Image
                            source={{ uri: avatar }}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "#16a34a",
                            }}
                          >
                            <Ionicons name="person" size={32} color="#fff" />
                          </View>
                        )}
                      </View>

                      <View
                        style={{
                          width: "100%",
                          height: "100%",
                          backgroundColor: "#dcfce7",
                        }}
                      />
                    </View>

                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {provider.name}
                      </Text>

                      {provider.location ? (
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {provider.location}
                        </Text>
                      ) : null}

                      {provider.professions?.length ? (
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {provider.professions.join(", ")}
                        </Text>
                      ) : null}

                      {servicesLabel ? (
                        <Text style={styles.cardMeta} numberOfLines={2}>
                          {servicesLabel}
                        </Text>
                      ) : null}

                      {provider.bio ? (
                        <Text style={styles.cardDescription} numberOfLines={2}>
                          {provider.bio}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      </ScrollView>
      </SafeAreaView>
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

        const storedToken = await AsyncStorage.getItem("accessToken");
        const authToken = token?.token || storedToken;

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
              const storedToken = await AsyncStorage.getItem("accessToken");
              const authToken = token?.token || storedToken;

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

    




function SearchScreen({
  token,
  showFlash,
  navigation,
  route,
  toggleFavorite,
  isFavorite,
  syncFavoritesFromList,
}) {
 

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

  //Radius 
  const radiusOptions = [0, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

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
        const professions = (p.professions || []).map((pr) =>
          (pr || "").toLowerCase()
        );

        return (
          professions.some((pr) => pr.includes(q)) ||
          name.includes(q) ||
          location.includes(q)
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
      return null;
    }
  };

  const handleRadiusChange = async (value) => {
    setRadiusKm(value);
    if (value > 0 && !clientLocation) {
      await ensureClientLocation();
    }
  };


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

      const storedToken = await AsyncStorage.getItem("accessToken");
      if (!storedToken) {
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
          headers: { Authorization: `Bearer ${storedToken}` },
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
              <ScrollView
                contentContainerStyle={styles.providerScroll}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                  />
                }
              >
                <Text style={styles.profileTitle}>Find a provider</Text>
                <Text style={styles.subtitleSmall}>
                  Search by profession and distance, then pick a service and time.
                </Text>

                {/* Filters */}
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Search filters</Text>

                  <TextInput
                    style={styles.input}
                    placeholder="Search by profession (e.g. Barber, Nail Tech)"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={handleSearchSubmit}
                  />

                  <Text style={[styles.label, { marginTop: 8 }]}>Distance</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 8 }}
                  >
                    {radiusOptions.map((km) => {
                      const selected = radiusKm === km;
                      const label = km === 0 ? "Any distance" : `${km} km`;
                      return (
                        <TouchableOpacity
                          key={km}
                          style={[
                            styles.radiusPill,
                            selected && styles.radiusPillSelected,
                          ]}
                          onPress={() => handleRadiusChange(km)}
                        >
                          <Text
                            style={[
                              styles.radiusPillText,
                              selected && styles.radiusPillTextSelected,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {locationError ? (
                    <Text style={[styles.errorText, { marginTop: 6 }]}>
                      {locationError}
                    </Text>
                  ) : null}
                </View>

                {/* Providers list */}
                      <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Providers</Text>

                        {/* If user hasn't searched yet, show hint */}
                        {!hasSearched && (
                          <Text style={styles.serviceHint}>
                            Type a profession and press enter to search.
                          </Text>
                        )}

                        {/* Loading */}
                        {providersLoading && hasSearched && (
                          <View style={{ paddingVertical: 10 }}>
                            <ActivityIndicator />
                            <Text style={styles.serviceMeta}>Loading providers…</Text>
                          </View>
                        )}

                        {/* Error */}
                        {!providersLoading && providersError && hasSearched && (
                          <Text style={styles.errorText}>{providersError}</Text>
                        )}

                        {/* No results */}
                        {!providersLoading &&
                          !providersError &&
                          hasSearched &&
                          filteredProviders.length === 0 && (
                            <Text style={styles.serviceHint}>No providers found.</Text>
                          )}

                        {/* Results */}
                        {!providersLoading &&
                          !providersError &&
                          hasSearched &&
                          filteredProviders.length > 0 &&
                          filteredProviders.map((p) => {
                            const avatar = resolveImageUrl(
                              p.avatar_url || p.profile_photo_url
                            );
                            const favorite = isFavorite(p);
                    return (
                              <TouchableOpacity
                                key={getProviderId(p) || p.name}
                                style={[
                                  styles.serviceRow,
                                  selectedProvider &&
                                    getProviderId(selectedProvider) === getProviderId(p) && {
                                      backgroundColor: "#ecfdf3",
                                    },
                                ]}
                                onPress={() => handleSelectProvider(p)}
                              >
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    flex: 1,
                                  }}
                                >
                                  {/* Avatar (photo or initial) */}
                                  {avatar ? (
                                    <Image
                                      source={{ uri: avatar }}
                                      style={styles.providerAvatarSmall}
                                    />
                                  ) : (
                                    <View style={styles.providerAvatarSmallFallback}>
                                      <Text style={styles.providerAvatarSmallInitial}>
                                        {(p.name || "P").charAt(0).toUpperCase()}
                                      </Text>
                                    </View>
                                  )}

                                  {/* Provider text info */}
                                  <View style={{ flex: 1, paddingRight: 8 }}>
                                    <Text style={styles.serviceName}>{p.name}</Text>

                                    {p.location ? (
                                      <Text style={styles.serviceMeta}>{p.location}</Text>
                                    ) : null}

                                    {(p.professions || []).length > 0 && (
                                      <Text style={styles.serviceMeta}>
                                        {p.professions.join(" · ")}
                                      </Text>
                                    )}

                                    {typeof p.distance_km === "number" && clientLocation && (
                                      <Text style={styles.serviceMeta}>
                                        {p.distance_km.toFixed(1)} km away
                                      </Text>
                                    )}

                                    {p.bio ? (
                                      <Text numberOfLines={2} style={styles.serviceMeta}>
                                        {p.bio}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    toggleFavorite(p);
                                  }}
                                  style={styles.favoriteToggleButton}
                                  accessibilityLabel={
                                    favorite
                                      ? "Remove from favorites"
                                      : "Save to favorites"
                                  }
                                >
                                  <Ionicons
                                    name={favorite ? "heart" : "heart-outline"}
                                    size={20}
                                    color={favorite ? "#dc2626" : "#111827"}
                                  />
                                </TouchableOpacity>
                              </TouchableOpacity>
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
                              isSelected && { borderColor: "#16a34a", borderWidth: 1 },
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
         );
      }




// function AdminScreen() {
//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Provider</Text>
//     </View>
//   );
// }

function ProviderDashboardScreen({ token, showFlash }) {
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

const profileUsername = profile.username?.trim() || token?.username?.trim() || "";
const profileLink = profileUsername
  ? `https://bookitgy.com/${profileUsername}`
  : null;
const profileLinkLabel = profileLink || "Set a username to generate your link";

const copyProfileLink = async (link) => {
  try {
    if (!link) {
      if (showFlash) {
        showFlash("error", "Set a username to generate your link");
      } else {
        Alert.alert("Unavailable", "Set a username to generate your link");
      }
      return;
    }

    await Clipboard.setStringAsync(link);
    if (showFlash) {
      showFlash("success", "Profile link copied to clipboard");
    } else {
      Alert.alert("Copied", "Profile link copied to clipboard");
    }
  } catch (err) {
    console.log("Error copying profile link", err?.message || err);
    if (showFlash) {
      showFlash("error", "Could not copy profile link");
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

      const storedToken = await AsyncStorage.getItem("accessToken");
      if (!storedToken) {
        setBookingsError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/providers/me/bookings`, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
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

    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
      setHoursError("No access token found. Please log in again.");
      return;
    }

    const res = await axios.get(`${API}/providers/me/working-hours`, {
      headers: { Authorization: `Bearer ${storedToken}` },
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
    const token = await AsyncStorage.getItem("accessToken");
    const res = await axios.get(
      `${API}/providers/me/bookings/today`,
      { headers: { Authorization: `Bearer ${token}` } }
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
            const storedToken = await AsyncStorage.getItem("accessToken");
            if (!storedToken) {
              if (showFlash) showFlash("error", "No access token found.");
              return;
            }

            await axios.post(
              `${API}/providers/me/bookings/${bookingId}/cancel`,
              {},
              {
                headers: {
                  Authorization: `Bearer ${storedToken}`,
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


// const handleEditBooking = (booking) => {
//   if (showFlash) {
//     showFlash("info", "Editing bookings will be added soon.");
//   }
//   // Next step: navigate to an Edit Booking screen or show a time picker.
// };

const loadServices = async () => {
    try {
      setLoading(true);
      setServicesError("");

      const storedToken = await AsyncStorage.getItem("accessToken");
      if (!storedToken) {
        setServicesError("No access token found. Please log in again.");
        return;
      }

      const res = await axios.get(`${API}/providers/me/services`, {
        headers: {
        Authorization: `Bearer ${storedToken}`,
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
    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
      if (showFlash) showFlash("error", "No access token found.");
      setHoursFlash({ type: "error", message: "No access token found." });
      setTimeout(() => setHoursFlash(null), 2000);
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
          setTimeout(() => setHoursFlash(null), 2000);
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
          setTimeout(() => setHoursFlash(null), 2000);
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
      headers: { Authorization: `Bearer ${storedToken}` },
    });


    // if (showFlash) showFlash("success", "Working hours saved");
    setHoursFlash({ type: "success", message: "Working hours saved" });
    setTimeout(() => setHoursFlash(null), 2000);
  } catch (err) {
    console.log(
      "Error saving working hours",
      err.response?.data || err.message
    );
    if (showFlash) showFlash("error", "Could not save working hours.");
    setHoursFlash({ type: "error", message: "Could not save working hours." });
    setTimeout(() => setHoursFlash(null), 2000);
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
  if (!newName.trim()) {
    if (showFlash) showFlash("error", "Service name is required");
    return;
  }

  const priceNumber = newPrice ? Number(newPrice) : 0;
  const durationNumber = newDuration ? Number(newDuration) : 30;

  try {
    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
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
          Authorization: `Bearer ${storedToken}`,
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
      const storedToken = await AsyncStorage.getItem("accessToken");
      if (!storedToken) {
        if (showFlash) showFlash("error", "No access token found.");
        return;
      }

      await axios.delete(`${API}/providers/me/services/${serviceId}`, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });

      if (showFlash) {
        showFlash("success", "Service deleted");
      }

      setServices((prev) => prev.filter((s) => s.id !== serviceId));
    } catch (err) {
      console.log("Error deleting service", err.response?.data || err.message);
      if (showFlash) {
        showFlash("error", "Could not delete service.");
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

    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
      setProfileError("No access token found. Please log in again.");
      return;
    }

    const res = await axios.get(`${API}/providers/me/profile`, {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    });

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

    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
      setCatalogError("No access token found. Please log in again.");
      return;
    }

    const res = await axios.get(`${API}/providers/me/catalog`, {
      headers: { Authorization: `Bearer ${storedToken}` },
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

    const tokenStr = await AsyncStorage.getItem("accessToken");
    if (!tokenStr) {
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
        Authorization: `Bearer ${tokenStr}`,
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
            const tokenStr = await AsyncStorage.getItem("accessToken");
            if (!tokenStr) {
              alert("No access token found. Please log in again.");
              return;
            }

            await axios.delete(`${API}/providers/me/catalog/${imageId}`, {
              headers: { Authorization: `Bearer ${tokenStr}` },
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
    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) {
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
          Authorization: `Bearer ${storedToken}`,
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
    setTimeout(() => setHoursFlash(null), 2000);

    if (showFlash) showFlash("success", "Provider profile saved");
  } catch (err) {
    console.log("Error saving provider profile", err.response?.data || err.message);

    setHoursFlash({ type: "error", message: "Provider profile not saved" });
    setTimeout(() => setHoursFlash(null), 2000);

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
    const rawToken = await AsyncStorage.getItem("accessToken");
    if (!rawToken) {
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
    let endpoint = `${API}/users/me/avatar`; // default: client

    try {
      const meRes = await axios.get(`${API}/users/me`, {
        headers: {
          Authorization: `Bearer ${rawToken}`,
        },
      });

      if (meRes.data?.is_provider) {
        // logged-in user is a provider → use provider avatar endpoint
        endpoint = `${API}/providers/me/avatar`;
      }
    } catch (e) {
      console.log(
        "Could not determine user type for avatar upload; using /users/me/avatar",
        e.response?.data || e.message
      );
    }

    // Upload to the chosen endpoint
    const res = await axios.post(endpoint, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${rawToken}`,
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
    const token = await AsyncStorage.getItem("accessToken");
    const res = await axios.get(
      `${API}/providers/me/bookings/upcoming`,
      { headers: { Authorization: `Bearer ${token}` } }
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
    const token = await AsyncStorage.getItem("accessToken");
    if (!token) {
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
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // 2) ALSO update the provider record so searches & client view use it
    await axios.put(
      `${API}/providers/me/location`,
      { lat: coords.lat, long: coords.long },
      { headers: { Authorization: `Bearer ${token}` } }
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
    const storedToken = await AsyncStorage.getItem("accessToken");
    if (!storedToken) return;

     const res = await axios.get(`${API}/users/me`, {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    });

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
    const res = await axios.get(`${API}/providers/me/summary`, {
      headers: {
        Authorization: `Bearer ${token.token}`,
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
    <View style={{ flex: 1 }}>
      <View style={{ alignItems: "center", marginBottom: 16 }}>
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              marginBottom: 8,
            }}
          />
        ) : (
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: "#ccc",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 32 }}>
              {(profile.full_name || token?.email || "P")[0].toUpperCase()}
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={pickAvatar}>
          <Text style={{ color: "#007AFF", marginTop: 4 }}>Change photo</Text>
        </TouchableOpacity>
      </View>
      
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

      <ScrollView
        contentContainerStyle={styles.providerScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
      
        <Text style={styles.profileTitle}>Provider dashboard</Text>
        <Text style={styles.subtitleSmall}>Welcome, {providerLabel}</Text>
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
              <Text style={{ color: "#16a34a", fontWeight: "600" }}>
                {adding ? "Cancel" : "+ Add"}
              </Text>
            </TouchableOpacity>
          </View>

          {adding && (
            <View style={{ marginBottom: 12 }}>
              <TextInput
                style={styles.input}
                placeholder="Service name"
                value={newName}
                onChangeText={setNewName}
              />
              <TextInput
                style={styles.input}
                placeholder="Price (GYD)"
                value={newPrice}
                onChangeText={setNewPrice}
                keyboardType="numeric"
              />
              <TextInput
                style={styles.input}
                placeholder="Duration (minutes)"
                value={newDuration}
                onChangeText={setNewDuration}
                keyboardType="numeric"
              />
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
                  color="#16a34a"
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
                    <Text style={{ fontSize: 12, color: "#b91c1c" }}>
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
                color="#16a34a"
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

            <View style={styles.profileLinkBox}>
              <Text style={styles.sectionTitle}>Profile link</Text>
              <Text style={styles.hoursHelp}>
                Share this with clients so they can book you directly.
              </Text>

              <View style={styles.profileLinkRow}>
                <Text style={styles.profileLinkText} numberOfLines={1}>
                  {profileLinkLabel}
                </Text>
                <TouchableOpacity
                  style={styles.profileLinkCopy}
                  onPress={() => copyProfileLink(profileLink)}
                >
                  <Text style={styles.profileLinkCopyText}>Copy</Text>
                </TouchableOpacity>
              </View>
            </View>

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
                    color="#16a34a"
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
                  color: "#16a34a",
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
  const [bills, setBills] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [expandedBills, setExpandedBills] = useState({});
  const [serviceChargePct, setServiceChargePct] = useState(10);
  const [refreshing, setRefreshing] = useState(false);

  const resolveServiceChargePct = (summaryData) => {
    const rawValue =
      summaryData?.service_charge_percentage ??
      summaryData?.service_charge_percent ??
      summaryData?.service_charge_rate ??
      summaryData?.service_charge;

    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return 10;

    // Allow either fractional (0.1) or whole-number (10) representations.
    const pctValue = numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(pctValue, 0);
  };

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

  const formatDate = (value) => {
    if (!value) return "-";
    const dateObj = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateObj.getTime())) return "-";
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const normalizeStart = (booking) => {
    const raw = booking?.start_time || booking?.start;
    if (!raw) return null;
    const dateObj = new Date(raw);
    return Number.isNaN(dateObj.getTime()) ? null : dateObj;
  };

  const buildBills = useCallback(
    (
      bookingList,
      chargePct = 10,
      creditBalance = 0
    ) => {
    const now = new Date();
    const statements = [];
    const monthsToShow = 6;

    const feeRate = Math.max(chargePct, 0) / 100;
    let remainingCredits = Math.max(Number(creditBalance) || 0, 0);

    for (let i = 0; i < monthsToShow; i += 1) {
      const coverageStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const coverageEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const invoiceDate = new Date(
        coverageStart.getFullYear(),
        coverageStart.getMonth() + 1,
        1
      );

      const monthBookings = bookingList.filter((booking) => {
        const normalizedStatus = (booking?.status || "")
          .toString()
          .trim()
          .toLowerCase();

        if (["cancelled", "canceled"].includes(normalizedStatus)) {
          return false;
        }

        const start = normalizeStart(booking);
        if (!start) return false;
        return start >= coverageStart && start <= coverageEnd;
      });

      const lineItems = monthBookings.length
        ? monthBookings.map((booking) => ({
            bookingId: booking.id || booking.booking_id,
            description: booking.service_name || "Service booking",
            client:
              booking.client_name ||
              booking.customer_name ||
              booking.user_name ||
              booking.client ||
              booking.user,
            date: normalizeStart(booking),
            amount:
              Number(
                booking.service_price_gyd ??
                  booking.price_gyd ??
                  booking.total_price_gyd ??
                  booking.price
              ) || 0,
          }))
        : [
            {
              bookingId: `empty-${coverageStart.toISOString()}`,
              description: "No completed bookings recorded",
              client: "",
              date: null,
              amount: 0,
            },
          ];

      const servicesTotal = lineItems.reduce(
        (sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0),
        0
      );

      const platformFee = Math.max(Math.round(servicesTotal * feeRate), 0);
      const statementId = `${coverageStart.getFullYear()}-${coverageStart.getMonth() + 1}`;

      let billCreditsApplied = Math.min(remainingCredits, platformFee);
      remainingCredits -= billCreditsApplied;

      let totalDue = Math.max(platformFee - billCreditsApplied, 0);

      statements.push({
        id: statementId,
        coverageStart,
        coverageEnd,
        invoiceDate,
        status: invoiceDate <= now ? "Generated" : "Scheduled",
        servicesTotal,
        platformFee,
        billCreditsApplied,
        totalDue,
        lineItems,
      });
    }

    statements.sort((a, b) => b.invoiceDate - a.invoiceDate);
    setBills(statements);
  }, []);

  const fetchBilling = useCallback(async () => {
    try {
      setBillingLoading(true);
      setBillingError("");

      const storedToken = await AsyncStorage.getItem("accessToken");
      const authToken = token?.token || storedToken;

      if (!authToken) {
        setBillingError("No access token found. Please log in again.");
        return;
      }

      const billingEndpoint = `${API}/providers/me/billing/bookings`;

      const [bookingsRes, summaryRes] = await Promise.all([
        axios.get(billingEndpoint, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        axios
          .get(`${API}/providers/me/summary`, {
            headers: { Authorization: `Bearer ${authToken}` },
          })
          .catch(() => null),
      ]);

      const bookingList = Array.isArray(bookingsRes.data)
        ? bookingsRes.data
        : bookingsRes.data?.bookings || bookingsRes.data?.results || [];

      const summaryData = summaryRes?.data || null;
      setBillingSummary(summaryData);

      const creditBalance = Math.max(
        Number(summaryData?.total_credit_balance_gyd) || 0,
        0
      );

      const resolvedChargePct = resolveServiceChargePct(summaryData);
      setServiceChargePct(resolvedChargePct);

      buildBills(bookingList, resolvedChargePct, creditBalance);
    } catch (err) {
      console.log("Error loading billing", err.response?.data || err.message);
      setBillingError("Could not load billing statements.");
      if (showFlash) {
        showFlash("error", "Could not load billing statements.");
      }
    } finally {
      setBillingLoading(false);
    }
  }, [buildBills, showFlash, token?.token]);

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

  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const outstandingFees =
    now >= endOfMonth ? billingSummary?.total_fees_due_gyd || 0 : 0;

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

      {!billingLoading && !billingError && bills.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.serviceMeta}>No billing statements yet.</Text>
        </View>
      )}

      {!billingLoading &&
        !billingError &&
        bills.map((bill) => (
          <View key={bill.id} style={styles.billingCard}>
            <View style={styles.billingHeaderRow}>
              <View>
                <Text style={styles.billingMonth}>
                  {bill.coverageStart.toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
                <Text style={styles.billingMeta}>
                  Coverage {formatDate(bill.coverageStart)} – {formatDate(bill.coverageEnd)}
                </Text>
              </View>

              <Text
                style={[
                  styles.billingStatus,
                  bill.status === "Generated"
                    ? styles.billingStatusReady
                    : styles.billingStatusUpcoming,
                ]}
              >
                {bill.status}
              </Text>
            </View>

            <Text style={styles.billingMeta}>
              Invoice date (auto on the 1st): {formatDate(bill.invoiceDate)}
            </Text>

           <TouchableOpacity
              style={styles.billingToggleRow}
              onPress={() => toggleBillExpanded(bill.id)}
            >
              <Text style={styles.billingToggleText}>
                {expandedBills[bill.id] ? "Hide services" : "Show services"}
              </Text>
              <Ionicons
                name={expandedBills[bill.id] ? "chevron-up" : "chevron-down"}
                size={18}
                color="#0B6BF2"
              />
            </TouchableOpacity>

            {expandedBills[bill.id] ? (
              <View style={styles.billingLineItems}>
                {bill.lineItems.map((item) => (
                  <View
                    key={item.bookingId || item.description}
                    style={styles.billingLineItem}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billingLineLabel}>{item.description}</Text>
                      {item.client ? (
                        <Text style={styles.billingMeta}>Client: {item.client}</Text>
                      ) : null}
                      {item.date ? (
                        <Text style={styles.billingMeta}>
                          Service date: {formatDate(item.date)}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.billingAmount}>{formatMoney(item.amount)}</Text>

                  </View>
                   ))}
              </View>
            ) : null}

            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>Services total</Text>
              <Text style={styles.billingTotalsValue}>
                {formatMoney(bill.servicesTotal)}
              </Text>
            </View>
            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>
                Platform fee ({serviceChargePct}%)
              </Text>
              <Text style={styles.billingTotalsValue}>
                {formatMoney(bill.platformFee)}
              </Text>
            </View>
              <View style={styles.billingTotalsRow}>
                <Text style={styles.billingTotalsLabel}>Bill credits</Text>
                <Text style={styles.billingTotalsValue}>
                  -{formatMoney(bill.billCreditsApplied)}
                </Text>
              </View>
            <View style={styles.billingTotalsRow}>
              <Text style={styles.billingTotalsLabel}>Total due</Text>
              <Text style={styles.billingTotalsValue}>{formatMoney(bill.totalDue)}</Text>
            </View>
          </View>
        ))}
    </ScrollView>
  );
}


// Tabs after login
function MainApp({ token, setToken, showFlash }) {
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
    <NavigationContainer linking={linking}>
      {token.isProvider ? (
        // 👇 Provider view: Dashboard + Billing + Profile
        <Tab.Navigator
          initialRouteName="Dashboard"
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowLabel: true,
            tabBarActiveTintColor: "#0B6BF2",
            tabBarInactiveTintColor: "#A1A1A1",
            tabBarStyle: {
              backgroundColor: "#FFFFFF",
              height: 70,
              paddingBottom: 25,
              paddingTop: 8,
              borderTopWidth: 0,
              shadowColor: "#000",
              shadowOpacity: 0.05,
              shadowRadius: 8,
              elevation: 4,
              marginBottom: Platform.OS === "android" ? 8 : 0,
            },
            tabBarIcon: ({ color }) => {
              let iconName = "home-outline";

              if (route.name === "Dashboard") iconName = "speedometer-outline";
              else if (route.name === "Billing") iconName = "card-outline";
              else if (route.name === "Profile") iconName = "person-outline";

              return <Ionicons name={iconName} size={24} color={color} />;
            },
          })}
        >
          <Tab.Screen name="Dashboard">
            {() => (
              <ProviderDashboardScreen token={token} showFlash={showFlash} />
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
                token={token}
                setToken={setToken}
                showFlash={showFlash}
              />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="ProviderPublicProfile"
            component={ProviderPublicProfile}
            options={{ tabBarButton: () => null, tabBarStyle: { display: "none" } }}
          />
        </Tab.Navigator>
      ) : (
        // 👇 Client view: Profile + Search
        <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarShowLabel: true,
              tabBarActiveTintColor: "#0B6BF2",
              tabBarInactiveTintColor: "#A1A1A1",
              tabBarStyle: {
                backgroundColor: "#FFFFFF",
                height: 70,
                paddingBottom: 25,
                paddingTop: 8,
                borderTopWidth: 0,
                shadowColor: "#000",
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 4,
                marginBottom: Platform.OS === "android" ? 8 : 0, // ⬅️ lifts bar above system buttons

              },

              tabBarIcon: ({ color, size }) => {
                let iconName;

                if (route.name === "Home") iconName = "home-outline";
                else if (route.name === "Search") iconName = "search-outline";
                else if (route.name === "Appointments") iconName = "calendar-outline";
                else if (route.name === "Profile") iconName = "person-outline";

                return <Ionicons name={iconName} size={24} color={color} />;
              },
            })}
            initialRouteName="Home"
          >
            <Tab.Screen name="Home">
              {({ navigation }) => (
                <ClientHomeScreen
                  navigation={navigation}
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
                <ProfileScreen token={token} setToken={setToken} showFlash={showFlash} />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="ProviderPublicProfile"
              component={ProviderPublicProfile}
              options={{ tabBarButton: () => null, tabBarStyle: { display: "none" } }}
            />
          </Tab.Navigator>


      )}
    </NavigationContainer>
  );
}




//Flash message component

function FlashMessage({ flash }) {
  if (!flash || !flash.text) return null;

  const isError = flash.type === "error";

  const backgroundColor = isError ? "#fee2e2" : "#dcfce7"; // red / green
  const borderColor = isError ? "#b91c1c" : "#16a34a";
  const textColor = isError ? "#7f1d1d" : "#166534";

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
  const [token, setToken] = useState(null);
  const [authMode, setAuthMode] = useState("landing"); // 'landing' | 'login' | 'signup' | 'forgot'
  const [isAdmin, setIsAdmin] = useState(false);

  const [flash, setFlash] = useState(null);

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
    }, 3000);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
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
          <MainApp token={token} setToken={setToken} showFlash={showFlash} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}




const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0fdf4",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#16a34a",
    marginBottom: 20,
  },
  input: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    color: "#0f172a",
    minHeight: 48,
    textAlignVertical: "center",
    ...Platform.select({
      android: {
        includeFontPadding: false,
      },
    }),
  },
  inputPlaceholder: {
    color: "#64748b",
  },
  forgotLink: {
    marginBottom: 6,
    alignSelf: "center",
    paddingVertical: 4,
  },
  forgotLinkText: {
    color: "#0f172a",
    textDecorationLine: "underline",
    textAlign: "center",
  },
  subtitle: { fontSize: 22, color: "#166534", marginTop: 20, textAlign: "center" },
  text: { fontSize: 18, color: "#166534", marginTop: 15, textAlign: "center" },

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
    backgroundColor: "#f0fdf4",
    padding: 20,
    paddingTop: 60,
  },
  homeCard: {
    width: "100%",
  },


  carouselList: {
    paddingVertical: 4,
    paddingRight: 12,
  },

  providerCard: {
    width: 280,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    marginRight: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardImageWrapper: {
    height: 140,
    backgroundColor: "#dcfce7",
    position: "relative",
  },

cardHeartButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 12,
    width: 36,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.9)",
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
    backgroundColor: "#16a34a",
  },
  cardBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "#ecfdf3",
    borderColor: "#bbf7d0",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardBadgeText: {
    color: "#166534",
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
    color: "#111827",
  },
  cardMeta: {
    fontSize: 12,
    color: "#4b5563",
  },
  cardMetaMuted: {
    fontSize: 12,
    color: "#94a3b8",
  },
  cardSubtitle: {
    fontSize: 13,
    color: "#111827",
  },
  cardDescription: {
    fontSize: 13,
    color: "#1f2937",
  },
  carouselActiveLabel: {
    marginTop: 12,
    fontSize: 13,
    color: "#166534",
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
    backgroundColor: "#f0fdf4",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

   homeScroll: {
    flexGrow: 1,
    backgroundColor: "#f0fdf4",
    padding: 20,
    paddingTop: 60,
  },
  homeCard: {
    width: "100%",
  },

  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#4b5563",
  },
  errorText: {
    fontSize: 16,
    color: "#b91c1c",
    textAlign: "center",
  },
  profileScroll: {
    flexGrow: 1,
    backgroundColor: "#f0fdf4",
    padding: 20,
    paddingTop: 60,
  },
  profileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  profileTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#166534",
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleBadgeAdmin: {
    backgroundColor: "#fee2e2",
    borderColor: "#b91c1c",
  },
  roleBadgeProvider: {
    backgroundColor: "#dbeafe",
    borderColor: "#1d4ed8",
  },
  roleBadgeClient: {
    backgroundColor: "#dcfce7",
    borderColor: "#16a34a",
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  card: {
    backgroundColor: "#ffffff",
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
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: {
    fontSize: 17,
    fontWeight: "500",
    color: "#111827",
    marginTop: 4,
  },
  adminBox: {
    backgroundColor: "#ecfdf3",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  adminTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#166534",
    marginBottom: 4,
  },
  adminText: {
    fontSize: 14,
    color: "#4b5563",
  },
  actionsContainer: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#166534",
    marginBottom: 10,
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
    backgroundColor: "#ecfdf3",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  carouselBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#166534",
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
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  carouselAvatarInitial: {
    fontSize: 28,
    fontWeight: "700",
    color: "#166534",
  },
  carouselNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  carouselButton: {
    backgroundColor: "#dcfce7",
    borderColor: "#bbf7d0",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  carouselButtonDisabled: {
    opacity: 0.5,
  },
  carouselButtonText: {
    color: "#166534",
    fontWeight: "600",
  },
  carouselCounter: {
    fontSize: 14,
    color: "#166534",
    fontWeight: "600",
  },

  actionButton: {
    backgroundColor: "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    marginBottom: 10,
    alignItems: "center",
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#166534",
  },
  logoutButton: {
    backgroundColor: "#fee2e2",
    borderColor: "#b91c1c",
    marginTop: 10,
  },
  logoutButtonText: {
    color: "#b91c1c",
  },

    toggleRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  toggleLabel: {
    fontSize: 14,
    color: "#166534",
    marginRight: 8,
  },

    providerScroll: {
    flexGrow: 1,
    backgroundColor: "#f0fdf4",
    padding: 20,
    paddingTop: 60,
  },
  subtitleSmall: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  serviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },

favoriteToggleButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },

  serviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  serviceMeta: {
    fontSize: 13,
    color: "#6b7280",
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#166534",
  },
  serviceHint: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 8,
  },

    workingHoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  hoursInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 60,
    textAlign: "center",
    marginHorizontal: 4,
    backgroundColor: "white",
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
    backgroundColor: "#22c55e",
  },
  hoursFlashError: {
    backgroundColor: "#ef4444",
  },
  hoursFlashText: {
    color: "white",
    fontSize: 13,
    textAlign: "center",
  },

  hoursHelp: {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 4,
  marginBottom: 8,
},

appointmentScroll: {
    padding: 24,
    backgroundColor: "#EAFDF4",
    flexGrow: 1,
  },
  appointmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  refreshText: {
    color: "#16a34a",
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
    borderTopColor: "#e5e7eb",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  appointmentTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#065f46",
  },
  appointmentMeta: {
    fontSize: 13,
    color: "#4b5563",
    marginTop: 4,
  },

 appointmentCancelButton: {
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 6,
  backgroundColor: "#FCE4E4", // soft light red
  alignSelf: "flex-start",
},

appointmentCancelButtonText: {
  color: "#C62828", // darker red text
  fontSize: 12,
  fontWeight: "600",
},

  appointmentStatus: {
    marginTop: 6,
    fontSize: 12,
    color: "#0f172a",
    fontWeight: "600",
  },
  appointmentNavigate: {
    paddingLeft: 12,
    justifyContent: "center",
  },
  appointmentCount: {
    fontSize: 13,
    color: "#6b7280",
  },

  bookingRow: {
  marginTop: 8,
  paddingTop: 8,
  borderTopWidth: 1,
  borderTopColor: "#e5e7eb",
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
  color: "#6b7280",
},
bookingService: {
  fontSize: 16,
  fontWeight: "600",
  color: "#065f46",
  marginTop: 2,
},
bookingMeta: {
  fontSize: 13,
  color: "#6b7280",
  marginTop: 2,
},
bookingActions: {
  alignItems: "flex-end",
},
bookingEdit: {
  fontSize: 12,
  color: "#16a34a",
},
bookingCancel: {
  fontSize: 12,
  color: "#b91c1c",
  marginTop: 4,
},

  bookingNavigate: {
    fontSize: 12,
    color: "#0284C7", // blue-ish link color
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
  backgroundColor: "#007AFF",
  paddingVertical: 10,
  paddingHorizontal: 18,
  borderRadius: 999,                 // pill shape
  alignItems: "center",
  justifyContent: "center",
},

navigateButtonText: {
  color: "#fff",                 // IOS blue
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
  borderColor: "#bbf7d0",
},

  providerScroll: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 40,
    backgroundColor: "#F2FFF2",
  },
  card: {
    backgroundColor: "#ffffff",
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
    color: "#064E3B",
    marginBottom: 4,
  },
  subtitleSmall: {
    fontSize: 14,
    color: "#4B5563",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#065F46",
    marginBottom: 8,
  },
  profileLinkBox: {
    width: "100%",
    padding: 12,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 10,
    marginBottom: 12,
  },
  profileLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    gap: 12,
  },
  profileLinkText: {
    flex: 1,
    fontSize: 14,
    color: "#065F46",
    fontWeight: "600",
  },
  profileLinkCopy: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#16A34A",
  },
  profileLinkCopyText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  serviceRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: "#F9FAFB",
    flexDirection: "row",
  },
  serviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  serviceMeta: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: "700",
    color: "#047857",
  },
  serviceHint: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    color: "#DC2626",
    marginTop: 4,
  },
  datePill: {
    width: 60,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  datePillSelected: {
    backgroundColor: "#059669",
    borderColor: "#059669",
  },
  datePillDisabled: {
    backgroundColor: "#E5E7EB",
    borderColor: "#E5E7EB",
    opacity: 0.6,
  },
  datePillDow: {
    fontSize: 11,
    color: "#4B5563",
  },
  datePillDay: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
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
    borderColor: "#D1D5DB",
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: "#ffffff",
  },
  timeSlotLabel: {
    fontSize: 13,
    color: "#111827",
  },

  timeSlotButtonSelected: {
  backgroundColor: "#059669",
  borderColor: "#059669",
},
timeSlotLabelSelected: {
  color: "#ffffff",
},

bookButton: {
  marginTop: 12,
  paddingVertical: 12,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#16a34a",
},
bookButtonDisabled: {
  backgroundColor: "#9CA3AF",
},
bookButtonLabel: {
  fontSize: 15,
  fontWeight: "600",
  color: "#ffffff",
  
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
  borderColor: "#D1D5DB",
  backgroundColor: "#F9FAFB",
  marginRight: 6,
  marginBottom: 6,
},
professionChipSelected: {
  backgroundColor: "#16a34a",
  borderColor: "#16a34a",
},
professionChipText: {
  fontSize: 12,
  color: "#374151",
},
professionChipTextSelected: {
  color: "#ffffff",
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
  backgroundColor: "#16a34a",
},
customProfessionAddText: {
  color: "#ffffff",
  fontSize: 13,
  fontWeight: "600",
},

radiusPill: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#D1D5DB",
  backgroundColor: "#ffffff",
  marginRight: 8,
},
radiusPillSelected: {
  backgroundColor: "#16a34a",
  borderColor: "#16a34a",
},
radiusPillText: {
  fontSize: 12,
  color: "#374151",
},
radiusPillTextSelected: {
  color: "#ffffff",
  fontWeight: "600",
},

hoursInput: {
  // whatever you already have
  borderWidth: 1,
  borderColor: "#ccc",
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
},

hoursInputFocused: {
  borderColor: "#007AFF", // iOS blue
},

providerSummaryCard: {
  backgroundColor: "#FFFFFF",
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
  color: "#666",
},

providerSummaryValue: {
  fontSize: 17,
  fontWeight: "600",
  color: "#111",
},

providerBillingScroll: {
  flexGrow: 1,
  backgroundColor: "#f0fdf4",
  padding: 20,
  paddingTop: 60,
},

billingCard: {
  backgroundColor: "#ffffff",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: "#e5e7eb",
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
  color: "#111827",
},

billingMeta: {
  fontSize: 13,
  color: "#6b7280",
},

billingStatus: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: "700",
},

billingStatusReady: {
  backgroundColor: "#ecfdf3",
  color: "#166534",
  borderColor: "#bbf7d0",
  borderWidth: 1,
},

billingStatusUpcoming: {
  backgroundColor: "#eff6ff",
  color: "#1d4ed8",
  borderColor: "#bfdbfe",
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
  color: "#0B6BF2",
  marginRight: 6,
},


billingLineItems: {
  marginTop: 12,
  borderTopWidth: 1,
  borderTopColor: "#e5e7eb",
  paddingTop: 8,
},

billingLineItem: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: "#f3f4f6",
},

billingLineLabel: {
  fontSize: 15,
  fontWeight: "600",
  color: "#111827",
  marginBottom: 2,
},

billingAmount: {
  fontSize: 15,
  fontWeight: "700",
  color: "#111827",
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
  color: "#374151",
},

billingTotalsValue: {
  fontSize: 16,
  fontWeight: "700",
  color: "#111827",
},

  providerAvatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: "#dcfce7",
  },
  providerAvatarSmallFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  providerAvatarSmallInitial: {
    fontSize: 18,
    fontWeight: "600",
    color: "#166534",
  },

    profileAvatarWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileAvatarImage: {
    width: "100%",
    height: "100%",
  },
  profileAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarInitial: {
    fontSize: 26,
    fontWeight: "700",
    color: "#166534",
  },

  authPrimaryButton: {
  backgroundColor: "#16a34a",
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
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "600",
},

authSecondaryButton: {
  backgroundColor: "#166534",
  paddingVertical: 14,
  borderRadius: 6,
  alignItems: "center",
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 3,
  elevation: 3,
},

authSecondaryButtonText: {
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "600",
},

  avoider: {
    flex: 1,
    backgroundColor: "#EAFDF4", // your light background
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
    color: "#16a34a",
    marginBottom: 16,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "#ffffff",
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
    backgroundColor: "#E5E7EB",
  },
  catalogCaption: {
    fontSize: 11,
    color: "#4B5563",
    marginTop: 4,
  },
  catalogDeleteText: {
    fontSize: 11,
    color: "#DC2626",
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
    backgroundColor: "#e5e7eb",
  },




})

export default App;
