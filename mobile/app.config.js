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
  newArchEnabled: false,
  plugins: [
    "./plugins/remove-ad-id-permission",
    // [
    //   "react-native-fbsdk-next",
    //   {
    //     appID: (process.env.FACEBOOK_APP_ID || "").trim(),
    //     clientToken: (process.env.FACEBOOK_CLIENT_TOKEN || "").trim(),
    //     displayName: "BookitGY",
    //     scheme: `fb${(process.env.FACEBOOK_APP_ID || "").trim()}`,
    //     isAutoInitEnabled: true,
    //   },
    // ],
  ],

  ios: {
    deploymentTarget: "16.0",
    supportsTablet: true,
    bundleIdentifier: "com.bookitgy.app",
    buildNumber: "2",
    associatedDomains: ["applinks:bookitgy.com", "applinks:www.bookitgy.com"],
    privacyManifest: {
      NSPrivacyAccessedAPITypes: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "BookitGY uses your location to show nearby service providers and enable navigation.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Location access allows providers to share their business location with customers.",
      ITSAppUsesNonExemptEncryption: false,
    },
    config: {
      googleMapsApiKey: (process.env.IOS_GOOGLE_MAPS_API_KEY || "").trim(),
      facebookAppId: (process.env.FACEBOOK_APP_ID || "").trim(),
      facebookClientToken: (process.env.FACEBOOK_CLIENT_TOKEN || "").trim(),

    },
  },

  android: {
    package: "com.bookitgy.app",
    versionCode: 2, // bump this
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    blockedPermissions: [
    "com.google.android.gms.permission.AD_ID",
    "android.permission.ACCESS_ADSERVICES_AD_ID",
    "android.permission.ACCESS_ADSERVICES_ATTRIBUTION",
    "android.permission.ACCESS_ADSERVICES_CUSTOM_AUDIENCE",
    "android.permission.ACCESS_ADSERVICES_TOPICS",
  ],
    
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "bookitgy.com", pathPrefix: "/u" },
          { scheme: "https", host: "www.bookitgy.com", pathPrefix: "/u" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#16a34a",
    },
    config: {
      googleMaps: {
        apiKey: (process.env.ANDROID_GOOGLE_MAPS_API_KEY || "").trim(),

      },
      facebookAppId: (process.env.FACEBOOK_APP_ID || "").trim(),
      facebookClientToken: (process.env.FACEBOOK_CLIENT_TOKEN || "").trim(),
    },
  },

  web: { favicon: "./assets/favicon.png" },

  extra: {
    eas: {
      projectId: "ba67429b-0180-4382-bb17-633982e5a5f8",
      API_URL: process.env.API_URL || "https://bookitgy.onrender.com",
    },
    SENTRY_DSN: process.env.SENTRY_DSN || "",
  },
};

// iOS requires apple-app-site-association hosted at:
// https://bookitgy.com/.well-known/apple-app-site-association
// Android requires assetlinks.json hosted at:
// https://bookitgy.com/.well-known/assetlinks.json
