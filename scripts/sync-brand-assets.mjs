// scripts/sync-brand-assets.mjs  (package.json: "predev" and "prebuild": "node scripts/sync-brand-assets.mjs")
// Per docs/research/12-salesforce-brand.md §5.1. Fonts come from each person's own licensed install;
// outputs (public/fonts, public/icons) are git-ignored.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import os from 'node:os';

const root = process.cwd();
const fontsOut = join(root, 'public/fonts');
const iconsOut = join(root, 'public/icons');
mkdirSync(fontsOut, { recursive: true });
mkdirSync(iconsOut, { recursive: true });

const fontDirs = [process.env.CC_BRAND_FONTS_DIR, '/Library/Fonts', join(os.homedir(), 'Library/Fonts')].filter(Boolean);
for (const style of ['Light', 'LightItalic', 'Regular', 'Italic', 'Bold', 'BoldItalic']) {
  const file = `SalesforceSans-${style}.ttf`;
  if (existsSync(join(fontsOut, file))) continue;
  const src = fontDirs.map((d) => join(d, file)).find(existsSync);
  if (src) copyFileSync(src, join(fontsOut, file));
  else console.warn(`[brand] ${file} not found; UI falls back to system-ui. Install fonts via sfdc.co/fonts.`);
}

try {
  const require = createRequire(import.meta.url);
  const pkg = dirname(require.resolve('@salesforce-ux/icons/package.json'));
  for (const set of ['utility', 'standard', 'doctype']) {
    copyFileSync(join(pkg, `dist/salesforce-lightning-design-system-icons/${set}-sprite/svg/symbols.svg`), join(iconsOut, `${set}.svg`));
  }
} catch {
  console.warn('[brand] @salesforce-ux/icons missing; run npm i. Icons will not render.');
}
