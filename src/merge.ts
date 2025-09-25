/**
 * Merge Orchestrator - Combines multiple DBPF packages into a single merged file
 *
 * This module provides functionality to merge multiple Sims 4 package files while
 * preserving metadata about the original packages for future unmerging operations.
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { DbpfBinary } from './dbpf-binary.js';
import { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import { BinaryResource } from './types/binary-resource.js';
import { Tgi } from './types/tgi.js';
import { collectPackagesMetadata, buildMergeMetadata, analyzePackagesForDeduplication, extractResourceData } from './metadata.js';
import { OriginalPackageInfo, MergeMetadata, DeduplicatedMergeMetadata } from './types/metadata.js';

/**
 * Reserved TGI for embedded merge metadata resource.
 * This TGI is specifically reserved for Sims 4 Power Tools metadata.
 */
export const METADATA_TGI: Tgi = {
  type: 0x12345678,    // Reserved type identifier
  group: 0x87654321,   // Reserved group identifier
  instance: 0n,        // Instance 0 for single metadata resource
};

/**
 * Enumerate all .package files in a directory.
 *
 * @param directoryPath - Path to the directory to scan
 * @returns Array of absolute paths to .package files
 */
async function enumeratePackageFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  const packageFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.package') {
      packageFiles.push(resolve(directoryPath, entry.name));
    }
  }

  return packageFiles;
}

/**
 * Assemble a deduplicated merged DBPF structure from package files and deduplication metadata.
 *
 * @param packageFiles - Array of package file paths that were analyzed
 * @param dedupMetadata - Deduplication metadata with unique resource mappings
 * @returns Merged DbpfBinaryStructure with only unique resources
 */
async function assembleDeduplicatedStructure(
  packageFiles: readonly string[],
  dedupMetadata: DeduplicatedMergeMetadata
): Promise<DbpfBinaryStructure> {
  // Read all package structures to access the actual binary data
  const packageStructures = new Map<string, DbpfBinaryStructure>();
  const filenameToPathMap = new Map<string, string>();
  for (const filePath of packageFiles) {
    const structure = await DbpfBinary.read({ filePath });
    packageStructures.set(filePath, structure);
    const filename = basename(filePath);
    filenameToPathMap.set(filename, filePath);
  }

  // Use the first structure as the base for header and other properties
  if (packageStructures.size === 0) {
    throw new Error('No package structures to merge');
  }

  // Get the first structure for reference
  const baseStructure = packageStructures.values().next().value;
  if (!baseStructure) {
    throw new Error('No package structures available for merging');
  }

  // Create resource lookup maps for each package to optimize TGI lookups from O(N*M) to O(1)
  const packageResourceMaps = new Map<string, Map<string, BinaryResource>>();
  for (const [filePath, structure] of packageStructures.entries()) {
    const resourceMap = new Map<string, BinaryResource>();
    for (const resource of structure.resources) {
      const tgiKey = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
      resourceMap.set(tgiKey, resource);
    }
    packageResourceMaps.set(filePath, resourceMap);
  }

  const mergedResources: BinaryResource[] = [];

  // Process each unique resource and find its binary data from source packages
  let currentOffset = baseStructure.dataStartOffset; // Start after header

  for (const uniqueResource of dedupMetadata.uniqueResources) {
    // Find the actual binary resource data from one of the source packages
    // We'll use the first package that contains this resource
    const sourcePackageName = uniqueResource.sourcePackages[0];
    const sourcePackagePath = filenameToPathMap.get(sourcePackageName);

    if (!sourcePackagePath) {
      throw new Error(`Source package path not found for filename "${sourcePackageName}"`);
    }

    const sourceStructure = packageStructures.get(sourcePackagePath);

    if (!sourceStructure) {
      throw new Error(`Source package "${sourcePackageName}" not found for resource ${uniqueResource.tgi.type}:${uniqueResource.tgi.group}:${uniqueResource.tgi.instance}`);
    }

    // Find the resource in the source package by TGI using optimized lookup
    // Convert SerializableTgi back to Tgi for lookup
    const tgiForLookup: Tgi = {
      type: uniqueResource.tgi.type,
      group: uniqueResource.tgi.group,
      instance: BigInt(uniqueResource.tgi.instance),
    };
    const tgiKey = `${tgiForLookup.type}:${tgiForLookup.group}:${tgiForLookup.instance}`;
    const sourceResource = packageResourceMaps.get(sourcePackagePath!)?.get(tgiKey);

    if (!sourceResource) {
      throw new Error(`Resource ${uniqueResource.tgi.type}:${uniqueResource.tgi.group}:${uniqueResource.tgi.instance} not found in source package "${sourcePackageName}"`);
    }

    // Create the merged resource with updated offset
    const mergedResource: BinaryResource = {
      ...sourceResource,
      offset: currentOffset,
      originalOffset: sourceResource.originalOffset,
    };

    mergedResources.push(mergedResource);
    currentOffset += sourceResource.size;
  }

  // Create merged structure
  const mergedStructure: DbpfBinaryStructure = {
    filePath: '', // Will be set when writing
    header: Buffer.from(baseStructure.header), // Copy the header
    resources: mergedResources,
    indexTable: Buffer.alloc(0), // Will be rebuilt when writing
    totalSize: 0, // Will be calculated when writing
    sha256: '', // Will be calculated when writing
    dataStartOffset: baseStructure.dataStartOffset, // Keep same data start offset
    indexOffset: 0, // Will be calculated when writing
    indexSize: 0, // Will be calculated when writing
    indexFlags: baseStructure.indexFlags, // Keep same flags
  };

  return mergedStructure;
}

