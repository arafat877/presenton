# MAS Development Build

This document covers the local Mac App Store development build for Presenton. It is for testing the sandboxed MAS version on a registered macOS development machine before creating an App Store distribution build.

## App Identity

- App name: Presenton
- Platform: macOS
- Team ID / App ID Prefix: `S6W5C54KL6`
- Bundle ID: `com.presenton.presenton`
- Application group: `S6W5C54KL6.com.presenton.presenton`

## What Is Configured

The Electron builder config lives in `electron/build.js`.

The MAS development build uses:

- `appId`: `com.presenton.presenton`
- `productName`: `Presenton`
- `mac.target`: `mas-dev` when `PRESENTON_MAC_TARGET=mas-dev`
- `masDev.type`: `development`
- `masDev.provisioningProfile`: `build/AppleDevelopment.provisionprofile`
- `masDev.entitlements`: `build/entitlements.mas.plist`
- `masDev.entitlementsInherit`: `build/entitlements.mas.inherit.plist`
- `ElectronTeamID`: `S6W5C54KL6`

The macOS icon is configured as `build/icon.icns`. The checked-in `icon.iconset` contains the source PNGs, including the App Store-required `icon_512x512@2x.png` at 1024x1024.

Placeholder files are included so the expected local structure is visible:

- `electron/build/AppleDevelopment.provisionprofile.replace_me`
- `electron/build/AppDistri.provisionprofile.replace_me`
- `electron/build/MacAppStore.provisionprofile.replace_me`
- `electron/build/icon.icns`
- `electron/build/icon.iconset/`

The `.replace_me` files are documentation markers. Do not rename them unless you are replacing them with the real Apple artifacts.

Expected structure:

```text
electron/
  build/
    AppleDevelopment.provisionprofile.replace_me
    AppleDevelopment.provisionprofile        # local only, ignored by git
    AppDistri.provisionprofile.replace_me    # preferred distribution marker
    AppDistri.provisionprofile               # local only, ignored by git
    MacAppStore.provisionprofile.replace_me  # distribution fallback marker
    MacAppStore.provisionprofile             # optional fallback, ignored by git
    icon.icns                                # macOS/App Store icon
    entitlements.mas.plist
    entitlements.mas.inherit.plist
    icon.iconset/
      README.replace_me.md
      icon_16x16.png
      icon_16x16@2x.png
      icon_32x32.png
      icon_32x32@2x.png
      icon_128x128.png
      icon_128x128@2x.png
      icon_256x256.png
      icon_256x256@2x.png
      icon_512x512.png
      icon_512x512@2x.png
```

## Required Local Apple Setup

This repo assumes the Apple Developer setup already exists on the Mac:

- Apple Development certificate installed in Keychain.
- Mac registered in Apple Developer Devices.
- Explicit App ID exists for `com.presenton.presenton`.
- macOS App Development provisioning profile exists for that App ID and Mac.

Place the development provisioning profile here:

```text
electron/build/AppleDevelopment.provisionprofile
```

Provisioning profiles are ignored by git and should stay local.

Check that macOS can see the development signing identity:

```bash
security find-identity -v -p codesigning | grep -E "Apple Development|Mac Developer"
```

For MAS development, the identity must be an Apple Development or Mac Developer certificate included in the development provisioning profile. Apple Development identity names often look like `Apple Development: Developer Name (CERTID)`, and the `CERTID` may not be the Team ID. If auto-discovery does not choose the right certificate, set `PRESENTON_MAS_DEV_IDENTITY` to part of that identity line, such as the developer name or the certificate ID in parentheses.

If `CSC_NAME` is set to an Apple Distribution identity for release builds, leave it out for `mas-dev` or set `PRESENTON_MAS_DEV_IDENTITY` explicitly.

The checked-in marker file is:

```text
electron/build/AppleDevelopment.provisionprofile.replace_me
```

The real local file must be:

```text
electron/build/AppleDevelopment.provisionprofile
```

The real file is ignored by git.

## Icon Structure

A macOS icon set exists at:

```text
electron/build/icon.iconset/
```

It contains PNGs using the standard Apple iconset filenames and sizes. The App Store validation-critical file is:

```text
electron/build/icon.iconset/icon_512x512@2x.png
```

That file must be 1024x1024 pixels.

Regenerate the final `.icns` file with electron-builder's icon helper:

```bash
cd electron
node_modules/app-builder-bin/mac/app-builder_arm64 icon --format icns --out build --root build --input icon.iconset/icon_512x512@2x.png
```

Verify the generated icon contains the 1024 representation:

```bash
sips -g pixelWidth -g pixelHeight build/icon.icns
iconutil -c iconset build/icon.icns -o /tmp/presenton-icon-verify.iconset
sips -g pixelWidth -g pixelHeight /tmp/presenton-icon-verify.iconset/icon_512x512@2x.png
```

## Entitlements

The MAS development build is sandboxed, as required for Mac App Store builds.

Main app entitlements are in:

```text
electron/build/entitlements.mas.plist
```

Current main app entitlements:

- `com.apple.security.app-sandbox`
- `com.apple.security.application-groups`
- `com.apple.security.cs.allow-jit`
- `com.apple.security.network.client`
- `com.apple.security.network.server`
- `com.apple.security.files.user-selected.read-write`
- `com.apple.security.files.downloads.read-write`

Helper process entitlements are in:

```text
electron/build/entitlements.mas.inherit.plist
```

Current helper entitlements:

- `com.apple.security.app-sandbox`
- `com.apple.security.inherit`

Do not add broad entitlements unless the app actually needs them. Any entitlement used in the app should also be supported by the provisioning profile and App ID capabilities.

## Build Commands

Run commands from the `electron` directory.

Full local MAS development build:

```bash
npm run build:all:mas-dev
```

Package only, assuming `resources`, `app_dist`, and dependencies are already built:

```bash
npm run dist:mac:mas-dev
```

Electron package step only, including TypeScript checks and generated version/export runtime:

```bash
npm run build:electron:mas-dev
```

## Expected Output

The MAS development app is written under:

```text
electron/dist/mas-dev/
```

This build is signed with the Apple Development certificate and embedded development provisioning profile. It should run only on Macs included in that provisioning profile.

## Local Verification

After building on macOS, inspect the app signature:

```bash
codesign --display --verbose=2 "dist/mas-dev/Presenton.app"
```

Check entitlements embedded in the signed app:

```bash
codesign --display --entitlements :- "dist/mas-dev/Presenton.app"
```

Confirm the provisioning profile was embedded:

```bash
ls "dist/mas-dev/Presenton.app/Contents/embedded.provisionprofile"
```

Decode the local development provisioning profile if needed:

```bash
security cms -D -i build/AppleDevelopment.provisionprofile
```

If `security cms` rejects the profile but you need to confirm the CMS wrapper is readable:

```bash
openssl cms -verify -inform DER -noverify -in build/AppleDevelopment.provisionprofile -out /tmp/AppleDevelopment.plist
```

## Notes

- `mas-dev` is for local sandbox testing only.
- App Store submission uses the `mas` target, an Apple Distribution certificate, and a Mac App Store provisioning profile. See `electron/mas_distribution_readme.md`.
- MAS builds do not use hardened runtime notarization in the same way direct-distribution DMG builds do.
- The standard Electron darwin build cannot be used to test MAS sandbox behavior; MAS testing requires the MAS build target.

## References

- Electron Mac App Store Submission Guide: https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/
- electron-builder MAS docs: https://www.electron.build/docs/mas/
- electron-builder macOS docs: https://www.electron.build/docs/mac/
- Apple App Sandbox Entitlement Keys: https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html
