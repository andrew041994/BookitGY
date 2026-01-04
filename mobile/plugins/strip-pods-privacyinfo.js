const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const PODFILE_MARKER = "# BOOKITGY_PRIVACYINFO_STRIP";

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

function buildPodfileSnippet(indent) {
  const lines = [
    `${indent}${PODFILE_MARKER}`,
    `${indent}pods_project = installer.pods_project`,
    `${indent}removed = 0`,
    "",
    `${indent}pods_project.targets.each do |t|`,
    `${indent}  # PBXAggregateTarget and others may not have resources build phase`,
    `${indent}  next unless t.respond_to?(:resources_build_phase)`,
    "",
    `${indent}  phase = t.resources_build_phase`,
    `${indent}  next unless phase && phase.respond_to?(:files) && phase.files`,
    "",
    `${indent}  phase.files.to_a.each do |bf|`,
    `${indent}    ref = bf.respond_to?(:file_ref) ? bf.file_ref : nil`,
    `${indent}    ref_path = ref && ref.respond_to?(:path) ? ref.path : nil`,
    `${indent}    next unless ref_path && ref_path.end_with?("PrivacyInfo.xcprivacy")`,
    "",
    `${indent}    # remove build file safely`,
    `${indent}    if phase.respond_to?(:remove_build_file)`,
    `${indent}      phase.remove_build_file(bf)`,
    `${indent}    else`,
    `${indent}      phase.files.delete(bf)`,
    `${indent}    end`,
    `${indent}    removed += 1`,
    `${indent}  end`,
    `${indent}end`,
    "",
    `${indent}pods_project.save`,
    `${indent}puts "[BookitGY] Removed #{removed} PrivacyInfo.xcprivacy resource refs from Pods project"`,
    "",
  ];

  return lines.join("\n");
}

function findPostInstallEnd(content, startIndex) {
  const remainder = content.slice(startIndex);
  const lines = remainder.split("\n");
  let depth = 0;
  let position = startIndex;

  for (const line of lines) {
    const lineStart = position;
    const doCount = (line.match(/\bdo\b/g) || []).length;
    const endCount = (line.match(/\bend\b/g) || []).length;

    depth += doCount;
    depth -= endCount;

    if (depth === 0) {
      return lineStart;
    }

    position += line.length + 1;
  }

  return null;
}

function injectPodfilePrivacyStrip(iosDir) {
  const podfilePath = path.join(iosDir, "Podfile");
  if (!fs.existsSync(podfilePath)) {
    return;
  }

  let podfileContent = fs.readFileSync(podfilePath, "utf8");

  const postInstallMatch = podfileContent.match(/^[ \t]*post_install\s+do\s*\|[^|]*\|.*$/m);

  if (postInstallMatch) {
    const postInstallStart = postInstallMatch.index;
    const endOfPostInstall = findPostInstallEnd(podfileContent, postInstallStart);

    if (endOfPostInstall === null) {
      return;
    }

    const indent = postInstallMatch[0].match(/^[ \t]*/)[0];
    const snippet = buildPodfileSnippet(`${indent}  `);
    const before = podfileContent.slice(0, endOfPostInstall);
    const after = podfileContent.slice(endOfPostInstall);

    let cleanedBefore = before;
    if (before.includes(PODFILE_MARKER)) {
      const snippetIndex = before.indexOf(snippet);
      if (snippetIndex !== -1) {
        cleanedBefore =
          before.slice(0, snippetIndex) + before.slice(snippetIndex + snippet.length);
      } else {
        const lines = before.split("\n");
        const markerIndex = lines.findIndex((line) => line.includes(PODFILE_MARKER));
        if (markerIndex !== -1) {
          cleanedBefore = lines.slice(0, markerIndex).join("\n");
        }
      }

      if (!cleanedBefore.endsWith("\n")) {
        cleanedBefore += "\n";
      }
    }

    const needsLeadingNewline = cleanedBefore.endsWith("\n") ? "" : "\n";

    podfileContent = `${cleanedBefore}${needsLeadingNewline}${snippet}${after}`;
  } else {
    const snippet = buildPodfileSnippet("  ");
    const needsLeadingNewline = podfileContent.endsWith("\n") ? "" : "\n";

    podfileContent = `${podfileContent}${needsLeadingNewline}post_install do |installer|\n${snippet}end\n`;
  }

  fs.writeFileSync(podfilePath, podfileContent);

  console.log(
    `[strip-pods-privacyinfo] Injected Podfile privacy strip logic into ${path.relative(
      process.cwd(),
      podfilePath
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

      injectPodfilePrivacyStrip(iosDir);

      return config;
    },
  ]);
};
