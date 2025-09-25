#!/usr/bin/env node
/**
 * Validate merged package DBPF format.
 * Usage: node scripts/validate-merge-dbpf.js <package-file>
 */

import { DbpfBinary } from '../dist/dbpf-binary.js';
import { resolve } from 'node:path';

function printUsage() {
  console.log(`
Validate DBPF Format

Usage:
  node scripts/validate-merge-dbpf.js <package-file>

Examples:
  node scripts/validate-merge-dbpf.js ./tmp/merged.package
  node scripts/validate-merge-dbpf.js ./output/final.package
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
    const structure = await DbpfBinary.read({ filePath: packageFile });
    console.log(`✅ Valid DBPF: ${structure.resources.length} resources, ${structure.totalSize} bytes`);
    process.exit(structure.resources.length > 0 ? 0 : 1);
  } catch (error) {
    console.error(`❌ DBPF validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch(console.error);