/**
 * Create a metadata resource containing the deduplicated merge metadata.
 *
 * @param dedupMetadata - The deduplicated merge metadata to embed
 * @param offset - The offset where this resource should be placed in the file
 * @returns BinaryResource containing the serialized metadata
 */
function createMetadataResource(dedupMetadata: DeduplicatedMergeMetadata, offset: number): BinaryResource {
  // Serialize metadata to JSON with hex formatting for TGIs
  const metadataJson = JSON.stringify(dedupMetadata, (key, value) => {
    if (typeof value === 'bigint') {
      return `0x${value.toString(16)}`;
    }
    // Handle SerializableTgi - convert number fields to hex, instance is already a string
    if (key === 'tgi' && value && typeof value === 'object' && typeof value.instance === 'string') {
      return {
        type: `0x${value.type.toString(16)}`,
        group: `0x${value.group.toString(16)}`,
        instance: value.instance // Already a decimal string
      };
    }
    if (typeof value === 'number' && (key === 'type' || key === 'group')) {
      return `0x${value.toString(16)}`;
    }
    return value;
  }, 2);

  // Convert JSON string to buffer
  const metadataBuffer = Buffer.from(metadataJson, 'utf8');

  return {
    tgi: METADATA_TGI,
    rawData: metadataBuffer,
    offset: offset,
    originalOffset: offset,
    size: metadataBuffer.length,
    uncompressedSize: metadataBuffer.length,
    compressionFlags: 0, // No compression for metadata
    sizeField: metadataBuffer.length,
    isCompressed: false,
    indexEntry: Buffer.alloc(0), // Will be set when writing
  };
}

/**
 * Verify the merged package by checking metadata extraction and logging summaries.
 *
 * @param outputFile - Path to the merged package file
 * @param originalMetadata - The original deduplicated merge metadata for comparison
 */
