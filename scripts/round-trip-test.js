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

/**
 * Log an error message prefixed with "[round-trip-test]" and mark the process as failed.
 * @param {string} message - The error message to log.
 */
function fail(message) {
  console.error(`[round-trip-test] ${message}`);
  process.exitCode = 1;
}

/**
 * Parse command-line arguments for the script's input, output, and help options.
 *
 * Recognizes long and short forms: `--input` / `-i`, `--output` / `-o`, and `--help` / `-h`.
 * @returns {{input?: string, output?: string, help?: boolean}} An object with parsed options:
 *  - `input`: path to a .package file or directory (if provided),
 *  - `output`: explicit output path or base directory (if provided),
 *  - `help`: `true` when help was requested.
 */
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

/**
 * Print usage instructions and available CLI options for the round-trip test script.
 *
 * Displays command syntax, the accepted flags (`--input`/`-i`, `--output`/`-o`, `--help`/`-h`),
 * and the default output path behavior.
 */
function printHelp() {
  console.log(`DBPF Round-Trip Test\n\nUsage:\n  node scripts/round-trip-test.js --input <path> [--output <path>]\n\nOptions:\n  --input,  -i   Path to the source .package file or directory containing .package files\n  --output, -o   Optional output path (defaults to tmp/<name>.roundtrip.package or tmp/ for directories)\n  --help,   -h   Show this message\n`);
}

/**
 * Compute the SHA-256 hex digest of a buffer.
 * @param {Buffer|Uint8Array} buffer - Data to hash.
 * @returns {string} The SHA-256 digest encoded as a lowercase hexadecimal string.
 */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Ensure the directory at the given path exists, creating it and any missing parents.
 *
 * @param {string} path - Directory path to create; no-op if it already exists.
 */
async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

/**
 * Verifies that the given filesystem path exists and is a file or directory.
 *
 * @param {string} path - Filesystem path to validate.
 * @throws {Error} If the path does not exist or is not a file or directory. On error `fail(...)` is called (sets process exitCode to 1) before the error is rethrown.
 */
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

/**
 * Resolve an input path to one or more .package file paths.
 *
 * @param {string} inputPath - Path to a file or directory to inspect.
 * @returns {Promise<string[]>} An array of package file paths: if `inputPath` is a file, an array containing that file; if it's a directory, an array of all files in the directory whose names end with `.package` (case-insensitive), sorted.
 * @throws {Error} If `inputPath` exists but is neither a file nor a directory.
 */
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

/**
 * Determine the resolved output path to use for round-trip files based on the input and any explicit output.
 * @param {string} inputPath - Original input file or directory path.
 * @param {string|undefined} explicitOutput - If provided, this path is resolved and returned unchanged.
 * @param {import('fs').Stats} inputStats - File system stats for inputPath; used to detect whether inputPath is a directory.
 * @returns {string} Resolved output path: the explicit output if given; otherwise `tmp` for directory inputs or `tmp/<name>.roundtrip.package` for file inputs.
 */
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

/**
 * Compute the output filesystem path to use for a single input package.
 *
 * If the input path refers to a directory, returns a path inside `outputBase`
 * using the input file's basename with the `.package` extension replaced by
 * `.roundtrip.package`. If the input path refers to a single file, returns
 * `outputBase` unchanged (treated as the target file path).
 *
 * @param {string} inputPath - Original input path (file or directory entry).
 * @param {string} outputBase - Base output path or target file path.
 * @param {import('fs').Stats} inputStats - fs.Stats for the original input path.
 * @returns {string} The computed output path for the input package.
 */
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
 * Perform a round-trip read/write validation of a DBPF package and classify the outcome.
 *
 * @param {string} inputPath - Path to the package file to test.
 * @param {string} outputBase - Base path or directory where the round-tripped package will be written.
 * @param {object} inputStats - fs.Stats for the input path (used to determine output naming when input is a file).
 * @returns {string} `'perfect'` if the regenerated file is byte-identical and data integrity is preserved, `'corrected'` if metadata/header changed but resource data integrity is preserved, or `'failure'` if resource data integrity is not preserved.
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
  } else if (!headerMatch && dataIntegrityOK) {
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
 * Run the DBPF round-trip validation workflow for a file or directory of .package files.
 *
 * Parses CLI options, validates input, prepares output paths, iterates over package files to perform round-trip tests,
 * and prints per-file results and a final summary when operating on a directory.
 *
 * Side effects:
 * - Writes round-tripped package files to the chosen output location.
 * - Logs progress and results to stdout/stderr.
 * - Sets process.exitCode to 1 if any file fails when testing a directory of packages.
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
      else if (result === 'failure') failureCount++;

    } catch (error) {
      console.error(`Failed to test ${basename(packageFile)}: ${error.message}`);
      failureCount++;
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
