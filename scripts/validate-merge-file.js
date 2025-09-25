#!/usr/bin/env node
/**
 * Validate merged package file existence and size.
 * Usage: node scripts/validate-merge-file.js <package-file>
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

function printUsage() {
  console.log(`
Validate Merged Package File

Usage:
  node scripts/validate-merge-file.js <package-file>

Examples:
  node scripts/validate-merge-file.js ./tmp/merged.package
  node scripts/validate-merge-file.js ./output/final.package
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length < 1 ? 1 : 0);
  }

  const packageFile = resolve(args[0]);

  try {
    const stats = await stat(packageFile);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`✅ File exists: ${sizeMB}MB (${stats.size} bytes)`);
    process.exit(stats.size > 1000000 ? 0 : 1);
  } catch (error) {
    console.log(`❌ File check failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
