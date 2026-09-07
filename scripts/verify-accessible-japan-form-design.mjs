import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFormPath = path.join(
  rootDir,
  'apps/forms-studio/src/components/forms/public-form-page.tsx',
);
const formDefinitionPath = path.join(rootDir, 'scripts/register-accessible-japan-trip-form.mjs');
const heroPath = path.join(
  rootDir,
  'apps/forms-studio/public/accessible-japan-trip-hero-v2.jpg',
);

const publicFormSource = fs.readFileSync(publicFormPath, 'utf8');
const formDefinitionSource = fs.readFileSync(formDefinitionPath, 'utf8');
const hero = fs.readFileSync(heroPath);

assert.match(
  publicFormSource,
  /const isAccessibleJapanForm = \(form\?\.id \|\| formId\) === ACCESSIBLE_JAPAN_FORM_ID/,
  'the visual treatment must stay scoped to the Accessible Japan form ID',
);
assert.match(publicFormSource, /\/accessible-japan-trip-hero-v2\.jpg/);
assert.match(publicFormSource, /Let&apos;s plan a Japan trip that works for you/);
assert.match(publicFormSource, /Our recommendation: 4-star or above/);
assert.match(publicFormSource, /option\.startsWith\('4-star'\)/);
assert.match(publicFormSource, /option\.startsWith\('5-star'\)/);
assert.match(publicFormSource, /Don&apos;t check email often\?/);
assert.match(publicFormSource, /Your trip details are already submitted/);
assert.match(publicFormSource, /Continue on WhatsApp/);
assert.match(publicFormSource, /Instagram Direct/);
assert.match(publicFormSource, /Facebook Messenger/);
assert.match(publicFormSource, /https:\/\/wa\.me\/817036209459/);
assert.match(publicFormSource, /https:\/\/ig\.me\/m\/flattravel_japan/);
assert.match(publicFormSource, /https:\/\/m\.me\/100550119618069/);
assert.match(
  publicFormSource,
  /isAccessibleJapanForm \? <AccessibleJapanSuccessChannels \/> : null/,
  'the contact-channel success panel must stay scoped to the Accessible Japan form ID',
);
assert.match(
  publicFormSource,
  /style=\{\{ backgroundImage: `url\(\$\{HERO_BACKGROUND_IMAGE\}\)` \}\}/,
  'the existing generic Forms Studio hero must remain available for other forms',
);

assert.match(formDefinitionSource, /'A mix of room types'/);
assert.match(formDefinitionSource, /'4-star \(¥50,000–80,000\/night\)'/);
assert.match(formDefinitionSource, /'5-star \(¥80,000\+\/night\)'/);

assert.ok(hero.length >= 250_000, 'hero image must be a production-quality asset');
assert.equal(hero[0], 0xff, 'hero image must begin with the JPEG SOI marker');
assert.equal(hero[1], 0xd8, 'hero image must begin with the JPEG SOI marker');

process.stdout.write('Accessible Japan form design verification passed\n');
