#!/usr/bin/env node
/**
 * Validate merged package metadata against source packages.
 * Ensures merge metadata accurately reflects the original packages.
 *
 * Usage: node scripts/validate-merge-roundtrip.js <merged-package> <original-dir>
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { extractResourceData } from '../dist/metadata.js';
import { METADATA_TGI } from '../dist/merge.js';
import { DbpfBinary } from '../dist/dbpf-binary.js';

function printUsage() {
  console.log(`
Validate Merged Package Metadata

Tests that merged package metadata accurately reflects the original source packages.

Usage:
  node scripts/validate-merge-roundtrip.js <merged-package> <original-dir>

Arguments:
  merged-package    Path to the merged .package file
  original-dir      Directory containing the original .package files

Examples:
  node scripts/validate-merge-roundtrip.js ./tmp/merged.package ./test-packages
  node scripts/validate-merge-roundtrip.js ./results/final.package ./source-packages

This validation:
1. Extracts metadata from merged package
2. Compares metadata against actual source packages
3. Validates SHA256 hashes and resource counts match
4. Ensures all original packages are properly represented
`);
}

async function enumeratePackageFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const packageFiles = [];

  for (const entry of entries) {
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.package') {
      packageFiles.push(resolve(directoryPath, entry.name));
    }
  }

  return packageFiles.sort();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [mergedPackagePath, originalDir] = args;
  const resolvedMerged = resolve(mergedPackagePath);
  const resolvedOriginalDir = resolve(originalDir);

  console.log('🔄 Starting merge metadata validation\n');
  console.log(`Merged package: ${resolvedMerged}`);
  console.log(`Original directory: ${resolvedOriginalDir}\n`);

  try {
    // 1. Extract metadata from merged package
    console.log('📋 1. Extracting metadata from merged package...');
    const metadataBuffer = await extractResourceData(resolvedMerged, METADATA_TGI);
    if (!metadataBuffer) {
      console.log('❌ No metadata resource found in merged package');
      process.exit(1);
    }

    const metadataJson = metadataBuffer.toString('utf8');
    const metadata = JSON.parse(metadataJson);
    console.log(`✅ Found metadata for ${metadata.originalPackages.length} original packages\n`);

    // 2. Get list of original packages and filter out previously merged ones
    console.log('📂 2. Scanning original package directory...');
    const allOriginalPackages = await enumeratePackageFiles(resolvedOriginalDir);
    console.log(`✅ Found ${allOriginalPackages.length} total package files`);

    // Filter out packages that contain our metadata resource (previously merged packages)
    const validOriginalPackages = [];
    for (const pkgPath of allOriginalPackages) {
      try {
        const structure = await DbpfBinary.read({ filePath: pkgPath });
        const hasMetadataResource = structure.resources.some(resource =>
          resource.tgi.type === 0x12345678 &&
          resource.tgi.group === 0x87654321 &&
          resource.tgi.instance === 0n
        );

        if (hasMetadataResource) {
          console.log(`   Excluding previously merged package: ${basename(pkgPath)}`);
        } else {
          validOriginalPackages.push(pkgPath);
        }
      } catch (error) {
        console.log(`   Error reading ${basename(pkgPath)}: ${error.message}`);
        process.exit(1);
      }
    }

    console.log(`✅ Found ${validOriginalPackages.length} valid original package files (excluded ${allOriginalPackages.length - validOriginalPackages.length} previously merged packages)\n`);

    // 3. Compare package counts
    console.log('🔍 3. Validating package counts...');
    if (metadata.originalPackages.length !== validOriginalPackages.length) {
      console.log(`❌ Mismatch: metadata lists ${metadata.originalPackages.length} packages, but found ${validOriginalPackages.length} valid packages in directory`);
      process.exit(1);
    }
    console.log('✅ Package counts match\n');

    // 4. Validate each original package metadata
    console.log('🔄 4. Validating metadata integrity...');
    let successCount = 0;
    const originalPackageMap = new Map();

    // Create lookup map of valid original packages by filename
    for (const pkgPath of validOriginalPackages) {
      const filename = basename(pkgPath);
      const structure = await DbpfBinary.read({ filePath: pkgPath });
      originalPackageMap.set(filename, {
        path: pkgPath,
        sha256: structure.sha256,
        resources: structure.resources.length
      });
    }

    // Compare each package from metadata against originals
    for (const metaPkg of metadata.originalPackages) {
      const originalPkg = originalPackageMap.get(metaPkg.filename);

      if (!originalPkg) {
        console.log(`❌ Original package not found: ${metaPkg.filename}`);
        continue;
      }

      let pkgValid = true;

      // Compare SHA256 hashes
      if (metaPkg.sha256 === originalPkg.sha256) {
        console.log(`✅ ${metaPkg.filename}: hash match`);
      } else {
        console.log(`❌ ${metaPkg.filename}: hash mismatch`);
        console.log(`   Original: ${originalPkg.sha256.slice(0, 16)}...`);
        console.log(`   Metadata: ${metaPkg.sha256.slice(0, 16)}...`);
        pkgValid = false;
      }

      // Compare resource counts
      if (metaPkg.resourceCount === originalPkg.resources) {
        console.log(`   Resources: ${metaPkg.resourceCount} ✓`);
      } else {
        console.log(`   Resources: ${metaPkg.resourceCount} (metadata) vs ${originalPkg.resources} (original) ❌`);
        pkgValid = false;
      }

      if (pkgValid) successCount++;
      console.log('');
    }

    console.log(`📊 Results: ${successCount}/${metadata.originalPackages.length} packages validated successfully`);

    // Show deduplication statistics
    const duplicatesEliminated = metadata.totalOriginalResources - metadata.uniqueResourceCount;
    const dedupRatio = duplicatesEliminated / metadata.totalOriginalResources;
    console.log(`\n📈 Deduplication Summary:`);
    console.log(`   Total original resources: ${metadata.totalOriginalResources}`);
    console.log(`   Unique resources stored: ${metadata.uniqueResourceCount}`);
    console.log(`   Deduplication ratio: ${(dedupRatio * 100).toFixed(1)}%`);
    console.log(`   Duplicates eliminated: ${duplicatesEliminated}`);

    if (successCount === metadata.originalPackages.length) {
      console.log('🎉 Metadata validation PASSED! Merged package accurately represents source packages with deduplication.');
      process.exit(0);
    } else {
      console.log('⚠️ Metadata validation FAILED! Some packages do not match their metadata.');
      process.exit(1);
    }

  } catch (error) {
    console.log(`❌ Validation failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
