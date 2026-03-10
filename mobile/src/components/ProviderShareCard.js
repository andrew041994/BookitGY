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
      <View style={styles.contentWrap}>
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
          <View style={styles.logoWrap}>
            {brandingSource ? (
              <Image source={brandingSource} style={styles.logo} resizeMode="contain" />
            ) : null}
          </View>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    shadowColor: "#4DA3FF",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    position: "relative",
    overflow: "hidden",
  },
  contentWrap: {
    flex: 1,
  },
  glassHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    minHeight: 108,
  },
  topLeft: {
    width: 108,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  topRight: {
    minWidth: 120,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  middleSection: {
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 0,
    marginTop: 4,
  },
  avatar: {
    width: 106,
    height: 106,
    borderRadius: 53,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarFallback: {
    width: 106,
    height: 106,
    borderRadius: 53,
    backgroundColor: "#202B45",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarInitial: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 36,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 6,
    width: "100%",
    paddingHorizontal: 16,
  },
  rating: {
    color: "#FFD700",
    fontWeight: "800",
    fontSize: 24,
  },
  professions: {
    marginTop: 10,
    color: "#C9D4E3",
    fontSize: 20,
    lineHeight: 26,
    textAlign: "center",
    width: "100%",
    paddingHorizontal: 22,
  },
  footer: {
    marginTop: "auto",
    minHeight: 52,
    paddingTop: 0,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginBottom: 12,
  },
  cta: {
    color: "#E6EDF6",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    width: "96%",
    textAlign: "center",
  },
  logo: {
    width: "100%",
    height: "100%",
    opacity: 0.92,
  },
  logoWrap: {
    width: 240,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
