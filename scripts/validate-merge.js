#!/usr/bin/env node
/**
 * Validation script for merge orchestrator functionality.
 * Run individual validation checks for the merge operation.
 *
 * Usage:
 *   node scripts/validate-merge.js <input-dir> <output-file>
 *   node scripts/validate-merge.js ./test-packages ./tmp/test-merged.package
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DbpfBinary } from '../dist/dbpf-binary.js';
import { extractResourceData } from '../dist/metadata.js';
import { mergePackages, METADATA_TGI } from '../dist/merge.js';

function printUsage() {
  console.log(`
Merge Orchestrator Validation Script

Usage:
  node scripts/validate-merge.js <input-dir> <output-file>

Examples:
  node scripts/validate-merge.js ./test-packages ./tmp/test-merged.package
  node scripts/validate-merge.js ./path/to/packages ./output/merged.package

This script will:
1. Merge all .package files from input directory
2. Validate the merged package file exists
3. Check DBPF format validity
4. Extract and validate embedded metadata
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [inputDir, outputFile] = args;
  const resolvedInput = resolve(inputDir);
  const resolvedOutput = resolve(outputFile);

  console.log('🚀 Starting merge orchestrator validation\n');
  console.log(`Input directory: ${resolvedInput}`);
  console.log(`Output file: ${resolvedOutput}\n`);

  // Validation 1: Basic merge operation
  console.log('🧪 1. Testing basic merge operation...');
  try {
    await mergePackages(resolvedInput, resolvedOutput);
    console.log('✅ Merge operation completed successfully');
  } catch (error) {
    console.error(`❌ Merge operation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Validation 2: File existence and size
  console.log('🧪 2. Checking merged file...');
  try {
    const stats = await stat(resolvedOutput);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`✅ File exists: ${sizeMB}MB`);
  } catch (error) {
    console.error(`❌ File check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Validation 3: DBPF validity
  console.log('🧪 3. Validating DBPF format...');
  try {
    const structure = await DbpfBinary.read({ filePath: resolvedOutput });
    console.log(`✅ Valid DBPF: ${structure.resources.length} resources`);
  } catch (error) {
    console.error(`❌ DBPF validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Validation 4: Metadata extraction
  console.log('🧪 4. Testing metadata extraction...');
  try {
    const data = await extractResourceData(resolvedOutput, METADATA_TGI);
    if (!data) {
      console.log('❌ No metadata resource found');
      process.exit(1);
    }
    const json = data.toString('utf8');
    const metadata = JSON.parse(json);
    console.log(`✅ Metadata extracted: ${metadata.originalPackages.length} packages`);
    const reduction = (1 - (metadata.uniqueResourceCount / metadata.totalOriginalResources)) * 100;
    console.log(`   Dedup reduction: ${reduction.toFixed(1)}% (${metadata.uniqueResourceCount}/${metadata.totalOriginalResources} unique/original)`);
  } catch (error) {
    console.error(`❌ Metadata validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log('\n🎉 All validations passed! Merge orchestrator is working correctly.');
}

main().catch(console.error);
