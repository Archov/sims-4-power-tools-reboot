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
import { ResourceInfo, OriginalPackageInfo, MergeMetadata, MetadataError } from './types/metadata.js';

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
      originalOffset: resource.offset,
      compressionFlags: resource.compressionFlags,
    }));

    // Encode header as Base64
    const headerBytes: string = structure.header.toString('base64');

    return {
      filename: basename(filePath),
      sha256: structure.sha256,
      headerBytes,
      resources,
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
  const results: OriginalPackageInfo[] = [];

  for (const filePath of filePaths) {
    try {
      const metadata = await collectPackageMetadata(filePath);
      results.push(metadata);
    } catch (error) {
      throw new MetadataError(
        `Failed to process package "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  return results;
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
export async function validatePackage(filePath: string): Promise<{
  filename: string;
  sha256: string;
  resourceCount: number;
  totalSize: number;
}> {
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
