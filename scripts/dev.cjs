#!/usr/bin/env node

const workflow = require('../tooling/workflows/dev/start.cjs');

workflow.startWorkbench(process.argv[2] || 'web').catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
