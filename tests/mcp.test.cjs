const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
test('stdio MCP exposes only read-only tools and reads an explicit export snapshot', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'suiyi-mcp-'));
  const file = path.join(folder, 'export.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, videos: [{ video: { id: 'v1', title: 'MCP demo', url: 'https://video.example/' }, transcript: { completeness: 'partial', cues: [{ start: 1, end: 3, text: 'find this caption' }], translations: [] } }] }));
  const child = spawn(process.execPath, ['tools/mcp-server.mjs', '--library', file]);
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  const requests = [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'get_video_transcript', arguments: { videoId: 'v1' } } }, { id: 4, method: 'tools/call', params: { name: 'search_subtitles', arguments: { query: 'find' } } }];
  child.stdin.end(requests.map(request => JSON.stringify({ jsonrpc: '2.0', ...request })).join('\n') + '\n');
  const exit = await new Promise(resolve => child.on('close', resolve));
  try {
    assert.equal(exit, 0, errors);
    const responses = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(responses[0].result.protocolVersion, '2025-11-25');
    assert.ok(responses[1].result.tools.every(tool => tool.annotations.readOnlyHint));
    assert.equal(responses[2].result.structuredContent.transcript.completeness, 'partial');
    assert.equal(responses[3].result.structuredContent.matches[0].start, 1);
  } finally {
    const resolved = fs.realpathSync(folder), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('suiyi-mcp-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
