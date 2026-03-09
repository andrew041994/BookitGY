import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

const colors = theme.colors;

export default function ProviderShareCard({
  avatarUrl,
  username,
  professions = [],
  ratingValue,
  brandingSource,
}) {
  const safeUsername = String(username || "").trim().replace(/^@/, "");
  const normalizedProfessions = Array.isArray(professions)
    ? professions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const professionText = normalizedProfessions.length
    ? normalizedProfessions.join(" • ")
    : "BookitGY Provider";
  const parsedRating = Number(ratingValue);
  const hasNumericRating = Number.isFinite(parsedRating);
  const normalizedRating = hasNumericRating ? parsedRating.toFixed(1) : "0.0";

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.65 }}
        style={styles.glassHighlight}
      />
      <View style={styles.topRow}>
        <View style={styles.topLeft}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{safeUsername.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={styles.topRight}>
          <Text numberOfLines={1} style={styles.rating}>⭐️ {normalizedRating}</Text>
        </View>
      </View>

      <View style={styles.middleSection}>
        {brandingSource ? <Image source={brandingSource} style={styles.logo} resizeMode="contain" /> : null}
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.username}>
          {safeUsername}
        </Text>
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.professions}>{professionText}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.divider} />
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.cta}>Download BookitGY to schedule an appointment</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    aspectRatio: 1.9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(77,163,255,0.45)",
    backgroundColor: "#121826",
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: "#4DA3FF",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  glassHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  topLeft: {
    alignSelf: "flex-start",
  },
  topRight: {
    alignSelf: "flex-start",
  },
  middleSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 10,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#202B45",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarInitial: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 30,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
    width: "100%",
    paddingHorizontal: 8,
  },
  rating: {
    color: "#FFD700",
    fontWeight: "700",
    fontSize: 18,
    marginTop: 8,
  },
  professions: {
    marginTop: 6,
    color: "#C9D4E3",
    fontSize: 14,
    lineHeight: 19,
    textAlign: "center",
    width: "100%",
    paddingHorizontal: 10,
  },
  footer: {
    paddingTop: 2,
    alignItems: "center",
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginBottom: 10,
  },
  cta: {
    color: "#E6EDF6",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    width: "94%",
    textAlign: "center",
  },
  logo: {
    width: 160,
    height: 48,
    opacity: 0.88,
  },
});
