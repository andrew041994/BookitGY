#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iosProjectPath = path.resolve(__dirname, '../ios/BookitGY.xcodeproj/project.pbxproj');
const androidGradlePath = path.resolve(__dirname, '../android/app/build.gradle');

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseSemver(version) {
  const match = SEMVER_REGEX.exec(version);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function computeNextVersion(currentVersion, mode, explicitVersion) {
  if (mode === 'set') {
    if (!explicitVersion) {
      fail('Missing value for --set <X.Y.Z>.');
    }

    if (!parseSemver(explicitVersion)) {
      fail(`Invalid explicit version "${explicitVersion}". Expected X.Y.Z.`);
    }

    return explicitVersion;
  }

  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    fail(`Current version "${currentVersion}" is not valid X.Y.Z semver.`);
  }

  if (mode === 'major') {
    return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  }

  if (mode === 'minor') {
    return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }

  return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
}

function parseArgs(argv) {
  let mode = 'patch';
  let explicitVersion = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--patch') {
      mode = 'patch';
      continue;
    }

    if (arg === '--minor') {
      mode = 'minor';
      continue;
    }

    if (arg === '--major') {
      mode = 'major';
      continue;
    }

    if (arg === '--set') {
      mode = 'set';
      explicitVersion = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    fail(`Unknown argument "${arg}".`);
  }

  if (mode === 'set' && !explicitVersion) {
    fail('Missing value for --set <X.Y.Z>.');
  }

  return { mode, explicitVersion, dryRun };
}

function readFileStrict(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`Unable to read file: ${filePath}\n${error.message}`);
  }
}

function writeFileStrict(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    fail(`Unable to write file: ${filePath}\n${error.message}`);
  }
}

function unique(values) {
  return [...new Set(values)];
}

const { mode, explicitVersion, dryRun } = parseArgs(process.argv.slice(2));

const iosContent = readFileStrict(iosProjectPath);
const androidContent = readFileStrict(androidGradlePath);

const iosMatches = [...iosContent.matchAll(/MARKETING_VERSION = (\d+\.\d+\.\d+);/g)];
if (iosMatches.length === 0) {
  fail(`No MARKETING_VERSION entries matching X.Y.Z were found in ${iosProjectPath}.`);
}

const iosVersions = unique(iosMatches.map((match) => match[1]));
if (iosVersions.length !== 1) {
  fail(`iOS MARKETING_VERSION values are inconsistent: ${iosVersions.join(', ')}.`);
}

const androidMatches = [...androidContent.matchAll(/versionName\s+(["'])(\d+\.\d+\.\d+)\1/g)];
if (androidMatches.length === 0) {
  fail(`No versionName entries matching X.Y.Z were found in ${androidGradlePath}.`);
}

const androidVersions = unique(androidMatches.map((match) => match[2]));
if (androidVersions.length !== 1) {
  fail(`Android versionName values are inconsistent: ${androidVersions.join(', ')}.`);
}

const iosVersion = iosVersions[0];
const androidVersion = androidVersions[0];

if (!parseSemver(iosVersion) || !parseSemver(androidVersion)) {
  fail(`Found invalid semver values. iOS: "${iosVersion}", Android: "${androidVersion}".`);
}

if (iosVersion !== androidVersion) {
  fail(`Version mismatch. iOS MARKETING_VERSION is "${iosVersion}" while Android versionName is "${androidVersion}".`);
}

const currentVersion = iosVersion;
const nextVersion = computeNextVersion(currentVersion, mode, explicitVersion);

const updatedIosContent = iosContent.replace(
  /(MARKETING_VERSION = )\d+\.\d+\.\d+(;)/g,
  `$1${nextVersion}$2`,
);

const updatedAndroidContent = androidContent.replace(
  /(versionName\s+)(["'])\d+\.\d+\.\d+\2/g,
  `$1$2${nextVersion}$2`,
);

const modifiedFiles = [];

if (updatedIosContent !== iosContent) {
  modifiedFiles.push(path.relative(path.resolve(__dirname, '..'), iosProjectPath));
}

if (updatedAndroidContent !== androidContent) {
  modifiedFiles.push(path.relative(path.resolve(__dirname, '..'), androidGradlePath));
}

if (!dryRun) {
  if (updatedIosContent !== iosContent) {
    writeFileStrict(iosProjectPath, updatedIosContent);
  }

  if (updatedAndroidContent !== androidContent) {
    writeFileStrict(androidGradlePath, updatedAndroidContent);
  }
}

console.log(`Current version: ${currentVersion}`);
console.log(`Next version: ${nextVersion}`);
if (modifiedFiles.length === 0) {
  console.log(`Modified files: none${dryRun ? ' (dry-run)' : ''}`);
} else {
  console.log(`Modified files${dryRun ? ' (would modify)' : ''}: ${modifiedFiles.join(', ')}`);
}
