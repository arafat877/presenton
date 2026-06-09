const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
} = require("@puppeteer/browsers");

const buildId = (process.env.EXPORT_CHROME_BUILD_ID || "146.0.7680.76").trim();
const cacheDir = path.join(__dirname, "..", "resources", "chromium");
const manifestPath = path.join(cacheDir, "presenton-runtime.json");

function getRevisionDir(platform) {
  return path.join(cacheDir, Browser.CHROME, `${platform}-${buildId}`);
}

function runtimeLooksComplete(executablePath) {
  if (!fs.existsSync(executablePath)) {
    return false;
  }
  if (process.platform === "darwin") {
    return macChromiumBundleLooksCodeSignReady(executablePath);
  }
  if (process.platform !== "win32") {
    return true;
  }

  const chromeDir = path.dirname(executablePath);
  return ["chrome.dll", "icudtl.dat"].every((fileName) =>
    fs.existsSync(path.join(chromeDir, fileName))
  );
}

function validateExecutable(executablePath) {
  if (!runtimeLooksComplete(executablePath)) {
    return false;
  }

  const result = spawnSync(
    executablePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-first-run",
      "--disable-extensions",
      "--dump-dom",
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 15000,
      windowsHide: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    return false;
  }
  return (result.stdout || "").toLowerCase().includes("<html");
}

function writeManifest(platform, executablePath) {
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        browser: Browser.CHROME,
        buildId,
        platform,
        nodePlatform: process.platform,
        arch: process.arch,
        executable: path.relative(cacheDir, executablePath),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function findAppBundle(executablePath) {
  let current = path.dirname(executablePath);
  while (true) {
    if (current.endsWith(".app")) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function macChromiumFrameworkPath(appBundlePath) {
  return path.join(
    appBundlePath,
    "Contents",
    "Frameworks",
    "Google Chrome for Testing Framework.framework",
  );
}

function macFrameworkLayoutLooksValid(frameworkPath) {
  if (!fs.existsSync(frameworkPath)) {
    return false;
  }
  const entries = fs.readdirSync(frameworkPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "Versions") {
      continue;
    }
    if (!isSymlink(path.join(frameworkPath, entry.name))) {
      return false;
    }
  }

  return isSymlink(path.join(frameworkPath, "Versions", "Current"));
}

function macChromiumBundleLooksCodeSignReady(executablePath) {
  const appBundlePath = findAppBundle(executablePath);
  if (!appBundlePath) {
    return false;
  }
  return macFrameworkLayoutLooksValid(macChromiumFrameworkPath(appBundlePath));
}

function ensureSymlink(linkPath, target) {
  let currentTarget = null;
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) {
      currentTarget = fs.readlinkSync(linkPath);
    }
  } catch {
    // Link path does not exist yet.
  }

  if (currentTarget === target) {
    return false;
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(target, linkPath);
  return true;
}

function getFrameworkCurrentVersion(frameworkPath) {
  const currentPath = path.join(frameworkPath, "Versions", "Current");
  if (isSymlink(currentPath)) {
    return fs.readlinkSync(currentPath);
  }

  const versionsPath = path.join(frameworkPath, "Versions");
  const versionEntries = fs
    .readdirSync(versionsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "Current")
    .map((entry) => entry.name)
    .sort();
  return versionEntries[versionEntries.length - 1] || null;
}

function normalizeFrameworkSymlinkTargets(frameworkPath, mode = "app-store") {
  if (!fs.existsSync(frameworkPath)) {
    return 0;
  }

  const versionsPath = path.join(frameworkPath, "Versions");
  if (!fs.existsSync(versionsPath)) {
    return 0;
  }

  let rewritten = 0;

  const currentPath = path.join(versionsPath, "Current");
  const currentVersion = getFrameworkCurrentVersion(frameworkPath);
  if (!currentVersion) {
    return rewritten;
  }

  if (ensureSymlink(currentPath, currentVersion)) {
    rewritten += 1;
  }

  const linkNames = new Set();
  const versionDir = path.join(versionsPath, currentVersion);
  if (fs.existsSync(versionDir)) {
    for (const entry of fs.readdirSync(versionDir, { withFileTypes: true })) {
      if (entry.name !== "_CodeSignature") {
        linkNames.add(entry.name);
      }
    }
  }
  for (const entry of fs.readdirSync(frameworkPath, { withFileTypes: true })) {
    if (entry.name !== "Versions" && entry.name !== "_CodeSignature") {
      linkNames.add(entry.name);
    }
  }

  for (const linkName of linkNames) {
    const targetVersion = mode === "copy" ? currentVersion : "Current";
    const canonicalTarget = path.join("Versions", targetVersion, linkName);
    const canonicalTargetPath = path.join(frameworkPath, canonicalTarget);
    if (!fs.existsSync(canonicalTargetPath)) {
      continue;
    }

    if (ensureSymlink(path.join(frameworkPath, linkName), canonicalTarget)) {
      rewritten += 1;
    }
  }

  return rewritten;
}

function normalizeMacBundleFrameworkSymlinks(executablePath, mode) {
  const appBundlePath = findAppBundle(executablePath);
  if (!appBundlePath || !fs.existsSync(appBundlePath)) {
    return 0;
  }

  const frameworkPath = macChromiumFrameworkPath(appBundlePath);
  return normalizeFrameworkSymlinkTargets(frameworkPath, mode);
}

function normalizeMacBundleForCopying(executablePath) {
  const rewritten = normalizeMacBundleFrameworkSymlinks(executablePath, "copy");
  if (rewritten > 0) {
    console.log(
      `[Chromium] Rewrote ${rewritten} framework symlinks to copy-friendly version targets.`,
    );
  }
  return rewritten;
}

function normalizeMacBundleForPackaging(executablePath) {
  const rewritten = normalizeMacBundleFrameworkSymlinks(executablePath, "app-store");
  if (rewritten > 0) {
    console.log(
      `[Chromium] Rewrote ${rewritten} framework symlinks to App Store canonical Versions/Current targets.`,
    );
  }
  return rewritten;
}

function normalizeBundledMacChromiumFrameworks(rootDir, mode, message) {
  if (!fs.existsSync(rootDir)) {
    return 0;
  }

  const stack = [rootDir];
  let rewritten = 0;
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === "Google Chrome for Testing Framework.framework") {
        rewritten += normalizeFrameworkSymlinkTargets(fullPath, mode);
        continue;
      }
      stack.push(fullPath);
    }
  }

  if (rewritten > 0) {
    console.log(`[Chromium] Rewrote ${rewritten} bundled macOS framework symlinks to ${message}.`);
  }
  return rewritten;
}

