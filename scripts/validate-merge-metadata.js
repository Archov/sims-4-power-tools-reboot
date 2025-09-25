#!/usr/bin/env node
/**
 * Validate merged package metadata extraction.
 */

import { extractResourceData } from '../dist/metadata.js';
import { METADATA_TGI } from '../dist/merge.js';

async function main() {
  try {
    const data = await extractResourceData('./tmp/merge-validation-test.package', METADATA_TGI);
    if (!data) {
      console.log('❌ No metadata resource found');
      process.exit(1);
    }

    const json = data.toString('utf8');
    const metadata = JSON.parse(json);
    console.log(`✅ Metadata extracted: ${metadata.originalPackages.length} packages`);
    process.exit(metadata.originalPackages.length >= 10 ? 0 : 1);
  } catch (error) {
    console.log(`❌ Metadata validation failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
