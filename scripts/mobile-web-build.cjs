#!/usr/bin/env node

const workflow = require('../tooling/workflows/mobile/build.cjs');

if (require.main === module) {
  const shouldInstall = process.argv.includes('--install');
  const result = workflow.buildMobileWorkspace({ install: shouldInstall });
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  buildMobileWeb: workflow.buildMobileWorkspace,
  cleanStaleMobileWebResources: workflow.cleanStaleMobileWebResources,
};
