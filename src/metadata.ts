/**
 * Metadata capture module using S4TK for package analysis and DBPF binary for raw data access.
 *
 * This module provides a clean interface for extracting package metadata without decompressing
 * resource payloads, maintaining the "never decompress" principle of the implementation.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BinaryResource } from './types/binary-resource.js';
import { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import { DbpfBinary } from './dbpf-binary.js';
import { Tgi } from './types/tgi.js';
import { ResourceInfo, OriginalPackageInfo, MergeMetadata, DeduplicatedMergeMetadata, UniqueResourceInfo, PackageSummary, MetadataError, PackageValidationInfo, SerializableTgi } from './types/metadata.js';

/**
 * Load a package file and extract its metadata using S4TK validation and DBPF binary access.
 *
 * @param filePath - Path to the .package file to analyze
 * @returns Metadata for the package including all resources and hashes
 * @throws MetadataError if the package cannot be loaded or analyzed
 */
export async function collectPackageMetadata(filePath: string): Promise<OriginalPackageInfo> {
  try {
    // Load the package using our DBPF binary module
    const structure: DbpfBinaryStructure = await DbpfBinary.read({ filePath });

    // Convert DBPF binary resources to metadata format
    const resources: ResourceInfo[] = structure.resources.map((resource: BinaryResource): ResourceInfo => ({
      tgi: {
        type: resource.tgi.type,
        group: resource.tgi.group,
        instance: resource.tgi.instance, // Keep as bigint for internal use
      },
      rawDataHash: DbpfBinary.hashResourceData({ resourceData: resource.rawData }),
      size: resource.size,
      originalOffset: resource.originalOffset,
      compressionFlags: resource.compressionFlags,
    }));

    // Encode header as Base64
    const headerBytes: string = structure.header.toString('base64');

    return {
      filename: basename(filePath),
      sha256: structure.sha256,
      headerBytes,
      resources,
      totalSize: structure.totalSize,
    };
  } catch (error) {
    throw new MetadataError(
      `Failed to collect metadata from package "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Collect metadata from multiple package files.
 *
 * @param filePaths - Array of paths to .package files
 * @returns Array of package metadata objects
 * @throws MetadataError if any package cannot be processed
 */
export async function collectPackagesMetadata(filePaths: readonly string[]): Promise<OriginalPackageInfo[]> {
  const promises = filePaths.map(filePath =>
    collectPackageMetadata(filePath).catch(error => {
      // Re-throw a more specific error to identify which file failed.
      throw new MetadataError(
        `Failed to process package "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    })
  );

  return Promise.all(promises);
}

/**
 * Build complete merge metadata from a collection of package metadata.
 *
 * @param packages - Array of package metadata from original packages
 * @param version - Version identifier for the merge format (defaults to "1.0")
 * @returns Complete merge metadata structure
 */
export function buildMergeMetadata(
  packages: readonly OriginalPackageInfo[],
  version: string = "1.0"
): MergeMetadata {
  return {
    version,
    originalPackages: packages,
    mergedAt: new Date().toISOString(),
  };
}

/**
 * Analyze packages for deduplication and build deduplicated merge metadata.
 * This function identifies duplicate resources by content hash and creates
 * mappings of which packages contained each unique resource.
 *
 * @param packageFiles - Array of package file paths to analyze
 * @returns Deduplicated merge metadata with resource mappings
 */
export async function analyzePackagesForDeduplication(
  packageFiles: readonly string[]
): Promise<DeduplicatedMergeMetadata> {
  // Collect metadata from all packages
  const packageMetadata = await collectPackagesMetadata(packageFiles);

  // Build deduplication map: contentHash -> deduplication info with occurrences
  const deduplicationMap = new Map<string, {
    compressionFlags: number;
    sourcePackages: Set<string>;
    occurrences: { readonly filename: string; readonly tgi: SerializableTgi }[];
  }>();

  let totalOriginalResources = 0;

  // Analyze each package and its resources
  for (const pkg of packageMetadata) {
    totalOriginalResources += pkg.resources.length;

    for (const resourceInfo of pkg.resources) {
      // Skip resources with the reserved metadata TGI (0x12345678:0x87654321:0)
      // These should not be included in deduplication as they contain Sims 4 Power Tools metadata
      if (resourceInfo.tgi.type === 0x12345678 &&
          resourceInfo.tgi.group === 0x87654321 &&
          resourceInfo.tgi.instance === 0n) {
        continue;
      }

      const contentHash = resourceInfo.rawDataHash;
      const packageName = pkg.filename;
      const serializableTgi: SerializableTgi = {
        type: resourceInfo.tgi.type,
        group: resourceInfo.tgi.group,
        instance: resourceInfo.tgi.instance.toString(),
      };

      let entry = deduplicationMap.get(contentHash);
      if (!entry) {
        entry = {
          compressionFlags: resourceInfo.compressionFlags,
          sourcePackages: new Set<string>(),
          occurrences: [],
        };
        deduplicationMap.set(contentHash, entry);
      }
      entry.sourcePackages.add(packageName);
      entry.occurrences.push({ filename: packageName, tgi: serializableTgi });
    }
  }

  // Convert to final format
  const uniqueResources: UniqueResourceInfo[] = Array.from(deduplicationMap.entries()).map(
    ([contentHash, data]) => ({
      tgi: data.occurrences[0].tgi,
      contentHash,
      // size intentionally omitted here; can be filled during assembly if needed
      compressionFlags: data.compressionFlags,
      sourcePackages: Array.from(data.sourcePackages),
      occurrences: data.occurrences,
    })
  );

  // Create package summaries
  const packageSummaries: PackageSummary[] = packageMetadata.map(pkg => ({
    filename: pkg.filename,
    sha256: pkg.sha256,
    headerBytes: pkg.headerBytes,
    resourceCount: pkg.resources.length,
    totalSize: pkg.totalSize,
  }));

  return {
    version: "2.0-deduped",
    originalPackages: packageSummaries,
    uniqueResources,
    totalOriginalResources,
    uniqueResourceCount: uniqueResources.length,
    mergedAt: new Date().toISOString(),
  };
}

/**
 * Extract a specific resource's raw data from a package by TGI.
 *
 * @param packagePath - Path to the package file
 * @param tgi - TGI identifier to search for
 * @returns Raw resource data buffer, or null if not found
 * @throws MetadataError if the package cannot be accessed
 */
export async function extractResourceData(
  packagePath: string,
  tgi: Tgi
): Promise<Buffer | null> {
  try {
    const structure = await DbpfBinary.read({ filePath: packagePath });
    return DbpfBinary.extractResource({ structure, tgi });
  } catch (error) {
    throw new MetadataError(
      `Failed to extract resource data from "${packagePath}": ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Validate that a package file can be read and contains valid metadata.
 *
 * @param filePath - Path to the package file to validate
 * @returns Validation result with basic package information
 * @throws MetadataError if validation fails
 */
export async function validatePackage(filePath: string): Promise<PackageValidationInfo> {
  try {
    const structure = await DbpfBinary.read({ filePath });

    return {
      filename: basename(filePath),
      sha256: structure.sha256,
      resourceCount: structure.resources.length,
      totalSize: structure.totalSize,
    };
  } catch (error) {
    throw new MetadataError(
      `Package validation failed for "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}
