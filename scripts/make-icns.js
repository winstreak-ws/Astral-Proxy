import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = path.resolve(__dirname, "../assets/icon-mac.png");
const iconset = path.resolve(__dirname, "../assets/Astral.iconset");
const out = path.resolve(__dirname, "../assets/icon.icns");

if (!fs.existsSync(src)) {
  console.error("Missing source PNG:", src);
  process.exit(1);
}

if (fs.existsSync(iconset)) fs.rmSync(iconset, { recursive: true });
fs.mkdirSync(iconset);

const sizes = [16, 32, 128, 256, 512];

for (const size of sizes) {
  const normal = `${iconset}/icon_${size}x${size}.png`;
  const retina = `${iconset}/icon_${size}x${size}@2x.png`;

  execSync(`sips -z ${size} ${size} "${src}" --out "${normal}"`);
  execSync(`sips -z ${size * 2} ${size * 2} "${src}" --out "${retina}"`);
}

console.log("[INFO] Building .icns...");
execSync(`iconutil -c icns "${iconset}" -o "${out}"`);

console.log("Done:", out);