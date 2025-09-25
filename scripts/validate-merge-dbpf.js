#!/usr/bin/env node
/**
 * Validate merged package DBPF format.
 */

import { DbpfBinary } from '../dist/dbpf-binary.js';

async function main() {
  try {
    const structure = await DbpfBinary.read({ filePath: './tmp/merge-validation-test.package' });
    console.log(`✅ Valid DBPF: ${structure.resources.length} resources`);
    process.exit(structure.resources.length > 500 ? 0 : 1);
  } catch (error) {
    console.log(`❌ DBPF validation failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
