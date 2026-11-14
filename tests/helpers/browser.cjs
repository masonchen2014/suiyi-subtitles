// Public installs use npm dependencies. Codex development can reuse its bundled runtime.
try {
  module.exports = require('playwright');
} catch (error) {
  if (!process.env.CODEX_MCP_NODE_PATH) throw new Error('Install development dependencies first: npm install');
  const path = require('node:path');
  module.exports = require(path.join(path.dirname(process.env.CODEX_MCP_NODE_PATH), 'node_modules/playwright'));
}
