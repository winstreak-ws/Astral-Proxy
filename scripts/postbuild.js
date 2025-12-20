import os from "os";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import * as ResEdit from "resedit";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platform = process.argv[2] || os.platform();

const pkgPath = path.resolve(__dirname, "../package.json");
const { version } = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

async function doWindows() {
    const exePath = path.resolve(__dirname, "../dist/win-x64/Astral.exe");
    const signedExePath = path.resolve(__dirname, "../dist/win-x64/Astral-signed.exe");
    const certPath = path.resolve(__dirname, "../certs/winstreak-dev.pfx");
    const iconPath = path.resolve(__dirname, "../assets/icon.ico");

    console.log("[INFO] Updating metadata & icon with ResEdit...");

    const exeData = fs.readFileSync(exePath);
    const exe = ResEdit.NtExecutable.from(exeData);
    const res = ResEdit.NtExecutableResource.from(exe);

    const lang = 1033, codepage = 1200;
    const [major, minor, patch] = version.split(".");

    const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
    let vi = viList.length ? viList[0] : new ResEdit.Resource.VersionInfo();

    vi.setFileVersion(+major, +minor, +patch, 0, lang);
    vi.setProductVersion(+major, +minor, +patch, 0, lang);

    vi.setStringValues({ lang, codepage }, {
        CompanyName: "Winstreak.ws",
        ProductName: "Astral Proxy",
        FileDescription: "Astral Minecraft Proxy",
        OriginalFilename: "Astral.exe",
        InternalName: "Astral",
        LegalCopyright: `Copyright © ${new Date().getFullYear()} Winstreak.ws`,
        ProductVersion: version,
        FileVersion: version
    });

    vi.outputToResourceEntries(res.entries);

    if (fs.existsSync(iconPath)) {
        const buffer = fs.readFileSync(iconPath);
        const iconFile = ResEdit.Data.IconFile.from(buffer);
        if (iconFile.icons.length > 0) {
            ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
                res.entries,
                1,
                lang,
                iconFile.icons.map(item => item.data)
            );
            console.log("[INFO] Injected icon into EXE");
        }
    }

    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));

    console.log("[INFO] ResEdit done - metadata & icon set");

    await new Promise((resolve) => {
        process.stdout.write("Enter PFX password: ");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        let password = "";
        process.stdin.on("data", (char) => {
            if (char === "\r" || char === "\n") {
                process.stdout.write("\n");
                process.stdin.setRawMode(false);
                process.stdin.pause();
                try {
                    const cmd = `osslsigncode sign -pkcs12 "${certPath}" -pass "${password}" \
                        -n "Astral Proxy" -i "https://winstreak.ws" \
                        -t http://timestamp.digicert.com \
                        -in "${exePath}" -out "${signedExePath}"`;
                    console.log("[INFO] Running:", cmd);
                    execSync(cmd, { stdio: "inherit" });
                    console.log("osslsigncode done - exe signed");
                } catch (err) {
                    console.error("osslsigncode failed - exe not signed", err);
                }
                resolve(null);
            } else if (char === "\u0003") {
                process.exit();
            } else {
                password += char;
            }
        });
    });
}

async function doMac() {
    const appPath = path.resolve(__dirname, "../dist/mac-x64/Astral.app");
    const plistPath = path.join(appPath, "Contents/Info.plist");
    const iconSrc = path.resolve(__dirname, "../assets/icon.icns");
    const iconDst = path.join(appPath, "Contents/Resources/Icon.icns");

    console.log("[INFO] Setting up macOS .app bundle...");

    if (!fs.existsSync(path.dirname(iconDst))) fs.mkdirSync(path.dirname(iconDst), { recursive: true });
    fs.copyFileSync(iconSrc, iconDst);

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN"
"http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key> <string>Astral Proxy</string>
  <key>CFBundleDisplayName</key> <string>Astral Proxy</string>
  <key>CFBundleIdentifier</key> <string>ws.winstreak.astral</string>
    <key>CFBundleVersion</key> <string>${version}</string>
    <key>CFBundleShortVersionString</key> <string>${version}</string>
  <key>CFBundleIconFile</key> <string>Icon</string>
  <key>CFBundleExecutable</key> <string>launcher</string>
</dict>
</plist>`;
    fs.writeFileSync(plistPath, plist);

    console.log("[INFO] Ad-hoc signing macOS app...");
    execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: "inherit" });
}

async function doLinux() {
    const desktopFile = path.resolve(__dirname, "../dist/linux-x64/Astral.desktop");
    const iconPath = path.resolve(__dirname, "../assets/icon.png");

    console.log("[INFO] Setting up Linux desktop file...");

    const desktop = `[Desktop Entry]
Name=Astral Proxy
Comment=Minecraft Astral Proxy by Winstreak.ws
Exec=launcher
Icon=astral
Terminal=false
Type=Application
Categories=Game;Utility;
`;
    fs.writeFileSync(desktopFile, desktop);

    if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, path.resolve(__dirname, "../dist/linux-x64/astral.png"));
    }

    console.log("[INFO] Linux apps usually signed with GPG, not embedded");
}

(async () => {
    if (platform === "win32" || platform === "win") await doWindows();
    else if (platform === "darwin" || platform === "mac") await doMac();
    else if (platform === "linux") await doLinux();
    else console.warn("[WARN] Unknown platform, skipping postbuild");
})();
