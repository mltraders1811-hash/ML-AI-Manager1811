// Regenerates the Android launcher and splash images from the app's own
// icons, so the phone shows the M.L mark rather than the Capacitor logo the
// scaffolding ships with.
//
// Run after `npx cap add android`, or any time the brand icon changes:
//   node scripts/android-icons.mjs
//
// Every generated file replaces one Capacitor already created, at exactly
// the size it created it - so densities stay correct without this script
// having to know Android's dpi table.
import { readdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

import sharp from "sharp";

const RES = "android/app/src/main/res";
const BRAND = "#166534";
// Already rendered at 512px in the PWA's own assets: downscaling these is
// sharper than re-rendering the SVG through whatever fonts a build machine
// happens to have installed.
const SQUARE_ICON = "public/icons/icon-512.png";
const MASKABLE_ICON = "public/icons/maskable-512.png";

async function sizeOf(file) {
  const { width, height } = await sharp(file).metadata();
  return { width: width ?? 0, height: height ?? 0 };
}

async function replaceLauncherIcons() {
  const dirs = readdirSync(RES).filter((d) => d.startsWith("mipmap-") && d !== "mipmap-anydpi-v26");
  let written = 0;

  for (const dir of dirs) {
    for (const name of readdirSync(join(RES, dir))) {
      const target = join(RES, dir, name);
      const { width } = await sizeOf(target);
      if (!width) continue;

      // The adaptive foreground is drawn inside a mask that crops the outer
      // edges, which is what the maskable icon was made for.
      const source = name.includes("foreground") ? MASKABLE_ICON : SQUARE_ICON;
      const image = sharp(source).resize(width, width, { fit: "cover" });
      writeFileSync(target, await (name.includes("round") ? roundify(image, width) : image.png()).toBuffer());
      written++;
    }
  }
  return written;
}

/** Circular launcher icon for the launchers that ask for one. */
function roundify(image, size) {
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return image.composite([{ input: circle, blend: "dest-in" }]).png();
}

async function replaceSplashScreens() {
  const dirs = readdirSync(RES).filter((d) => d.startsWith("drawable"));
  let written = 0;

  for (const dir of dirs) {
    const path = join(RES, dir);
    for (const name of readdirSync(path)) {
      if (!name.endsWith(".png")) continue;
      const target = join(path, name);
      const { width, height } = await sizeOf(target);
      if (!width || !height) continue;

      // The mark sits at a quarter of the shortest side, centred on the
      // brand colour - the same first impression as the web app's header.
      const logoSize = Math.round(Math.min(width, height) * 0.25);
      const logo = await sharp(SQUARE_ICON).resize(logoSize, logoSize).png().toBuffer();

      writeFileSync(
        target,
        await sharp({
          create: { width, height, channels: 4, background: BRAND },
        })
          .composite([{ input: logo, gravity: "centre" }])
          .png()
          .toBuffer(),
      );
      written++;
    }
  }
  return written;
}

function setAdaptiveBackground() {
  const file = join(RES, "values", "ic_launcher_background.xml");
  if (!existsSync(file)) return;
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND}</color>
</resources>
`,
  );
}

const icons = await replaceLauncherIcons();
const splashes = await replaceSplashScreens();
setAdaptiveBackground();
console.log(`Rewrote ${icons} launcher icon(s) and ${splashes} splash image(s) from the M.L brand assets.`);
