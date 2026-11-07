// Downloads draw.io's web app (the `draw.war` of a pinned jgraph/drawio release), checks its SHA-256,
// and unpacks its web files into vendor/drawio, which Webwriter serves at /drawio/. Diagrams are then
// edited from Webwriter's own address: nothing blocks it as a third party, and it works offline.
//
//   npm run fetch-drawio
//
// `npm install` runs it with --optional: when the download fails, such as offline, the install still
// succeeds and Webwriter uses draw.io's site instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = 'v32.5.5';
const URL = `https://github.com/jgraph/drawio/releases/download/${VERSION}/draw.war`;
const SHA256 = 'cde0ebd72da197da37d100353e226d5344b08f0fcf7e1b18d1e000a77f9c5f52';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor', 'drawio');
const stamp = path.join(target, '.webwriter-version');

if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === VERSION) {
  console.log(`draw.io ${VERSION} is already in vendor/drawio.`);
  process.exit(0);
}

// The download goes into a fresh, empty folder of its own and is checked before anything is unpacked.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'webwriter-drawio-'));
try {
  console.log(`Downloading draw.io ${VERSION} (about 50 MB)…`);
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`${URL}: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== SHA256) throw new Error(`draw.war has SHA-256 ${sha}, not the published ${SHA256}. Nothing was unpacked.`);
  const war = path.join(work, 'draw.war');
  fs.writeFileSync(war, bytes);
  const unpacked = path.join(work, 'webapp');
  fs.mkdirSync(unpacked);
  execFileSync('unzip', ['-q', war, '-d', unpacked]);
  // The Java parts of the web archive are not needed to edit diagrams in a browser.
  for (const dir of ['WEB-INF', 'META-INF']) fs.rmSync(path.join(unpacked, dir), { recursive: true, force: true });
  if (!fs.existsSync(path.join(unpacked, 'index.html'))) throw new Error('draw.war has no index.html.');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(unpacked, target);
  fs.writeFileSync(stamp, `${VERSION}\n`);
  console.log(`draw.io ${VERSION} is in vendor/drawio.`);
} catch (error) {
  if (!process.argv.includes('--optional')) throw error;
  console.warn(`draw.io was not downloaded (${error.message}). Diagrams are edited with draw.io's site until npm run fetch-drawio succeeds.`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
