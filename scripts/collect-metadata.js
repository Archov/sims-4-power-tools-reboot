#!/usr/bin/env node
/**
 * Metadata collection script for DBPF packages.
 *
 * Usage:
 *   node scripts/collect-metadata.js <package-file>
 *   node scripts/collect-metadata.js <directory> [--output output.json]
 */

import { writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { collectPackageMetadata, collectPackagesMetadata, validatePackage } from '../dist/metadata.js';

/**
 * Parse command-line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      options.output = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!options.input) {
      options.input = arg;
    }
  }

  return options;
}

/**
 * Print usage information.
 */
function printHelp() {
  console.log(`Metadata Collection Script

Usage:
  node scripts/collect-metadata.js <package-file> [--output output.json]
  node scripts/collect-metadata.js <directory> [--output output.json]

Options:
  --output, -o   Output file for JSON metadata (default: stdout)
  --help, -h     Show this help message

Examples:
  node scripts/collect-metadata.js test-packages/Grafton.package
  node scripts/collect-metadata.js test-packages/ --output metadata.json
`);
}

/**
 * Main execution function.
 */
async function main() {
  const options = parseArgs();

  if (options.help || !options.input) {
    printHelp();
    return;
  }

  const inputPath = resolve(options.input);

  try {
    // For now, let's just collect metadata from a single file
    // TODO: Add directory support as mentioned in the task
    console.log(`Collecting metadata from: ${inputPath}`);

    const metadata = await collectPackageMetadata(inputPath);

    // Pretty print the metadata (handle BigInts for JSON serialization)
    const jsonOutput = JSON.stringify(metadata, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2);

    if (options.output) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, jsonOutput, 'utf8');
      console.log(`Metadata written to: ${outputPath}`);
    } else {
      console.log(jsonOutput);
    }

    // Also show validation info
    console.log('\nValidation:');
    const validation = await validatePackage(inputPath);
    console.log(`- Filename: ${validation.filename}`);
    console.log(`- SHA256: ${validation.sha256}`);
    console.log(`- Resources: ${validation.resourceCount}`);
    console.log(`- Size: ${validation.totalSize} bytes`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
