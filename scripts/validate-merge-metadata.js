#!/usr/bin/env node
/**
 * Validate merged package metadata extraction.
 * Usage: node scripts/validate-merge-metadata.js <package-file>
 */

import { extractResourceData } from '../dist/metadata.js';
import { METADATA_TGI } from '../dist/merge.js';
import { resolve } from 'node:path';

function printUsage() {
  console.log(`
Validate Metadata Extraction

Usage:
  node scripts/validate-merge-metadata.js <package-file>

Examples:
  node scripts/validate-merge-metadata.js ./tmp/merged.package
  node scripts/validate-merge-metadata.js ./output/final.package
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
    const data = await extractResourceData(packageFile, METADATA_TGI);
    if (!data) {
      console.log('❌ No metadata resource found');
      process.exit(1);
    }

    const json = data.toString('utf8');
    const metadata = JSON.parse(json);
    console.log(`✅ Metadata extracted: ${metadata.originalPackages.length} packages`);

    // Show a sample of the metadata
    if (metadata.originalPackages.length > 0) {
      const sample = metadata.originalPackages[0];
      console.log(`📦 Sample package: ${sample.filename} (${sample.resources.length} resources)`);
    }

    process.exit(metadata.originalPackages.length > 0 ? 0 : 1);
  } catch (error) {
    console.log(`❌ Metadata validation failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
