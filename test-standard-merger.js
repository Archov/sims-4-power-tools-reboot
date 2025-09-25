#!/usr/bin/env node
/**
 * Test script for standard-compatible merger.
 *
 * Usage:
 *   node test-standard-merger.js <input-dir> <output-file> [manifest-file]
 */

import { mergePackagesStandard } from './dist/standard-merger.js';
import { DbpfBinary } from './dist/dbpf-binary.js';
import { STANDARD_MANIFEST_TYPE, STANDARD_MANIFEST_GROUP, STANDARD_MANIFEST_INSTANCE } from './dist/utils/standard-constants.js';
import { resolve } from 'node:path';

function printUsage() {
  console.log(`
Standard Merger Test Script

Usage:
  node test-standard-merger.js <input-dir> <output-file> [manifest-file]

Arguments:
  input-dir      Directory containing .package files to merge
  output-file    Path where the merged package will be written
  manifest-file  Optional path to save debug manifest (auto-generated if not provided)

Examples:
  node test-standard-merger.js ./test-packages ./tmp/merged.package
  node test-standard-merger.js ./my-packages ./output/merged.package ./debug/manifest.json
`);
}

async function testStandardMerger(inputDir, outputFile, manifestFile) {
  try {
    console.log('Testing standard-compatible merger...\n');

    // Generate manifest file path if not provided
    const finalManifestFile = manifestFile || outputFile.replace('.package', '-manifest.json');

    // Test merging packages
    await mergePackagesStandard({
      inputDir,
      outputFile,
      manifestFile: finalManifestFile
    });

    console.log('\nTesting if merged package is detectable as merged...');

    // Read the merged package
    const structure = await DbpfBinary.read({ filePath: outputFile });

    // Check if it contains the standard manifest TGI
    const hasManifest = structure.resources.some(r =>
      r.tgi.type === STANDARD_MANIFEST_TYPE &&
      r.tgi.group === STANDARD_MANIFEST_GROUP &&
      r.tgi.instance === STANDARD_MANIFEST_INSTANCE
    );

    console.log(`Package contains standard manifest: ${hasManifest ? '✅ YES' : '❌ NO'}`);
    console.log(`Manifest TGI: 0x${STANDARD_MANIFEST_TYPE.toString(16)}:0x${STANDARD_MANIFEST_GROUP.toString(16)}:0x${STANDARD_MANIFEST_INSTANCE.toString(16)}`);

    if (hasManifest) {
      console.log('🎉 Standard merger test PASSED - package should be unmergeable by standard tools!');
    } else {
      console.log('⚠️ Standard merger test FAILED - package not detected as merged');
    }

  } catch (error) {
    console.error('Test failed:', error);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [inputDir, outputFile, manifestFile] = args;
  const resolvedInput = resolve(inputDir);
  const resolvedOutput = resolve(outputFile);

  console.log(`Input directory: ${resolvedInput}`);
  console.log(`Output file: ${resolvedOutput}`);
  if (manifestFile) {
    console.log(`Manifest file: ${resolve(manifestFile)}`);
  }
  console.log('');

  await testStandardMerger(resolvedInput, resolvedOutput, manifestFile);
}

main().catch(console.error);
