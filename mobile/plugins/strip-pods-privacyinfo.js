const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

module.exports = function withStripPodsPrivacyInfo(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const iosDir = config.modRequest.platformProjectRoot;
      const podsDir = path.join(iosDir, "Pods", "Target Support Files");

      if (!fs.existsSync(podsDir)) return config;

      for (const entry of fs.readdirSync(podsDir)) {
        const script = path.join(
          podsDir,
          entry,
          `${entry}-resources.sh`
        );

        if (!fs.existsSync(script)) continue;

        const original = fs.readFileSync(script, "utf8");
        const filtered = original
          .split("\n")
          .filter(line => !line.includes("PrivacyInfo.xcprivacy"))
          .join("\n");

        if (filtered !== original) {
          fs.writeFileSync(script, filtered);
        }
      }

      return config;
    },
  ]);
};
