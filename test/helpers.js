'use strict';

const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (...p) => path.join(FIXTURES, ...p);

// Map "name@version" -> finding for a scanned project.
function findingsOf(project) {
  return Object.fromEntries(project.findings.map((f) => [`${f.name}@${f.version}`, f]));
}

module.exports = { FIXTURES, fixture, findingsOf };
