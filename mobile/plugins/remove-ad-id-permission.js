const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withRemoveAdIdPermission(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] =
      manifest.$["xmlns:tools"] ||
      "http://schemas.android.com/tools";

    const permissionsToRemove = [
      "com.google.android.gms.permission.AD_ID",
      "android.permission.ACCESS_ADSERVICES_AD_ID",
      "android.permission.ACCESS_ADSERVICES_TOPICS",
      "android.permission.ACCESS_ADSERVICES_CUSTOM_AUDIENCE",
      "android.permission.ACCESS_ADSERVICES_ATTRIBUTION",
    ];

    manifest["uses-permission"] =
      (manifest["uses-permission"] || []).concat(
        permissionsToRemove.map((name) => ({
          $: {
            "android:name": name,
            "tools:node": "remove",
          },
        }))
      );

    return config;
  });
};
