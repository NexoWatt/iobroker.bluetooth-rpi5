// Minimal smoke test: loads the adapter main file without running it.
// This is intentionally lightweight so "npm test" doesn't require ioBroker runtime.

const path = require('node:path');

try {
  require(path.join(__dirname, '..', 'main.js'));
  // If require succeeds, we consider it a pass.
  process.exit(0);
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
}
