import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { getRatingSummary } from "./RatingSummary";

const colors = theme.colors;

const getInitials = (name) => {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
};

const formatDistanceLabel = (distanceKm) => {
  if (typeof distanceKm !== "number") return "";
  if (!Number.isFinite(distanceKm)) return "";
  const rounded =
    distanceKm < 10
      ? distanceKm.toFixed(1)
      : Math.round(distanceKm).toString();
  return `${rounded} km away`;
};

const ProviderCard = ({
  provider,
  avatarUrl,
  onPress,
  onFavoriteToggle,
  isFavorite = false,
  ctaLabel = "View",
  onCtaPress,
  distanceKm,
  profession,
  rating,
  isSelected = false,
  style,
}) => {
  const ratingSummary = getRatingSummary(
    {
      ...(provider || {}),
      rating: rating ?? provider?.rating,
    },
    "Not yet rated"
  );
  const distanceText = distanceKm != null ? formatDistanceLabel(distanceKm) : "";
  const professionLabel =
    profession ||
    provider?.profession ||
    (provider?.professions || []).join(" · ") ||
    (provider?.services || []).join(" · ");
  const professionLine = professionLabel
  const locationLabel =
    provider?.location ||
    provider?.city ||
    provider?.address ||
    provider?.area ||
    null;
  const locationLine =
    locationLabel && distanceText && !professionLabel
      ? `${locationLabel} · ${distanceText}`
      : locationLabel;
  const initials = getInitials(provider?.name);
  const showDistanceLine =
    distanceText && !professionLabel && !locationLabel;

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.cardSelected, style]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      {typeof onFavoriteToggle === "function" ? (
        <TouchableOpacity
          style={styles.favoriteButton}
          onPress={(event) => {
            event.stopPropagation?.();
            onFavoriteToggle();
          }}
          accessibilityLabel={
            isFavorite ? "Remove from favorites" : "Save to favorites"
          }
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={18}
            color={isFavorite ? colors.error : colors.textPrimary}
          />
        </TouchableOpacity>
      ) : null}

      <View style={styles.topRow}>
        <View style={styles.avatarWrapper}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>

        <View style={styles.middleColumn}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {provider?.name || "Provider"}
            </Text>
            <Text
              style={[styles.ratingTextInline, !ratingSummary.hasRatings && styles.ratingTextMuted]}
              numberOfLines={1}
            >
              {ratingSummary.text}
            </Text>
          </View>

          {professionLine ? (
            <Text style={styles.profession} numberOfLines={4}>
              {professionLine}
            </Text>
          ) : null}

          {distanceText ? (
            <Text style={styles.distance} numberOfLines={1}>
              {distanceText}
            </Text>
          ) : null}

          {locationLine ? (
            <Text style={styles.distance} numberOfLines={1}>
              {locationLine}
            </Text>
          ) : null}

          {showDistanceLine ? (
            <Text style={styles.distance} numberOfLines={1}>
              {distanceText}
            </Text>
          ) : null}
        </View>
      </View>

      {ctaLabel ? (
        <View style={styles.bottomRow}>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={onCtaPress || onPress}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  favoriteButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(17,24,39,0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: colors.surfaceElevated,
    marginRight: 12,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  avatarInitials: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  middleColumn: {
    flex: 1,
    paddingRight: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingRight: 24,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  profession: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  distance: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  ratingTextInline: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    maxWidth: 110,
    marginRight: 8,
    flexShrink: 0,
    textAlign: "right",
  },
  ratingTextMuted: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  bottomRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  ctaButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
});

export default ProviderCard;
