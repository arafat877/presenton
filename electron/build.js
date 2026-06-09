const builder = require("electron-builder")
const { signAsync } = require("@electron/osx-sign")
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const packageMetadata = require("./package.json")
const {
  normalizeBundledMacChromiumForCopying,
  normalizeBundledMacChromiumForPackaging,
} = require("./scripts/prepare-export-chromium.cjs")

const APP_ID = "com.presenton.presenton"
const TEAM_ID = "S6W5C54KL6"
const macTarget = process.env.PRESENTON_MAC_TARGET
const masDevProvisioningProfile = resolveProvisioningProfileForTarget({
  target: "mas-dev",
  label: "MAS development",
  candidates: [
    "build/AppleDevelopment.provisionprofile",
    "build/AppleDev.provisionprofile",
    "build/AppDev.provisionprofile",
  ],
})
const masProvisioningProfile = resolveProvisioningProfileForTarget({
  target: "mas",
  label: "Mac App Store distribution",
  candidates: [
    "build/AppDistri.provisionprofile",
    "build/MacAppStore.provisionprofile",
  ],
})
// A blank explicit qualifier makes electron-builder auto-discover Apple Development
// identities without falling back to a distribution CSC_NAME value.
const masDevIdentity = process.env.PRESENTON_MAS_DEV_IDENTITY || " "
const masDistributionIdentity =
  process.env.PRESENTON_MAS_DISTRIBUTION_IDENTITY ||
  process.env.PRESENTON_MAS_IDENTITY ||
  TEAM_ID
const appStoreBundleShortVersion =
  macTarget === "mas" ? getAppStoreBundleShortVersion() : undefined
const appStoreBundleVersion =
  macTarget === "mas"
    ? getAppStoreBundleVersion(appStoreBundleShortVersion)
    : undefined

function getAppStoreBundleShortVersion() {
  const configuredVersion = process.env.PRESENTON_APP_STORE_VERSION
  if (configuredVersion) {
    validateAppStoreVersion(configuredVersion, "PRESENTON_APP_STORE_VERSION")
    return configuredVersion
  }

  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(packageMetadata.version)
  if (!match) {
    throw new Error(
      `Cannot derive an App Store version from package version "${packageMetadata.version}". Set PRESENTON_APP_STORE_VERSION to three period-separated integers, for example 1.0.0.`
    )
  }
  return `${match[1]}.${match[2]}.${match[3]}`
}

function getAppStoreBundleVersion(bundleShortVersion) {
  const configuredBuild = process.env.PRESENTON_APP_STORE_BUILD
  if (configuredBuild) {
    validateAppStoreBuild(configuredBuild, "PRESENTON_APP_STORE_BUILD")
    return configuredBuild
  }
  return bundleShortVersion
}

function validateAppStoreVersion(value, source) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(
      `${source} must be three period-separated integers, for example 1.0.0. Received: ${value}`
    )
  }
}

function validateAppStoreBuild(value, source) {
  if (!/^\d+(\.\d+){0,2}$/.test(value)) {
    throw new Error(
      `${source} must be one to three period-separated integers, for example 42 or 1.0.1. Received: ${value}`
    )
  }
}

function resolveProvisioningProfileForTarget({ target, label, candidates }) {
  try {
    return resolveProvisioningProfile({ target, label, candidates })
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }
}

function resolveProvisioningProfile({ target, label, candidates }) {
  if (macTarget !== target) {
    return undefined
  }

  if (process.platform !== "darwin") {
    throw new Error(
      `${label} builds must be run on macOS because Apple signing tools are required.`
    )
  }

  const undecodableProfiles = []

  for (const candidate of candidates) {
    const candidatePath = path.join(__dirname, candidate)
    if (!fs.existsSync(candidatePath)) {
      continue
    }

    if (canDecodeProvisioningProfile(candidatePath)) {
      return candidate
    }

    undecodableProfiles.push(candidate)
  }

  if (undecodableProfiles.length > 0) {
    throw new Error(
      `Found ${label} provisioning profile, but macOS could not decode it: ${undecodableProfiles.join(", ")}. Re-download the matching Apple provisioning profile and replace the local file.`
    )
  }

  throw new Error(
    `Missing ${label} provisioning profile. Expected: ${candidates.join(", ")}`
  )
}

