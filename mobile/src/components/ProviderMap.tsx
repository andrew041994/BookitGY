import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../theme";

const colors = theme.colors;

type ProviderMapProps = {
  latitude: number;
  longitude: number;
  height?: number;
};

export function ProviderMap({
  latitude,
  longitude,
  height = 200,
}: ProviderMapProps) {
  return (
    <View style={[styles.container, { height }]}>
      <Text style={styles.title}>Location preview</Text>
      <Text style={styles.coords}>
        Lat: {latitude.toFixed(5)}, Lng: {longitude.toFixed(5)}
      </Text>
      <Text style={styles.sub}>Map disabled temporarily (no react-native-maps on web).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  title: {
    fontWeight: "600",
    marginBottom: 4,
    color: colors.textPrimary,
  },
  coords: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sub: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: "center",
  },
});
