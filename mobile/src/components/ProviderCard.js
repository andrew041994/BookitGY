import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

const colors = theme.colors;

const getInitials = (name) => {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
};

const resolveRatingValue = (provider, ratingOverride) => {
  const raw =
    ratingOverride ??
    provider?.rating ??
    provider?.average_rating ??
    provider?.avg_rating ??
    provider?.rating_avg ??
    provider?.rating_value;
  if (raw == null) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
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
  const ratingValue = resolveRatingValue(provider, rating);
  const ratingLabel =
    typeof ratingValue === "number" ? ratingValue.toFixed(1) : null;
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
          <Text style={styles.name} numberOfLines={1}>
            {provider?.name || "Provider"}
          </Text>

          {professionLine ? (
            <Text style={styles.profession} numberOfLines={2}>
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

        {ratingLabel ? (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>★ {ratingLabel}</Text>
          </View>
        ) : null}
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
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
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
  ratingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
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