async function verifyMergedPackage(outputFile: string, originalMetadata: DeduplicatedMergeMetadata): Promise<void> {
  try {
    // Read back the merged package
    const verificationStructure = await DbpfBinary.read({ filePath: outputFile });

    console.log(`Verification: Merged package contains ${verificationStructure.resources.length} resources`);
    console.log(`Verification: Package SHA256: ${verificationStructure.sha256}`);

    // Try to extract the metadata resource
    const metadataBuffer = await extractResourceData(outputFile, METADATA_TGI);

    if (!metadataBuffer) {
      console.error('Verification FAILED: Could not extract metadata resource from merged package');
      return;
    }

    // Parse the extracted metadata
    const extractedJson = metadataBuffer.toString('utf8');
    const extractedMetadata: MergeMetadata = JSON.parse(extractedJson, (key, value) => {
      // Convert hex strings back to numbers/bigints for TGIs
      if (typeof value === 'string' && value.startsWith('0x')) {
        if (key === 'instance') {
          return BigInt(value);
        }
        return Number.parseInt(value, 16);
      }
      return value;
    });

    // Cast to deduplicated format
    const extractedDedupMetadata = extractedMetadata as unknown as DeduplicatedMergeMetadata;

    // Basic verification - check that we have the same number of original packages
    if (extractedDedupMetadata.originalPackages.length !== originalMetadata.originalPackages.length) {
      console.error(`Verification FAILED: Expected ${originalMetadata.originalPackages.length} packages, found ${extractedDedupMetadata.originalPackages.length}`);
      return;
    }

    // Check unique resource count
    if (extractedDedupMetadata.uniqueResourceCount !== originalMetadata.uniqueResourceCount) {
      console.error(`Verification FAILED: Expected ${originalMetadata.uniqueResourceCount} unique resources, found ${extractedDedupMetadata.uniqueResourceCount}`);
      return;
    }

    console.log('Verification PASSED: Metadata resource successfully embedded and extracted');
    console.log(`Verification: Metadata contains ${extractedDedupMetadata.originalPackages.length} original packages`);
    console.log(`Verification: Metadata contains ${extractedDedupMetadata.uniqueResourceCount} unique resources (${extractedDedupMetadata.totalOriginalResources} total original resources)`);

    // Log deduplication statistics
    const duplicatesEliminated = extractedDedupMetadata.totalOriginalResources - extractedDedupMetadata.uniqueResourceCount;
    const dedupRatio = extractedDedupMetadata.totalOriginalResources > 0 ? duplicatesEliminated / extractedDedupMetadata.totalOriginalResources : 0;
    console.log(`Verification: Deduplication ratio: ${(dedupRatio * 100).toFixed(1)}% (${duplicatesEliminated} duplicates eliminated)`);

    // Log SHA256 summary for each original package
    console.log('\nOriginal Package SHA256 Summary:');
    for (const pkg of extractedDedupMetadata.originalPackages) {
      console.log(`  ${pkg.filename}: ${pkg.sha256}`);
    }

  } catch (error) {
    console.error(`Verification FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Merge multiple DBPF packages from an input directory into a single output file.
 *
 * @param inputDir - Directory containing .package files to merge
 * @param outputFile - Path where the merged package will be written
 * @throws Error if input directory is empty, inaccessible, or contains invalid packages
 */
export async function mergePackages(inputDir: string, outputFile: string): Promise<void> {
  console.log(`Starting merge operation from: ${inputDir}`);
  console.log(`Output will be written to: ${outputFile}`);

  // Resolve input directory path
  const resolvedInputDir = resolve(inputDir);

  // Enumerate .package files in the input directory
  let packageFiles = await enumeratePackageFiles(resolvedInputDir);

  if (packageFiles.length === 0) {
    throw new Error(`No .package files found in directory: ${resolvedInputDir}`);
  }

  // Filter out packages that contain our metadata resource (previously merged packages)
  const filteredPackageFiles: string[] = [];
  const skippedPackages: string[] = [];

  for (const filePath of packageFiles) {
    try {
      const structure = await DbpfBinary.read({ filePath });
      const hasMetadataResource = structure.resources.some(resource =>
        resource.tgi.type === METADATA_TGI.type &&
        resource.tgi.group === METADATA_TGI.group &&
        resource.tgi.instance === METADATA_TGI.instance
      );

      if (hasMetadataResource) {
        console.log(`  - ${filePath} (SKIPPED - contains metadata from previous merge)`);
        skippedPackages.push(filePath);
      } else {
        console.log(`  - ${filePath}`);
        filteredPackageFiles.push(filePath);
      }
    } catch (error) {
      console.error(`Failed to read package ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  if (filteredPackageFiles.length === 0) {
    throw new Error('No valid packages to merge (all packages appear to be previously merged outputs)');
  }

  // Warn about skipped packages
  if (skippedPackages.length > 0) {
    console.warn(`\n⚠️  WARNING: ${skippedPackages.length} package(s) were skipped because they contain metadata from previous merges:`);
    skippedPackages.forEach(pkg => console.warn(`   - ${pkg}`));
    console.warn('These packages should not be included in merge operations. Only merge original source packages.');
    console.warn('');
  }

  console.log(`\nFiltered to ${filteredPackageFiles.length} valid packages (excluded ${packageFiles.length - filteredPackageFiles.length} previously merged packages)`);

  packageFiles = filteredPackageFiles;

  // Analyze packages for deduplication
  console.log('\nAnalyzing packages for deduplication...');
  const dedupMetadata = await analyzePackagesForDeduplication(packageFiles);
  console.log(`Found ${dedupMetadata.totalOriginalResources} total resources across ${dedupMetadata.originalPackages.length} packages`);
  console.log(`Identified ${dedupMetadata.uniqueResourceCount} unique resources (${dedupMetadata.totalOriginalResources - dedupMetadata.uniqueResourceCount} duplicates eliminated)`);

  // Calculate space savings
  const originalTotalSize = dedupMetadata.originalPackages.reduce((sum, pkg) => sum + pkg.totalSize, 0);
  console.log(`Estimated space savings: ~${Math.round(dedupMetadata.totalOriginalResources > 0 ? (1 - dedupMetadata.uniqueResourceCount / dedupMetadata.totalOriginalResources) * 100 : 0)}% reduction in resource storage`);

  // Assemble deduplicated merged package structure
  console.log('\nAssembling deduplicated merged package structure...');
  const mergedStructure = await assembleDeduplicatedStructure(packageFiles, dedupMetadata);
  console.log(`Merged structure contains ${mergedStructure.resources.length} unique resources`);

  // Calculate where to place the metadata resource (after all other resources)
  const lastResource = mergedStructure.resources[mergedStructure.resources.length - 1];
  const metadataOffset = lastResource
    ? lastResource.offset + lastResource.size
    : mergedStructure.dataStartOffset;

  // Embed deduplicated merge metadata as a special resource at the end
  console.log('Embedding deduplicated merge metadata resource...');
  const metadataResource = createMetadataResource(dedupMetadata, metadataOffset);
  mergedStructure.resources.push(metadataResource);
  console.log(`Added metadata resource with TGI: 0x${METADATA_TGI.type.toString(16)}:0x${METADATA_TGI.group.toString(16)}:${METADATA_TGI.instance.toString(16)} at offset ${metadataOffset}`);

  // Write the merged package to output file
  console.log(`\nWriting merged package to: ${outputFile}`);
  await DbpfBinary.write({ structure: mergedStructure, outputPath: outputFile });
  console.log('Merged package written successfully');

  // Post-merge verification
  console.log('\nPerforming post-merge verification...');
  await verifyMergedPackage(outputFile, dedupMetadata);
}
