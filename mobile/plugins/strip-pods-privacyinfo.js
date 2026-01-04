const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

function findPbxprojFiles(iosDir) {
  const pbxprojFiles = new Set();

  const entries = fs.readdirSync(iosDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(".xcodeproj")) {
      const candidate = path.join(iosDir, entry.name, "project.pbxproj");
      if (fs.existsSync(candidate)) {
        pbxprojFiles.add(candidate);
      }
    }
  }

  const podsPbxproj = path.join(iosDir, "Pods", "Pods.xcodeproj", "project.pbxproj");
  if (fs.existsSync(podsPbxproj)) {
    pbxprojFiles.add(podsPbxproj);
  }

  return Array.from(pbxprojFiles);
}

function collectPrivacyFileRefs(content) {
  const fileRefs = new Set();
  const fileRefRegex = /([A-F0-9]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = {[^}]*?};/g;
  let match;

  while ((match = fileRefRegex.exec(content))) {
    fileRefs.add(match[1]);
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
  let removed = 0;
  for (const id of ids) {
    const entryPattern = `\\n?\\s*${id} /\\*[^*]*${label}[^*]*\\*/ = {[^}]*?};\\n?`;
    const entryRegex = new RegExp(entryPattern, "g");
    const matches = content.match(entryRegex);
    if (matches) {
      removed += matches.length;
      content = content.replace(entryRegex, "\n");
    }
  }
  return { content, removed };
}

function stripResourcesReferences(content, buildFiles) {
  let removed = 0;
  for (const id of buildFiles) {
    const resourceRegex = new RegExp(
      `\\n?\\s*${id} /\\* PrivacyInfo\\.xcprivacy in Resources \\*/,?\\n`,
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

function processPbxproj(pbxprojPath) {
  let original;
  try {
    original = fs.readFileSync(pbxprojPath, "utf8");
  } catch (error) {
    return;
  }

  const fileRefsToRemove = collectPrivacyFileRefs(original);
  if (fileRefsToRemove.size === 0) return;

  const buildFilesToRemove = collectBuildFilesForRefs(original, fileRefsToRemove);

  let updated = original;
  const buildFilesStrip = stripEntries(
    updated,
    buildFilesToRemove,
    "PrivacyInfo.xcprivacy in Resources"
  );
  updated = buildFilesStrip.content;

  const fileRefsStrip = stripEntries(updated, fileRefsToRemove, "PrivacyInfo.xcprivacy");
  updated = fileRefsStrip.content;

  const resourcesStrip = stripResourcesReferences(updated, buildFilesToRemove);
  updated = resourcesStrip.content;

  if (updated !== original) {
    fs.writeFileSync(pbxprojPath, updated);
  }

  const totalRemoved = buildFilesStrip.removed + fileRefsStrip.removed + resourcesStrip.removed;
  console.log(
    `[strip-pods-privacyinfo] Removed ${totalRemoved} PrivacyInfo.xcprivacy references from ${path.relative(
      process.cwd(),
      pbxprojPath
    )}`
  );
}

module.exports = function withStripPodsPrivacyInfo(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const iosDir = config.modRequest.platformProjectRoot;
      const pbxprojPaths = findPbxprojFiles(iosDir);

      for (const pbxprojPath of pbxprojPaths) {
        processPbxproj(pbxprojPath);
      }

      return config;
    },
  ]);
};
