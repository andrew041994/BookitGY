import React, { useState, useEffect } from "react";
import { Text, View, StyleSheet, TextInput, Button, Alert, ActivityIndicator, ScrollView,
  TouchableOpacity, Switch, } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import axios from "axios";
import { registerRootComponent } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API = "https://cecila-opalescent-compulsorily.ngrok-free.dev";

const ADMIN_EMAIL = "Alehandro.persaud@gmail.com";

const Tab = createBottomTabNavigator();

// 🔹 New landing/home screen shown BEFORE login
function LandingScreen({ goToLogin, goToSignup }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Guyana Booker</Text>
      <Text style={styles.subtitle}>Find and book services in Guyana</Text>

      <View style={{ marginTop: 30, width: "100%" }}>
        <View style={{ marginBottom: 10 }}>
          <Button title="Login" onPress={goToLogin} color="#16a34a" />
        </View>
        <View>
          <Button title="Sign Up" onPress={goToSignup} color="#166534" />
        </View>
      </View>
    </View>
  );
}

function LoginScreen({ setToken, goToSignup, goBack, setIsAdmin, showFlash  }) {
  const [email, setEmail] = useState("customer@guyana.com");
  const [password, setPassword] = useState("pass");

 const login = async () => {
  try {
    const body = new URLSearchParams({
      username: email,
      password: password,
    }).toString();

    const res = await axios.post(`${API}/auth/login`, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    await AsyncStorage.setItem("accessToken", res.data.access_token);

    setToken({
      token: res.data.access_token,
      userId: res.data.user_id,
      email: res.data.email,
      isProvider: res.data.is_provider,
      isAdmin: res.data.is_admin,
    });

    const emailLower = email.trim().toLowerCase();
    setIsAdmin(emailLower === ADMIN_EMAIL.toLowerCase());

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
  }
};


  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        autoCapitalize="none"
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <View style={{ width: "100%", marginBottom: 10 }}>
        <Button title="Login" onPress={login} color="#16a34a" />
      </View>

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
    if (password !== confirmPassword) {
      if (showFlash) {
        showFlash("error", "Passwords do not match");
      } else {
        Alert.alert("Error", "Passwords do not match");
      }
      return;
    }

    try {
      await axios.post(`${API}/auth/signup`, {
        email,
        password,
        full_name: username,
        phone,
        location: "Georgetown",
        whatsapp: `whatsapp:+592${phone}`,
        is_provider: isProvider, // 👈 tell backend this is a provider
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
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      {/* Username Field */}
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Phone (592XXXXXXX)"
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
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
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
  );
}



// Placeholder screens so MainApp compiles — replace with your real ones
function ProfileScreen({ setToken, showFlash }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        setError("");

        const token = await AsyncStorage.getItem("accessToken");

        if (!token) {
          setError("No access token found. Please log in again.");
          setLoading(false);
          return;
        }

        const res = await axios.get(`${API}/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        setUser(res.data);
      } catch (err) {
        console.error("Error loading profile", err);
        setError("Could not load profile.");
        if (showFlash) {
          showFlash("error", "Could not load profile information.");
        }
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

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

  const handleComingSoon = (label) => {
    if (showFlash) {
      showFlash("info", `${label} coming soon`);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.profileScroll}>
      <View style={styles.profileHeader}>
        <Text style={styles.profileTitle}>{user.full_name || "My Profile"}</Text>
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

      <View style={styles.card}>
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

      <View style={styles.actionsContainer}>
        <Text style={styles.sectionTitle}>Actions</Text>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleComingSoon("Edit profile")}
        >
          <Text style={styles.actionButtonText}>Edit profile</Text>
        </TouchableOpacity>

        {isProvider && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleComingSoon("Manage services")}
          >
            <Text style={styles.actionButtonText}>Manage services</Text>
          </TouchableOpacity>
        )}

        {!isAdmin && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleComingSoon("My bookings")}
          >
            <Text style={styles.actionButtonText}>My bookings</Text>
          </TouchableOpacity>
        )}

        {isAdmin && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleComingSoon("Admin dashboard")}
          >
            <Text style={styles.actionButtonText}>Admin dashboard</Text>
          </TouchableOpacity>
        )}

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





function SearchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search</Text>
    </View>
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
  const providerLabel = token?.email || "Provider";
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

      setServices(res.data || []);
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

  useEffect(() => {
    loadServices();
    loadBookings();
    loadWorkingHours();
  }, []);

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

    const res = await axios.get(`${API}/providers/me/hours`, {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    });

    const rows = (res.data || [])
      .slice()
      .sort((a, b) => a.weekday - b.weekday)
      .map((h) => {
        // Backend may return null/undefined/empty; use sane defaults
        const start24 = h.start_time || "09:00";
        const end24 = h.end_time || "17:00";

        return {
          ...h,
          startLocal: to12Hour(start24), // 12-hr for UI
          endLocal: to12Hour(end24),
        };
      });

    setWorkingHours(rows);
  } catch (err) {
    console.log("Error loading working hours", err.response?.data || err.message);
    setHoursError("Could not load working hours.");
    if (showFlash) showFlash("error", "Could not load working hours.");
  } finally {
    setHoursLoading(false);
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

    const payload = workingHours.map((h) => ({
      weekday: h.weekday,
      is_closed: h.is_closed,
      start_time: to24Hour(h.startLocal), // 👈 convert 12 -> 24
      end_time: to24Hour(h.endLocal),
    }));

    const res = await axios.post(`${API}/providers/me/hours`, payload, {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    });

    const rows = (res.data || [])
      .slice()
      .sort((a, b) => a.weekday - b.weekday)
      .map((h) => ({
        ...h,
        startLocal: to12Hour(h.start_time || "09:00"),
        endLocal: to12Hour(h.end_time || "17:00"),
      }));

    setWorkingHours(rows);

    if (showFlash) showFlash("success", "Working hours saved");
    setHoursFlash({ type: "success", message: "Working hours saved" });
    setTimeout(() => setHoursFlash(null), 2000);
  } catch (err) {
    console.log("Error saving working hours", err.response?.data || err.message);
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
  let time = raw.replace(/\s+/g, "");

  let h, m;

  if (time.includes(":")) {
    // Normal "h:mm" or "hh:mm"
    const parts = time.split(":");
    if (parts.length !== 2) return "";
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else if (/^\d+$/.test(time)) {
    // Only digits like "1000", "930", "10"
    if (time.length === 4) {
      // "1000" -> 10:00, "0930" -> 9:30
      h = parseInt(time.slice(0, 2), 10);
      m = parseInt(time.slice(2, 4), 10);
    } else if (time.length === 3) {
      // "930" -> 9:30
      h = parseInt(time.slice(0, 1), 10);
      m = parseInt(time.slice(1, 3), 10);
    } else if (time.length <= 2) {
      // "9" or "10" -> 9:00 / 10:00
      h = parseInt(time, 10);
      m = 0;
    } else {
      return "";
    }
  } else {
    // Invalid format
    return "";
  }

  if (isNaN(h) || isNaN(m)) return "";

  // 3) Default to AM if no suffix provided
  if (!suffix) suffix = "AM";

  // 4) Convert to 24h
  if (suffix === "PM" && h !== 12) h += 12;
  if (suffix === "AM" && h === 12) h = 0;

  // 5) Return "HH:MM"
  return `${h.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}`;
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

      await axios.post(`${API}/providers/me/services`, payload, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });

      if (showFlash) {
        showFlash("success", "Service created");
      }

      resetForm();
      setAdding(false);
      loadServices();
    } catch (err) {
      console.log("Error creating service", err.response?.data || err.message);
      if (showFlash) {
        showFlash("error", "Could not create service.");
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

  const handleCancelBooking = async (bookingId) => {
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

      if (showFlash) {
        showFlash("success", "Booking cancelled");
      }

      // Update local state so UI reflects the cancellation
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId ? { ...b, status: "cancelled" } : b
        )
      );
    } catch (err) {
      console.log("Error cancelling booking", err.response?.data || err.message);
      if (showFlash) {
        showFlash("error", "Could not cancel booking.");
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



  return (
      <View style={{ flex: 1 }}>
        {hoursFlash && (
        <View style={[
          styles.hoursFlashGlobal,
          hoursFlash.type === "error"
            ? styles.hoursFlashError
            : styles.hoursFlashSuccess,
          ]}
        >
           <Text style={styles.hoursFlashText}>{hoursFlash.message}</Text>
        
      </View>
    )}


    <ScrollView contentContainerStyle={styles.providerScroll}>
      <Text style={styles.profileTitle}>Provider dashboard</Text>
      <Text style={styles.subtitleSmall}>Welcome, {providerLabel}</Text>

      {/* Overview */}
      <View className="card" style={styles.card}>
                <Text style={styles.label}>Today</Text>
        <Text style={styles.value}>{todayBookingsCount()} bookings</Text>
        <Text style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Once bookings are added, you’ll see your daily schedule here.
        </Text>
      </View>


      {/* Upcoming bookings */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Upcoming bookings</Text>

        {bookingsLoading && (
          <View style={{ paddingVertical: 10 }}>
            <ActivityIndicator />
            <Text style={styles.serviceMeta}>Loading bookings…</Text>
          </View>
        )}

        {!bookingsLoading && bookingsError ? (
          <Text style={styles.errorText}>{bookingsError}</Text>
        ) : null}

        {!bookingsLoading && !bookingsError && bookings.length === 0 && (
          <Text style={styles.serviceHint}>
            You have no upcoming bookings yet.
          </Text>
        )}

        {!bookingsLoading &&
          !bookingsError &&
          bookings.map((b) => {
            const start = new Date(b.start_time);
            const timeStr = start.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const dateStr = start.toLocaleDateString();

            return (
              <View key={b.id} style={styles.serviceRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.serviceName}>{b.service_name}</Text>
                  <Text style={styles.serviceMeta}>
                    {dateStr} at {timeStr}
                  </Text>
                  <Text style={styles.serviceMeta}>
                    Client: {b.customer_name}
                  </Text>
                </View>
                  <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      styles.serviceMeta,
                      { textTransform: "capitalize" },
                    ]}
                  >
                    {b.status}
                  </Text>

                  {b.status !== "cancelled" && (
                    <TouchableOpacity
                      onPress={() => handleCancelBooking(b.id)}
                      style={{ marginTop: 4 }}
                    >
                      <Text style={{ fontSize: 12, color: "#b91c1c" }}>
                        Cancel
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
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
              <Button title="Save service" onPress={handleAddService} color="#16a34a" />
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
            You have no services yet. Tap “+ Add” to create your first service.
          </Text>
        )}

        {!loading &&
          !servicesError &&
          services.map((s) => (
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
                  <Text style={{ fontSize: 12, color: "#b91c1c" }}>Delete</Text>
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
        <Text style={styles.serviceMeta}>Loading working hours…</Text>
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
                        row.id === h.id ? { ...row, is_closed: !val } : row
                      )
                    );
                  }}
                />
              </View>
            </View>

            {!h.is_closed && (
              <View style={{ alignItems: "flex-end" }}>
                <View style={{ flexDirection: "row" }}>
                  <TextInput
                    style={styles.hoursInput}
                    value={h.startLocal || ""}
                    onChangeText={(text) => {
                      setWorkingHours((prev) =>
                        prev.map((row) =>
                          row.id === h.id ? { ...row, startLocal: text } : row
                        )
                      );
                    }}
                    placeholder="9:00 AM"
                  />
                  <Text style={styles.serviceMeta}> - </Text>
                  <TextInput
                    style={styles.hoursInput}
                    value={h.endLocal || ""}
                    onChangeText={(text) => {
                      setWorkingHours((prev) =>
                        prev.map((row) =>
                          row.id === h.id ? { ...row, endLocal: text } : row
                        )
                      );
                    }}
                    placeholder="5:00 PM"
                  />
                </View>
              </View>
            )}
          </View>
        );
      })}

    {!hoursLoading && !hoursError && (
      <View style={{ width: "100%", marginTop: 8 }}>
        <Button
          title="Save working hours"
          onPress={saveWorkingHours}
          color="#16a34a"
        />
      </View>
    )}
  </View>
)}



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
          onPress={() => {
            if (showFlash) showFlash("info", "Bookings view coming soon");
          }}
        >
          <Text style={styles.actionButtonText}>View upcoming bookings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            if (showFlash) showFlash("info", "Provider profile editor coming soon");
          }}
        >
          <Text style={styles.actionButtonText}>Edit provider profile</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </View>
  );
}

// Tabs after login
function MainApp({ token, setToken, showFlash }) {
  return (
    <NavigationContainer>
      {token.isProvider ? (
 		   <Tab.Navigator initialRouteName="Dashboard">
    			<Tab.Screen name="Dashboard">
      				{() => <ProviderDashboardScreen />}
    			</Tab.Screen>
   		<Tab.Screen name="Profile">
     		 {() => <ProfileScreen setToken={setToken} showFlash={showFlash} />}
    	</Tab.Screen>
  </Tab.Navigator>
) : (
  <Tab.Navigator initialRouteName="Profile">
    <Tab.Screen name="Profile">
      {() => <ProfileScreen setToken={setToken} showFlash={showFlash} />}
    </Tab.Screen>
    <Tab.Screen name="Search">
      {() => <SearchScreen token={token} />}
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


// 🔹 App orchestrates landing/login/signup vs main app
function App() {
  const [token, setToken] = useState(null);
  const [authMode, setAuthMode] = useState("landing"); // 'landing' | 'login' | 'signup'
    const [isAdmin, setIsAdmin] = useState(false);       // 👈 add this

	//flash state plus helper
	 const [flash, setFlash] = useState(null);

  const showFlash = (type, text) => {
    setFlash({ type, text });
    setTimeout(() => {
      setFlash(null);
    }, 3000); // hide after 3s
  };


  if (!token) {
    if (authMode === "landing") {
      return (
        <LandingScreen
          goToLogin={() => setAuthMode("login")}
          goToSignup={() => setAuthMode("signup")}
        />
      );
    }

      if (!token) {
    return (
      <>
        <FlashMessage flash={flash} />
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
      </>
    );
  }
}

  // When logged in
  return (
    <>
      <FlashMessage flash={flash} />
      <MainApp token={token} setToken={setToken}  showFlash={showFlash}/>
    </>
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
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#bbf7d0",
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





});

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: "#F2FFF2",
//     paddingHorizontal: 20,
//     paddingTop: 40,
//   },
//   center: {
//     flex: 1,
//     backgroundColor: "#F2FFF2",
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   screenTitle: {
//     fontSize: 26,
//     fontWeight: "700",
//     textAlign: "center",
//     marginBottom: 24,
//     color: "#008538",
//   },
//   loadingText: {
//     marginTop: 12,
//     fontSize: 16,
//     color: "#555",
//   },
//   errorText: {
//     fontSize: 16,
//     color: "red",
//     textAlign: "center",
//     paddingHorizontal: 24,
//   },
//   card: {
//     backgroundColor: "#FFFFFF",
//     borderRadius: 12,
//     padding: 16,
//     shadowColor: "#000",
//     shadowOpacity: 0.05,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 3 },
//     elevation: 3,
//   },
//   label: {
//     fontSize: 14,
//     color: "#666",
//     textTransform: "uppercase",
//     letterSpacing: 0.8,
//   },
//   value: {
//     fontSize: 18,
//     fontWeight: "600",
//     color: "#222",
//     marginTop: 4,
//   },
//   adminRole: {
//     color: "#008538",
//   },
//   adminBox: {
//     marginTop: 24,
//     padding: 16,
//     borderRadius: 12,
//     backgroundColor: "#E3F9E8",
//   },
//   adminTitle: {
//     fontSize: 18,
//     fontWeight: "700",
//     marginBottom: 8,
//     color: "#006B2C",
//   },
//   adminText: {
//     fontSize: 14,
//     color: "#335533",
//   },
// });

registerRootComponent(App);
