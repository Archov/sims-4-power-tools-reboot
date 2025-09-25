/**
 * Merge Orchestrator - Combines multiple DBPF packages into a single merged file
 *
 * This module provides functionality to merge multiple Sims 4 package files while
 * preserving metadata about the original packages for future unmerging operations.
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { DbpfBinary } from './dbpf-binary.js';
import { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import { BinaryResource } from './types/binary-resource.js';
import { Tgi } from './types/tgi.js';
import { collectPackagesMetadata, buildMergeMetadata, extractResourceData } from './metadata.js';
import { OriginalPackageInfo, MergeMetadata } from './types/metadata.js';

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
 * Assemble a merged DBPF structure from multiple package files.
 *
 * @param packageFiles - Array of package file paths to merge
 * @returns Merged DbpfBinaryStructure with all resources combined
 */
async function assembleMergedStructure(packageFiles: readonly string[]): Promise<DbpfBinaryStructure> {
  // Read all package structures
  const structures: DbpfBinaryStructure[] = [];
  for (const filePath of packageFiles) {
    const structure = await DbpfBinary.read({ filePath });
    structures.push(structure);
  }

  // Use the first structure as the base for header and other properties
  if (structures.length === 0) {
    throw new Error('No package structures to merge');
  }

  const baseStructure = structures[0];
  const mergedResources: BinaryResource[] = [];

  // Concatenate all resources from all packages and recalculate offsets
  let currentOffset = baseStructure.dataStartOffset; // Start after header
  for (const structure of structures) {
    for (const resource of structure.resources) {
      // Create a new resource with updated offset
      const mergedResource: BinaryResource = {
        ...resource,
        offset: currentOffset,
        originalOffset: resource.offset, // Keep original for reference
      };
      mergedResources.push(mergedResource);
      currentOffset += resource.size;
    }
  }

  // Create merged structure - we need to update offsets later when we know the final layout
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
 * Create a metadata resource containing the merge metadata.
 *
 * @param mergeMetadata - The merge metadata to embed
 * @param offset - The offset where this resource should be placed in the file
 * @returns BinaryResource containing the serialized metadata
 */
function createMetadataResource(mergeMetadata: MergeMetadata, offset: number): BinaryResource {
  // Serialize metadata to JSON with hex formatting for TGIs
  const metadataJson = JSON.stringify(mergeMetadata, (key, value) => {
    if (typeof value === 'bigint') {
      return `0x${value.toString(16)}`;
    }
    if (typeof value === 'number' && (key === 'type' || key === 'group' || key === 'instance')) {
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
 * @param originalMetadata - The original merge metadata for comparison
 */
async function verifyMergedPackage(outputFile: string, originalMetadata: MergeMetadata): Promise<void> {
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
        const numValue = parseInt(value, 16);
        if (key === 'instance') {
          return BigInt(numValue);
        }
        return numValue;
      }
      return value;
    });

    // Basic verification - check that we have the same number of original packages
    if (extractedMetadata.originalPackages.length !== originalMetadata.originalPackages.length) {
      console.error(`Verification FAILED: Expected ${originalMetadata.originalPackages.length} packages, found ${extractedMetadata.originalPackages.length}`);
      return;
    }

    console.log('Verification PASSED: Metadata resource successfully embedded and extracted');
    console.log(`Verification: Metadata contains ${extractedMetadata.originalPackages.length} original packages`);

    // Log SHA256 summary for each original package
    console.log('\nOriginal Package SHA256 Summary:');
    for (const pkg of extractedMetadata.originalPackages) {
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
  const packageFiles = await enumeratePackageFiles(resolvedInputDir);

  if (packageFiles.length === 0) {
    throw new Error(`No .package files found in directory: ${resolvedInputDir}`);
  }

  console.log(`Found ${packageFiles.length} package files to merge`);
  packageFiles.forEach(file => console.log(`  - ${file}`));

  // Collect metadata from all packages
  console.log('\nCollecting metadata from packages...');
  const packageMetadata = await collectPackagesMetadata(packageFiles);
  console.log(`Successfully collected metadata for ${packageMetadata.length} packages`);

  // Build merge metadata structure
  const mergeMetadata = buildMergeMetadata(packageMetadata);
  console.log('Merge metadata assembled');

  // Assemble merged package structure
  console.log('\nAssembling merged package structure...');
  const mergedStructure = await assembleMergedStructure(packageFiles);
  console.log(`Merged structure contains ${mergedStructure.resources.length} resources`);

  // Calculate where to place the metadata resource (after all other resources)
  const lastResource = mergedStructure.resources[mergedStructure.resources.length - 1];
  const metadataOffset = lastResource.offset + lastResource.size;

  // Embed merge metadata as a special resource at the end
  console.log('Embedding merge metadata resource...');
  const metadataResource = createMetadataResource(mergeMetadata, metadataOffset);
  mergedStructure.resources.push(metadataResource);
  console.log(`Added metadata resource with TGI: 0x${METADATA_TGI.type.toString(16)}:0x${METADATA_TGI.group.toString(16)}:${METADATA_TGI.instance.toString(16)} at offset ${metadataOffset}`);

  // Write the merged package to output file
  console.log(`\nWriting merged package to: ${outputFile}`);
  await DbpfBinary.write({ structure: mergedStructure, outputPath: outputFile });
  console.log('Merged package written successfully');

  // Post-merge verification
  console.log('\nPerforming post-merge verification...');
  await verifyMergedPackage(outputFile, mergeMetadata);
}
