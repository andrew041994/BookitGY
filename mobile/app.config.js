import "dotenv/config";

console.log(">>> USING app.config.js <<<");

export default {
  name: "BookitGY",
  slug: "bookitgy",
  scheme: "bookitgy",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#16a34a",
  },
  assetBundlePatterns: ["**/*"],

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.bookitgy.app",
    buildNumber: "1",
    associatedDomains: ["applinks:bookitgy.com", "applinks:www.bookitgy.com"],
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "BookitGY uses your location to show nearby service providers and enable navigation.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Location access allows providers to share their business location with customers.",
      ITSAppUsesNonExemptEncryption: false,
    },
    config: {
      googleMapsApiKey: (process.env.IOS_GOOGLE_MAPS_API_KEY || "").trim(),

    },
  },

  android: {
    package: "com.bookitgy.app",
    versionCode: 1,
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#16a34a",
    },
    intentFilters: [
      {
        action: "VIEW",
        data: [
          {
            scheme: "https",
            host: "bookitgy.com",
            pathPrefix: "/",
          },
          {
            scheme: "https",
            host: "www.bookitgy.com",
            pathPrefix: "/",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
        autoVerify: true,
      },
    ],
    config: {
      googleMaps: {
        apiKey: (process.env.ANDROID_GOOGLE_MAPS_API_KEY || "").trim(),

      },
    },
  },

  web: { favicon: "./assets/favicon.png" },

  extra: {
    eas: {
      projectId: "ba67429b-0180-4382-bb17-633982e5a5f8",
      API_URL: process.env.API_URL || "https://bookitgy.onrender.com",
    },
  },
};
