#!/usr/bin/env node
/**
 * Validation script for merge orchestrator functionality.
 * Run individual validation checks for the merge operation.
 */

import { stat } from 'node:fs/promises';
import { DbpfBinary } from '../dist/dbpf-binary.js';
import { extractResourceData } from '../dist/metadata.js';
import { mergePackages, METADATA_TGI } from '../dist/merge.js';

async function main() {
  console.log('🚀 Starting merge orchestrator validation\n');

  // Validation 1: Basic merge operation
  console.log('🧪 1. Testing basic merge operation...');
  try {
    await mergePackages('./test-packages', './tmp/merge-validation-test.package');
    console.log('✅ Merge operation completed successfully');
  } catch (error) {
    console.log(`❌ Merge operation failed: ${error.message}`);
    process.exit(1);
  }

  // Validation 2: File existence and size
  console.log('🧪 2. Checking merged file...');
  try {
    const stats = await stat('./tmp/merge-validation-test.package');
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`✅ File exists: ${sizeMB}MB`);
  } catch (error) {
    console.log(`❌ File check failed: ${error.message}`);
    process.exit(1);
  }

  // Validation 3: DBPF validity
  console.log('🧪 3. Validating DBPF format...');
  try {
    const structure = await DbpfBinary.read({ filePath: './tmp/merge-validation-test.package' });
    console.log(`✅ Valid DBPF: ${structure.resources.length} resources`);
  } catch (error) {
    console.log(`❌ DBPF validation failed: ${error.message}`);
    process.exit(1);
  }

  // Validation 4: Metadata extraction
  console.log('🧪 4. Testing metadata extraction...');
  try {
    const data = await extractResourceData('./tmp/merge-validation-test.package', METADATA_TGI);
    if (!data) {
      console.log('❌ No metadata resource found');
      process.exit(1);
    }
    const json = data.toString('utf8');
    const metadata = JSON.parse(json);
    console.log(`✅ Metadata extracted: ${metadata.originalPackages.length} packages`);
  } catch (error) {
    console.log(`❌ Metadata validation failed: ${error.message}`);
    process.exit(1);
  }

  console.log('\n🎉 All validations passed! Merge orchestrator is working correctly.');
}

main().catch(console.error);
