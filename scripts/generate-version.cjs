#!/usr/bin/env node

const workflow = require('../tooling/workflows/version/write.cjs');

try {
  const versionInfo = workflow.generateVersionInfo();
  workflow.writeVersionArtifacts(versionInfo);
} catch {
  process.exit(0);
}
