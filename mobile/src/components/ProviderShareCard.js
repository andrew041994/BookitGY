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
  const normalizedProfessions = Array.isArray(professions)
    ? professions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const professionText = normalizedProfessions.length
    ? normalizedProfessions.join(" • ")
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

        <View style={styles.contentCol}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.username}>
            @{safeUsername.replace(/^@/, "")}
          </Text>
          <Text numberOfLines={1} style={styles.rating}>{ratingLabel || "★ New on BookitGY"}</Text>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.professions}>{professionText}</Text>
        </View>
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
    minHeight: 210,
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
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  brandName: {
    color: colors.text,
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
  username: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  rating: {
    marginTop: 4,
    color: "#F4D03F",
    fontWeight: "600",
    fontSize: 14,
  },
  professions: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  footer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  cta: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    flex: 1,
  },
  logo: {
    width: 78,
    height: 28,
    opacity: 0.82,
  },
});
