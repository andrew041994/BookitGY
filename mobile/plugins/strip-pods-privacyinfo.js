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

function isPodsPrivacyPath(rawPath) {
  if (!rawPath) return false;

  const normalized = rawPath.trim().replace(/^"|"$/g, "");
  const lower = normalized.toLowerCase();

  return (
    lower.includes("/pods/") ||
    lower.startsWith("pods/") ||
    lower.includes("target support files")
  );
}

function collectPrivacyFileRefs(content) {
  const fileRefs = new Set();
  const fileRefRegex = /([A-F0-9]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = {([\s\S]*?)};/g;
  let match;

  while ((match = fileRefRegex.exec(content))) {
    const refId = match[1];
    const block = match[2];
    const pathMatch = block.match(/path\s*=\s*([^;]+);/);
    const refPath = pathMatch ? pathMatch[1] : "";

    if (isPodsPrivacyPath(refPath)) {
      fileRefs.add(refId);
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
    `${indent}pods_project.targets.each do |t|`,
    `${indent}  next unless t.respond_to?(:resources_build_phase)`,
    `${indent}`,
    `${indent}  phase = t.resources_build_phase`,
    `${indent}  next unless phase && phase.respond_to?(:files) && phase.files`,
    `${indent}`,
    `${indent}  phase.files.to_a.each do |bf|`,
    `${indent}    ref = bf.respond_to?(:file_ref) ? bf.file_ref : nil`,
    `${indent}    ref_path = ref && ref.respond_to?(:path) ? ref.path : nil`,
    `${indent}    next unless ref_path && ref_path.end_with?("PrivacyInfo.xcprivacy")`,
    `${indent}`,
    `${indent}    if phase.respond_to?(:remove_build_file)`,
    `${indent}      phase.remove_build_file(bf)`,
    `${indent}    else`,
    `${indent}      phase.files.delete(bf)`,
    `${indent}    end`,
    `${indent}`,
    `${indent}    removed += 1`,
    `${indent}  end`,
    `${indent}end`,
    `${indent}pods_project.save`,
    `${indent}puts "[BookitGY] Removed #{removed} PrivacyInfo.xcprivacy resource refs from Pods project"`,
    `${indent}`,
    `${indent}scripts = Dir.glob(File.join(__dir__, "Pods", "Target Support Files", "**", "*-resources.sh"))`,
    `${indent}`,
    `${indent}removed_scripts = 0`,
    `${indent}scripts.each do |script|`,
    `${indent}  next unless File.exist?(script)`,
    `${indent}  content = File.read(script)`,
    `${indent}  next unless content.include?("PrivacyInfo.xcprivacy")`,
    "",
    `${indent}  filtered_lines = content.lines.reject do |line|`,
    `${indent}    # Remove any install_resource lines referencing PrivacyInfo.xcprivacy`,
    `${indent}    line.include?("PrivacyInfo.xcprivacy")`,
    `${indent}  end`,
    "",
    `${indent}  if filtered_lines.length != content.lines.length`,
    `${indent}    removed_scripts += (content.lines.length - filtered_lines.length)`,
    `${indent}    File.write(script, filtered_lines.join)`,
    `${indent}  end`,
    `${indent}end`,
    "",
    `${indent}puts "[BookitGY] Stripped #{removed_scripts} PrivacyInfo.xcprivacy lines from Pods resources scripts"`,
    "",
  ];

  return lines.join("\n");
}

function findHookEnd(content, startIndex) {
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

function findHook(content, hookName) {
  const hookMatch = content.match(
    new RegExp(`^[ \t]*${hookName}\\s+do\\s*\\|[^|]*\\|.*$`, "m")
  );

  if (!hookMatch) {
    return null;
  }

  const hookStart = hookMatch.index;
  const hookEnd = findHookEnd(content, hookStart);

  if (hookEnd === null) {
    return null;
  }

  return { start: hookStart, end: hookEnd, indent: hookMatch[0].match(/^[ \t]*/)[0] };
}

function removeSnippetFromHook(content, hook) {
  const { end, indent } = hook;
  const snippet = buildPodfileSnippet(`${indent}  `);
  const before = content.slice(0, end);
  const after = content.slice(end);

  if (!before.includes(PODFILE_MARKER)) {
    return content;
  }

  let cleanedBefore = before;
  const snippetIndex = before.indexOf(snippet);

  if (snippetIndex !== -1) {
    cleanedBefore = before.slice(0, snippetIndex) + before.slice(snippetIndex + snippet.length);
  } else {
    const lines = before.split("\n");
    const markerIndex = lines.findIndex((line) => line.includes(PODFILE_MARKER));
    if (markerIndex !== -1) {
      cleanedBefore = lines.slice(0, markerIndex).join("\n");
      if (!cleanedBefore.endsWith("\n")) {
        cleanedBefore += "\n";
      }
    }
  }

  return cleanedBefore + after;
}

function injectSnippetIntoHook(content, hook) {
  const { end, indent } = hook;
  const snippet = buildPodfileSnippet(`${indent}  `);

  const before = content.slice(0, end);
  const after = content.slice(end);

  const needsLeadingNewline = before.endsWith("\n") ? "" : "\n";

  return `${before}${needsLeadingNewline}${snippet}${after}`;
}

function injectPodfilePrivacyStrip(iosDir) {
  const podfilePath = path.join(iosDir, "Podfile");
  if (!fs.existsSync(podfilePath)) {
    return;
  }

  let podfileContent = fs.readFileSync(podfilePath, "utf8");

  let postInstall = findHook(podfileContent, "post_install");

  if (postInstall) {
    podfileContent = removeSnippetFromHook(podfileContent, postInstall);
    postInstall = findHook(podfileContent, "post_install");
    if (!postInstall) {
      return;
    }

    podfileContent = injectSnippetIntoHook(podfileContent, postInstall);
  } else {
    let postIntegrate = findHook(podfileContent, "post_integrate");

    if (postIntegrate) {
      podfileContent = removeSnippetFromHook(podfileContent, postIntegrate);
      postIntegrate = findHook(podfileContent, "post_integrate");
      if (!postIntegrate) {
        return;
      }

      podfileContent = injectSnippetIntoHook(podfileContent, postIntegrate);
    } else {
      const snippet = buildPodfileSnippet("  ");
      const needsLeadingNewline = podfileContent.endsWith("\n") ? "" : "\n";

      podfileContent = `${podfileContent}${needsLeadingNewline}post_integrate do |installer|\n${snippet}end\n`;
    }
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
