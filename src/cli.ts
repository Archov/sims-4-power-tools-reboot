#!/usr/bin/env node
/**
 * Sims 4 Power Tools Reboot - CLI Interface
 *
 * Command-line interface for merging and unmerging Sims 4 package files.
 */

import { Command } from 'commander';
import { mergePackagesStandard } from './standard-merger.js';
import { unmergePackage } from './unmerge.js';
import { resolve } from 'node:path';

const program = new Command();

// Version is set at build time
const version = '0.1.0';

program
  .name('sims4-tools')
  .description('Byte-perfect Sims 4 package merge/unmerge tooling')
  .version(version);

program
  .command('merge')
  .description('Merge multiple Sims 4 package files into a single merged package')
  .argument('<input-dir>', 'Directory containing .package files to merge')
  .argument('<output-file>', 'Path where the merged package will be written')
  .option('--manifest <file>', 'Optional path to save debug manifest')
  .action(async (inputDir, outputFile, options) => {
    try {
      console.log(`Merging packages from: ${inputDir}`);
      console.log(`Output will be written to: ${outputFile}`);
      console.log('');

      await mergePackagesStandard({
        inputDir: resolve(inputDir),
        outputFile: resolve(outputFile),
        manifestFile: options.manifest ? resolve(options.manifest) : undefined
      });

      console.log('');
      console.log('✅ Merge completed successfully!');

    } catch (error) {
      console.error('❌ Merge failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('unmerge')
  .description('Unmerge a merged Sims 4 package back into its original constituent packages')
  .argument('<input-file>', 'Path to the merged package file to unmerge')
  .argument('<output-dir>', 'Directory where reconstructed packages will be written')
  .action(async (inputFile, outputDir) => {
    try {
      console.log(`Unmerging package: ${inputFile}`);
      console.log(`Output will be written to: ${outputDir}`);
      console.log('');

      await unmergePackage(resolve(inputFile), resolve(outputDir));

      console.log('');
      console.log('✅ Unmerge completed successfully!');

    } catch (error) {
      console.error('❌ Unmerge failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
