#!/usr/bin/env node
/**
 * Validate merged package file existence and size.
 */

import { stat } from 'node:fs/promises';

async function main() {
  try {
    const stats = await stat('./tmp/merge-validation-test.package');
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`✅ File exists: ${sizeMB}MB`);
    process.exit(stats.size > 1000000 ? 0 : 1);
  } catch (error) {
    console.log(`❌ File check failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
