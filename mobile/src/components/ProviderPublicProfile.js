import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import axios from "axios";
import Constants from "expo-constants";

const API_BASE =
  Constants.expoConfig?.extra?.API_URL ||
  Constants.manifest?.extra?.API_URL ||
  "https://bookitgy.onrender.com";

const resolveImageUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return `${API_BASE}${normalizedPath}`;
};

export default function ProviderPublicProfile({ route, navigation }) {
  const username = route?.params?.username || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");

  const providerId = useMemo(
    () => provider?.provider_id ?? provider?.id ?? provider?._id ?? null,
    [provider]
  );

  const avatar = useMemo(() => resolveImageUrl(provider?.avatar || provider?.photo), [provider]);
  const displayName = useMemo(
    () => provider?.name || provider?.fullName || provider?.businessName || username,
    [provider, username]
  );

  useEffect(() => {
    let isActive = true;
    const fetchProvider = async () => {
      if (!username) {
        setError("Missing provider username");
        setLoading(false);
        return;
      }

      try {
        const res = await axios.get(
          `${API_BASE}/public/providers/by-username/${encodeURIComponent(username)}`
        );
        if (!isActive) return;
        setProvider(res.data?.provider || res.data);
        setError(null);
      } catch (err) {
        if (!isActive) return;
        const message =
          err?.response?.data?.message ||
          err?.response?.data?.detail ||
          err?.message ||
          "Unable to load provider profile.";
        setError(message);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    fetchProvider();
    return () => {
      isActive = false;
    };
  }, [username]);

  useEffect(() => {
    let isActive = true;
    const fetchServices = async () => {
      if (!providerId) return;

      try {
        setServicesLoading(true);
        setServicesError("");
        const res = await axios.get(`${API_BASE}/providers/${providerId}/services`);
        if (!isActive) return;
        setServices(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        if (!isActive) return;
        const message =
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err?.message ||
          "Unable to load services.";
        setServicesError(message);
      } finally {
        if (isActive) setServicesLoading(false);
      }
    };

    fetchServices();
    return () => {
      isActive = false;
    };
  }, [providerId]);

  const handleBookPress = () => {
    if (!provider) {
      Alert.alert("Unable to book", "Provider details are unavailable right now.");
      return;
    }

    if (typeof route?.params?.onBook === "function") {
      route.params.onBook(provider);
      return;
    }

    if (navigation?.navigate) {
      navigation.navigate("Search", { provider });
      return;
    }

    Alert.alert("Book", "Sign in to book a service with this provider.");
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0B6BF2" />
        <Text style={styles.statusText}>Loading profile…</Text>
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.avatarWrapper}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>{displayName?.charAt(0)?.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Text style={styles.name}>{displayName}</Text>

      {provider?.professions?.length ? (
        <Text style={styles.professions}>{provider.professions.join(" · ")}</Text>
      ) : null}

      {provider?.bio ? <Text style={styles.bio}>{provider.bio}</Text> : null}

      <TouchableOpacity style={styles.bookButton} onPress={handleBookPress}>
        <Text style={styles.bookButtonText}>Book a service</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Services</Text>
        {servicesLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={styles.statusTextInline}>Loading services…</Text>
          </View>
        ) : null}

        {!servicesLoading && servicesError ? (
          <Text style={styles.errorText}>{servicesError}</Text>
        ) : null}

        {!servicesLoading && !servicesError && services.length === 0 ? (
          <Text style={styles.emptyText}>No services listed yet.</Text>
        ) : null}

        {!servicesLoading &&
          !servicesError &&
          services.map((service) => (
            <View key={service.id} style={styles.serviceCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.serviceName}>{service.name}</Text>
                <Text style={styles.serviceMeta}>
                  {service.duration_minutes} min
                </Text>
                {service.description ? (
                  <Text style={styles.serviceMeta}>{service.description}</Text>
                ) : null}
              </View>
              {service.price_gyd != null ? (
                <Text style={styles.servicePrice}>
                  {service.price_gyd.toLocaleString()} GYD
                </Text>
              ) : null}
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  statusText: {
    marginTop: 12,
    color: "#334155",
    fontSize: 16,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 16,
    textAlign: "center",
  },
  avatarWrapper: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 16,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 48,
    color: "#0B6BF2",
    fontWeight: "700",
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "center",
  },
  professions: {
    marginTop: 6,
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
  },
  bio: {
    marginTop: 12,
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
  },
  bookButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: "#0B6BF2",
  },
  bookButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  section: {
    marginTop: 24,
    width: "100%",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  statusTextInline: {
    marginLeft: 8,
    color: "#334155",
    fontSize: 16,
  },
  emptyText: {
    color: "#64748b",
    fontSize: 14,
  },
  serviceCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  serviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  serviceMeta: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    marginLeft: 12,
  },
});