function canDecodeProvisioningProfile(profilePath) {
  const nullOutputPath = process.platform === "win32" ? "NUL" : "/dev/null"
  const decoders = [
    ["security", ["cms", "-D", "-i", profilePath]],
    [
      "openssl",
      [
        "cms",
        "-verify",
        "-inform",
        "DER",
        "-noverify",
        "-in",
        profilePath,
        "-out",
        nullOutputPath,
      ],
    ],
  ]

  for (const [command, args] of decoders) {
    try {
      execFileSync(command, args, { stdio: "ignore" })
      return true
    } catch {
      // Try the next local CMS decoder before treating the profile as invalid.
    }
  }

  return false
}

function getSelectedProvisioningProfile() {
  if (macTarget === "mas-dev") {
    return masDevProvisioningProfile
  }
  if (macTarget === "mas") {
    return masProvisioningProfile
  }
  return undefined
}

function embedProvisioningProfile(appBundlePath) {
  const provisioningProfile = getSelectedProvisioningProfile()
  if (!provisioningProfile) {
    return
  }

  const source = path.join(__dirname, provisioningProfile)
  const destination = path.join(
    appBundlePath,
    "Contents",
    "embedded.provisionprofile"
  )

  fs.copyFileSync(source, destination)
  console.log("✓ Embedded provisioning profile:", provisioningProfile)
}

function normalizeSourceChromiumForElectronBuilder() {
  if (process.platform !== "darwin") {
    return
  }

  normalizeBundledMacChromiumForCopying(
    path.join(__dirname, "resources", "chromium")
  )
}

async function signMasAppWithoutProfileDecode(signOptions) {
  if (!signOptions.identity) {
    const isDevelopmentSign = signOptions.type === "development"
    const identityKind = isDevelopmentSign
      ? "Apple Development"
      : "Apple Distribution"
    const envName = isDevelopmentSign
      ? "PRESENTON_MAS_DEV_IDENTITY"
      : "PRESENTON_MAS_DISTRIBUTION_IDENTITY"
    const identityHint = isDevelopmentSign
      ? `set ${envName} to the Apple Development identity shown by "security find-identity -v -p codesigning". Do not use the team ID unless it appears in that identity line.`
      : `set ${envName} to a shared qualifier such as ${TEAM_ID}.`

    throw new Error(
      `Missing ${identityKind} signing identity for MAS ${signOptions.type} build. Install the ${identityKind} certificate/private key for team ${TEAM_ID}, or ${identityHint}`
    )
  }

  await signAsync({
    ...signOptions,
    provisioningProfile: undefined,
    preEmbedProvisioningProfile: false,
  })
}

