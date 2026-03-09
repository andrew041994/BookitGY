import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

const colors = theme.colors;

export default function ProviderShareCard({
  avatarUrl,
  username,
  professions = [],
  ratingLabel,
  brandingSource,
}) {
  const safeUsername = String(username || "@bookitgy_provider").trim();
  const professionText = Array.isArray(professions) && professions.length
    ? professions.join(" • ")
    : "BookitGY Provider";

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

        <Text numberOfLines={2} style={styles.username}>@{safeUsername.replace(/^@/, "")}</Text>
        <Text numberOfLines={1} style={styles.rating}>{ratingLabel || "★ New on BookitGY"}</Text>
        <Text numberOfLines={2} style={styles.professions}>{professionText}</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.cta}>Download BookitGY to schedule an appointment</Text>
        {brandingSource ? <Image source={brandingSource} style={styles.logo} resizeMode="contain" /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    minHeight: 620,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(77,163,255,0.45)",
    backgroundColor: "#121826",
    paddingHorizontal: 42,
    paddingVertical: 36,
    shadowColor: "#4DA3FF",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  brandName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  brandMeta: {
    color: colors.textSecondary,
    fontSize: 18,
  },
  profileContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarFallback: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "#202B45",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarInitial: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 58,
  },
  username: {
    marginTop: 24,
    color: colors.text,
    fontSize: 56,
    fontWeight: "700",
    textAlign: "center",
  },
  rating: {
    marginTop: 12,
    color: "#F4D03F",
    fontWeight: "600",
    fontSize: 28,
  },
  professions: {
    marginTop: 14,
    color: colors.textSecondary,
    fontSize: 30,
    lineHeight: 40,
    textAlign: "center",
    maxWidth: "90%",
  },
  footer: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  cta: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "600",
    flex: 1,
  },
  logo: {
    width: 120,
    height: 52,
    opacity: 0.82,
  },
});
