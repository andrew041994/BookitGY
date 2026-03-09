import React from "react";
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
      <View style={styles.brandRow}>
        <Text style={styles.brandName}>BookitGY</Text>
        <Text style={styles.brandMeta}>Provider Card</Text>
      </View>

      <View style={styles.profileContent}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{safeUsername.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <View style={styles.contentCol}>
          <View style={styles.identityRow}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.username}>
              {safeUsername}
            </Text>
            <Text numberOfLines={1} style={styles.rating}>⭐️ {normalizedRating}</Text>
          </View>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.professions}>{professionText}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.cta}>Download BookitGY to schedule an appointment</Text>
        {brandingSource ? <Image source={brandingSource} style={styles.logo} resizeMode="contain" /> : null}
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
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  brandName: {
    color: "#E6EDF6",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  brandMeta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  profileContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
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
  contentCol: {
    flex: 1,
    marginLeft: 14,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    flex: 1,
    marginRight: 10,
  },
  rating: {
    color: "#FFD700",
    fontWeight: "600",
    fontSize: 14,
  },
  professions: {
    marginTop: 6,
    color: "#C9D4E3",
    fontSize: 14,
    lineHeight: 19,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  cta: {
    color: "#E6EDF6",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  logo: {
    width: 78,
    height: 28,
    opacity: 0.82,
  },
});