function normalizeBundledMacChromiumForCopying(rootDir = cacheDir) {
  return normalizeBundledMacChromiumFrameworks(
    rootDir,
    "copy",
    "copy-friendly version targets",
  );
}

function normalizeBundledMacChromiumForPackaging(rootDir = cacheDir) {
  return normalizeBundledMacChromiumFrameworks(
    rootDir,
    "app-store",
    "canonical Versions/Current targets",
  );
}

function removeIncompleteRuntime(platform, executablePath) {
  if (runtimeLooksComplete(executablePath)) {
    return;
  }

  const revisionDir = getRevisionDir(platform);
  if (!fs.existsSync(revisionDir)) {
    return;
  }

  console.log(
    `[Chromium] Removing incomplete runtime before download: ${revisionDir}`
  );
  fs.rmSync(revisionDir, { recursive: true, force: true });
}

function canUseStructurallyCompleteRuntime(executablePath) {
  return process.platform === "darwin" && runtimeLooksComplete(executablePath);
}

function warnIfExecutableSmokeTestFails(executablePath) {
  if (validateExecutable(executablePath)) {
    return true;
  }

  if (canUseStructurallyCompleteRuntime(executablePath)) {
    console.warn(
      `[Chromium] Runtime is structurally complete, but the headless smoke test failed. Keeping bundled macOS runtime: ${executablePath}`,
    );
    return false;
  }

  throw new Error(`Chromium executable validation failed at ${executablePath}`);
}

async function main() {
  if (process.env.SKIP_BUNDLED_CHROMIUM === "1") {
    console.log("[Chromium] SKIP_BUNDLED_CHROMIUM=1; leaving runtime unbundled.");
    return;
  }

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(`Unsupported platform for bundled Chromium: ${process.platform}-${process.arch}`);
  }

  const options = {
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    platform,
  };
  const executablePath = computeExecutablePath(options);
  if (runtimeLooksComplete(executablePath)) {
    normalizeMacBundleForCopying(executablePath);
    if (!validateExecutable(executablePath) && !canUseStructurallyCompleteRuntime(executablePath)) {
      removeIncompleteRuntime(platform, executablePath);
    } else {
      warnIfExecutableSmokeTestFails(executablePath);
      writeManifest(platform, executablePath);
      console.log(`[Chromium] Bundled runtime already exists: ${executablePath}`);
      return;
    }
  }

  if (runtimeLooksComplete(executablePath)) {
    normalizeMacBundleForCopying(executablePath);
  }
  if (validateExecutable(executablePath)) {
    writeManifest(platform, executablePath);
    return;
  }
  if (canUseStructurallyCompleteRuntime(executablePath)) {
    warnIfExecutableSmokeTestFails(executablePath);
    writeManifest(platform, executablePath);
    return;
  }

  removeIncompleteRuntime(platform, executablePath);
  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`[Chromium] Downloading Chrome for Testing ${buildId} into ${cacheDir}`);
  await install({
    ...options,
    downloadProgressCallback(downloadedBytes, totalBytes) {
      if (totalBytes <= 0) return;
      const percent = Math.floor((downloadedBytes / totalBytes) * 100);
      process.stdout.write(`\r[Chromium] ${percent}%`);
    },
  });
  process.stdout.write("\n");

  if (!runtimeLooksComplete(executablePath)) {
    throw new Error(`Chromium install finished, but executable was not found at ${executablePath}`);
  }
  normalizeMacBundleForCopying(executablePath);
  warnIfExecutableSmokeTestFails(executablePath);
  writeManifest(platform, executablePath);
  console.log(`[Chromium] Bundled runtime ready: ${executablePath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  normalizeBundledMacChromiumForCopying,
  normalizeBundledMacChromiumForPackaging,
  normalizeMacBundleForCopying,
  normalizeMacBundleForPackaging,
};
