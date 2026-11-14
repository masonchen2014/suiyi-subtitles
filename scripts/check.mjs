import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
for (const file of readdirSync('extension').filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', 'extension/' + file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const script of manifest.content_scripts.flatMap(entry => entry.js)) {
  if (!existsSync('extension/' + script)) throw new Error('Missing content script: ' + script);
}
if (manifest.version !== JSON.parse(readFileSync('package.json', 'utf8')).version) throw new Error('Package and extension version mismatch');
console.log('JavaScript syntax, manifest resources and version checks passed.');
