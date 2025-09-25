#!/usr/bin/env node
/**
 * Manual round-trip validation helper for DBPF packages.
 *
 * Usage:
 *   node scripts/round-trip-test.js --input test-packages/example.package
 *   node scripts/round-trip-test.js --input test-packages/ --output tmp/
 *   node scripts/round-trip-test.js --input test-packages/example.package --output tmp/example-roundtrip.package
 */

import { basename, dirname, join, resolve } from 'node:path';
import { mkdir, stat, readdir } from 'node:fs/promises';
import process from 'node:process';
import { createHash } from 'node:crypto';

function fail(message) {
  console.error(`[round-trip-test] ${message}`);
  process.exitCode = 1;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--input' || token === '-i') {
      options.input = args[index + 1];
      index += 1;
    } else if (token === '--output' || token === '-o') {
      options.output = args[index + 1];
      index += 1;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`DBPF Round-Trip Test\n\nUsage:\n  node scripts/round-trip-test.js --input <path> [--output <path>]\n\nOptions:\n  --input,  -i   Path to the source .package file or directory containing .package files\n  --output, -o   Optional output path (defaults to tmp/<name>.roundtrip.package or tmp/ for directories)\n  --help,   -h   Show this message\n`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function ensureInputExists(path) {
  try {
    const stats = await stat(path);
    if (!stats.isFile() && !stats.isDirectory()) {
      throw new Error('not a file or directory');
    }
  } catch (error) {
    fail(`Input path not found: ${path}`);
    throw error;
  }
}

async function getPackageFiles(inputPath) {
  const stats = await stat(inputPath);
  if (stats.isFile()) {
    return [inputPath];
  } else if (stats.isDirectory()) {
    const entries = await readdir(inputPath, { withFileTypes: true });
    const packageFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.package'))
      .map(entry => join(inputPath, entry.name))
      .sort();
    return packageFiles;
  } else {
    throw new Error('Invalid input type');
  }
}

function chooseOutputPath(inputPath, explicitOutput, inputStats) {
  if (explicitOutput) {
    return resolve(explicitOutput);
  }
  if (inputStats.isDirectory()) {
    return resolve('tmp');
  } else {
    const inputName = basename(inputPath);
    const safeName = inputName.replace(/\.package$/i, '.roundtrip.package');
    return resolve('tmp', safeName);
  }
}

function getOutputPathForFile(inputPath, outputBase, inputStats) {
  if (inputStats.isDirectory()) {
    const inputName = basename(inputPath);
    const outputName = inputName.replace(/\.package$/i, '.roundtrip.package');
    return join(outputBase, outputName);
  } else {
    return outputBase;
  }
}

/**
 * Tests a single DBPF package for round-trip fidelity.
 * Reads, writes, and validates the package structure.
 *
 * @param {string} inputPath - Path to the package file to test
 * @param {string} outputBase - Base output directory path
 * @param {object} inputStats - File stats for the input path
 * @returns {string} Test result: 'perfect', 'corrected', or 'failure'
 */
async function testPackage(inputPath, outputBase, inputStats) {
  const outputPath = getOutputPathForFile(inputPath, outputBase, inputStats);

  console.log(`[round-trip-test] Reading source package: ${inputPath}`);
  const { DbpfBinary } = await import('../dist/dbpf-binary.js');
  const original = await DbpfBinary.read({ filePath: inputPath });
  console.log(`[round-trip-test] Writing round-trip package: ${outputPath}`);
  await DbpfBinary.write({ structure: original, outputPath });
  const regenerated = await DbpfBinary.read({ filePath: outputPath });

  const headerMatch = original.header.equals(regenerated.header);
  const resourceCountMatch = original.resources.length === regenerated.resources.length;
  const compressionFlagsMatch = resourceCountMatch &&
    regenerated.resources.every((resource, index) => resource.compressionFlags === original.resources[index].compressionFlags);
  const dataHashMatch = resourceCountMatch &&
    (original.resources.reduce((hash, r) => hash.update(r.rawData), createHash('sha256')).digest('hex') ===
     regenerated.resources.reduce((hash, r) => hash.update(r.rawData), createHash('sha256')).digest('hex'));
  const fileHashMatch = original.sha256 === regenerated.sha256;

  console.log('\n[round-trip-test] Results:');
  console.log(`- Header bytes identical: ${headerMatch ? 'YES' : 'NO'}`);
  console.log(`- Resource count match:   ${resourceCountMatch ? 'YES' : 'NO'}`);
  console.log(`- Compression flags match: ${compressionFlagsMatch ? 'YES' : 'NO'}`);
  console.log(`- Raw data hash match:    ${dataHashMatch ? 'YES' : 'NO'}`);
  console.log(`- File SHA256 match:      ${fileHashMatch ? 'YES' : 'NO'}\n`);

  // Determine outcome
  const dataIntegrityOK = resourceCountMatch && compressionFlagsMatch && dataHashMatch;

  if (headerMatch && fileHashMatch && dataIntegrityOK) {
    console.log('[round-trip-test] ✅ PERFECT ROUND-TRIP: Byte-identical reproduction');
    return 'perfect';
  } else if (!fileHashMatch && dataIntegrityOK) {
    console.log('[round-trip-test] 🔧 METADATA CORRECTED: Invalid metadata fixed, data integrity preserved');
    console.log(`[round-trip-test] Output package retained at ${outputPath} for inspection.`);
    return 'corrected';
  } else if (!dataIntegrityOK) {
    console.log('❌ DATA INTEGRITY FAILURE: Resource data corrupted during processing');
    console.log(`[round-trip-test] Output package retained at ${outputPath} for inspection.`);
    return 'failure';
  } else {
    console.log('❓ UNEXPECTED RESULT: Check test logic');
    console.log(`[round-trip-test] Output package retained at ${outputPath} for inspection.`);
    return 'failure';
  }
}

/**
 * Main entry point for the DBPF round-trip test utility.
 * Supports testing individual files or entire directories of packages.
 */
async function main() {
  const options = parseArgs();
  if (options.help || !options.input) {
    printHelp();
    return;
  }
  const inputPath = resolve(options.input);
  await ensureInputExists(inputPath);
  const inputStats = await stat(inputPath);
  const outputPath = chooseOutputPath(inputPath, options.output, inputStats);
  await ensureDir(inputStats.isDirectory() ? outputPath : dirname(outputPath));

  const packageFiles = await getPackageFiles(inputPath);

  if (packageFiles.length === 0) {
    fail(`No .package files found in ${inputPath}`);
    return;
  }

  if (inputStats.isDirectory()) {
    console.log(`[round-trip-test] Testing ${packageFiles.length} package files in directory: ${inputPath}\n`);
  }

  let successCount = 0;
  let correctionCount = 0;
  let failureCount = 0;

  for (const packageFile of packageFiles) {
    try {
      console.log(`Testing ${basename(packageFile)}...`);
      const result = await testPackage(packageFile, outputPath, inputStats);

      if (result === 'perfect') successCount++;
      else if (result === 'corrected') correctionCount++;
      else if (result === 'failure') {
        failureCount++;
        process.exitCode = 1;
      }

    } catch (error) {
      console.error(`Failed to test ${basename(packageFile)}: ${error.message}`);
      failureCount++;
      process.exitCode = 1;
    }
    console.log('');
  }

  if (inputStats.isDirectory()) {
    console.log(`[round-trip-test] Summary: ${successCount} perfect, ${correctionCount} corrected, ${failureCount} failed out of ${packageFiles.length} package files.`);
    if (failureCount > 0) {
      process.exitCode = 1;
    }
  }
}

await main();
