const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

function findProjectFile(iosDir) {
  const entries = fs.readdirSync(iosDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(".xcodeproj")) {
      const candidate = path.join(iosDir, entry.name, "project.pbxproj");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function collectPodPrivacyFileRefs(content) {
  const fileRefs = new Set();
  const fileRefRegex = /([A-F0-9]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = {[^}]*?};/g;
  let match;

  while ((match = fileRefRegex.exec(content))) {
    const block = match[0];
    const pathMatch = block.match(/path = ([^;]+);/);
    const pathValue = pathMatch ? pathMatch[1].replace(/^"|"$/g, "") : "";
    if (pathValue.toLowerCase().includes("pods")) {
      fileRefs.add(match[1]);
    }
  }

  return fileRefs;
}

function collectBuildFilesForRefs(content, fileRefs) {
  const buildFiles = new Set();
  for (const ref of fileRefs) {
    const buildFilePattern = `([A-F0-9]{24}) /\\* PrivacyInfo\\.xcprivacy in Resources \\*/ = {[^}]*?fileRef = ${ref} /\\* PrivacyInfo\\.xcprivacy \\*/;[^}]*?};`;
    const buildFileRegex = new RegExp(buildFilePattern, "g");
    let match;
    while ((match = buildFileRegex.exec(content))) {
      buildFiles.add(match[1]);
    }
  }
  return buildFiles;
}

function stripEntries(content, ids, label) {
  for (const id of ids) {
    const entryPattern = `\\n?\\s*${id} /\\*[^*]*${label}[^*]*\\*/ = {[^}]*?};\\n?`;
    const entryRegex = new RegExp(entryPattern, "g");
    content = content.replace(entryRegex, "\n");
  }
  return content;
}

function stripResourcesReferences(content, buildFiles) {
  let removed = 0;
  for (const id of buildFiles) {
    const resourceRegex = new RegExp(
      `\n?\s*${id} /\\* PrivacyInfo\\.xcprivacy in Resources \\*/,?\n`,
      "g"
    );
    const matches = content.match(resourceRegex);
    if (matches) {
      removed += matches.length;
      content = content.replace(resourceRegex, "\n");
    }
  }
  return { content, removed };
}

module.exports = function withStripPodsPrivacyInfo(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const iosDir = config.modRequest.platformProjectRoot;
      const pbxprojPath = findProjectFile(iosDir);

      if (!pbxprojPath || !fs.existsSync(pbxprojPath)) return config;

      let original;
      try {
        original = fs.readFileSync(pbxprojPath, "utf8");
      } catch (error) {
        return config;
      }

      const fileRefsToRemove = collectPodPrivacyFileRefs(original);
      if (fileRefsToRemove.size === 0) return config;

      const buildFilesToRemove = collectBuildFilesForRefs(original, fileRefsToRemove);

      let updated = original;
      updated = stripEntries(updated, buildFilesToRemove, "PrivacyInfo.xcprivacy in Resources");
      updated = stripEntries(updated, fileRefsToRemove, "PrivacyInfo.xcprivacy");
      const { content: cleanedContent, removed } = stripResourcesReferences(
        updated,
        buildFilesToRemove
      );

      if (cleanedContent !== original) {
        fs.writeFileSync(pbxprojPath, cleanedContent);
      }

      console.log(
        `Removed ${removed} PrivacyInfo.xcprivacy references from Copy Bundle Resources`
      );

      return config;
    },
  ]);
};
