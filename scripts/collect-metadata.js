#!/usr/bin/env node
/**
 * Metadata collection script for DBPF packages.
 *
 * Usage:
 *   node scripts/collect-metadata.js <package-file>
 *   node scripts/collect-metadata.js <directory> [--output output.json]
 */

import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        throw new Error(`The ${arg} option requires a file path argument.`);
      }
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
    const inputStats = await stat(inputPath);
    console.log(`Collecting metadata from: ${inputPath}`);

    const replacer = (key, value) => {
      if (typeof value === 'bigint') {
        return `0x${value.toString(16)}`;
      }
      if (typeof value === 'number' && (key === 'type' || key === 'group' || key === 'instance')) {
        return `0x${value.toString(16)}`;
      }
      return value;
    };

    if (inputStats.isDirectory()) {
      const entries = await readdir(inputPath, { withFileTypes: true });
      const packageFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.package'))
        .map((entry) => resolve(inputPath, entry.name));

      if (packageFiles.length === 0) {
        console.warn('No .package files found in directory.');
        return;
      }

      const metadataList = await collectPackagesMetadata(packageFiles);
      const jsonOutput = JSON.stringify(metadataList, replacer, 2);
      if (options.output) {
        const outputPath = resolve(options.output);
        await writeFile(outputPath, jsonOutput, 'utf8');
        console.log(`Metadata written to: ${outputPath}`);
      } else {
        console.log(jsonOutput);
      }

      console.log('\nValidation:');
      for (const packagePath of packageFiles) {
        const validation = await validatePackage(packagePath);
        console.log(`- ${validation.filename}: ${validation.resourceCount} resources, ${validation.totalSize} bytes, sha256=${validation.sha256}`);
      }
      return;
    }

    const metadata = await collectPackageMetadata(inputPath);

    // Pretty print the metadata (handle BigInts and hex conversion for JSON serialization)
    const jsonOutput = JSON.stringify(metadata, replacer, 2);

    if (options.output) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, jsonOutput, 'utf8');
      console.log(`Metadata written to: ${outputPath}`);
    } else {
      console.log(jsonOutput);
    }

    // Also show validation info
    console.log('\nValidation:');
    console.log(`- Filename: ${metadata.filename}`);
    console.log(`- SHA256: ${metadata.sha256}`);
    console.log(`- Resources: ${metadata.resources.length}`);
    console.log(`- Size: ${metadata.totalSize} bytes`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