// AfterPack hook: set executable permissions on macOS; no-op on Windows
const afterPack = async (context) => {
  if (
    context.electronPlatformName === "darwin" ||
    context.electronPlatformName === "mas"
  ) {
    const appPath = context.appOutDir
    const appBundleName = `${context.packager.appInfo.productFilename}.app`
    const appBundlePath = path.join(appPath, appBundleName)
    const resourcesRoot = path.join(
      appBundlePath,
      "Contents",
      "Resources",
      "app",
      "resources"
    )
    const fastapiPath = path.join(resourcesRoot, "fastapi", "fastapi")
    const exportPyDir = path.join(resourcesRoot, "export", "py")
    const converterCandidates = [
      `convert-${process.platform}-${process.arch}`,
      `convert-${process.platform}`,
      "convert",
    ]

    console.log("Setting executable permissions for FastAPI binary...")
    console.log("FastAPI path:", fastapiPath)

    if (fs.existsSync(fastapiPath)) {
      fs.chmodSync(fastapiPath, 0o755)
      console.log("✓ Execute permissions set for FastAPI")
    } else {
      console.warn("⚠ FastAPI binary not found at:", fastapiPath)
    }

    console.log("Setting executable permissions for export converter binary...")
    let converterFound = false
    for (const candidate of converterCandidates) {
      const candidatePath = path.join(exportPyDir, candidate)
      if (fs.existsSync(candidatePath)) {
        fs.chmodSync(candidatePath, 0o755)
        console.log("✓ Execute permissions set for converter:", candidatePath)
        converterFound = true
      }
    }
    if (!converterFound) {
      console.warn("⚠ No converter binary found in:", exportPyDir)
    }

    const fastapiDir = path.join(resourcesRoot, "fastapi")
    if (fs.existsSync(fastapiDir)) {
      console.log("FastAPI directory contents:", fs.readdirSync(fastapiDir))
    }

    if (fs.existsSync(exportPyDir)) {
      console.log("Export py directory contents:", fs.readdirSync(exportPyDir))
    }

    normalizeBundledMacChromiumForPackaging(path.join(resourcesRoot, "chromium"))
    embedProvisioningProfile(appBundlePath)
  }
}

const config = {
  appId: APP_ID,
  productName: "Presenton",
  asar: false,
  copyright: "Copyright © 2026 Presenton",
  directories: {
    output: "dist",
    buildResources: "build",
  },
  files: [
    "resources",
    "app_dist",
    "node_modules",
    "NOTICE"
  ],
  afterPack,
  mac: {
    artifactName: "Presenton-${version}.${ext}",
    target: [macTarget || "dmg"],
    category: "public.app-category.productivity",
    hardenedRuntime: false,
    gatekeeperAssess: false,
    identity: macTarget === "mas-dev" || macTarget === "mas" ? null : undefined,
    icon: "build/icon.icns",
    bundleShortVersion: appStoreBundleShortVersion,
    bundleVersion: appStoreBundleVersion,
    extendInfo: {
      ElectronTeamID: TEAM_ID,
    },
  },
  masDev: {
    type: "development",
    identity: masDevIdentity || undefined,
    provisioningProfile: masDevProvisioningProfile,
    entitlements: "build/entitlements.mas.plist",
    entitlementsInherit: "build/entitlements.mas.inherit.plist",
    sign: signMasAppWithoutProfileDecode,
    // osx-sign always adds --timestamp; this later flag keeps local MAS dev signing offline-tolerant.
    additionalArguments: ["--timestamp=none"],
  },
  mas: {
    type: "distribution",
    identity: masDistributionIdentity || undefined,
    provisioningProfile: masProvisioningProfile,
    entitlements: "build/entitlements.mas.plist",
    entitlementsInherit: "build/entitlements.mas.inherit.plist",
    timestamp: "none",
    sign: signMasAppWithoutProfileDecode,
  },
  linux: {
    artifactName: "Presenton-${version}.${ext}",
    target: ["AppImage", "deb"],
    icon: "build/icons",
  },
  deb: {
    afterInstall: "build/after-install.tpl",
    recommends: ["libreoffice"],
  },
  win: {
    target: ["nsis", "appx"],
    icon: "build/icon.ico",
    artifactName: "Presenton-${version}.${ext}",
    executableName: "Presenton",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    installerHeaderIcon: "build/icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Presenton",
    uninstallDisplayName: "Presenton",
  },
  appx: {
    identityName: "PresentonAI.Presenton",
    publisher: "CN=8A2C57B5-F1C6-473A-93EE-2E9B72134341",
    displayName: "Presenton",
    publisherDisplayName: "Presenton Inc.",
    applicationId: "PresentonAI.Presenton",
    
  },
}

const targets = macTarget ? builder.Platform.MAC.createTarget([macTarget]) : undefined

normalizeSourceChromiumForElectronBuilder()
builder.build({ targets, config })
