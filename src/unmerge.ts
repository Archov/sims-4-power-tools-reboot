/**
 * Unmerge Orchestrator - Reconstructs original .package files from deduplicated merged bundles
 *
 * This module provides functionality to unmerge deduplicated merged DBPF packages back into
 * their original constituent packages using embedded resource-to-package mappings.
 */

import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { DbpfBinary } from './dbpf-binary.js';
import { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import { BinaryResource } from './types/binary-resource.js';
import { Tgi } from './types/tgi.js';
import { extractResourceData } from './metadata.js';
import { DeduplicatedMergeMetadata, PackageSummary } from './types/metadata.js';
import { METADATA_TGI } from './constants/metadata-tgi.js';
import { StandardMergeManifest, StandardMetadataUtils, StandardMergedPackage } from './types/standard-metadata.js';
import { StandardBinarySerializer } from './utils/standard-binary-serializer.js';
import { STANDARD_MANIFEST_TYPE, STANDARD_MANIFEST_GROUP, STANDARD_MANIFEST_INSTANCE } from './utils/standard-constants.js';

/**
 * Unmerge class for DBPF package reconstruction.
 */
export class UnmergeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UnmergeError';
  }
}

/**
 * Detects whether a merged package uses the standard format or deduplication format.
 */
export function detectMergeFormat(mergedStructure: DbpfBinaryStructure): 'standard' | 'deduplication' | 'unknown' {
  // Check for standard manifest resource
  const hasStandardManifest = mergedStructure.resources.some(r =>
    r.tgi.type === STANDARD_MANIFEST_TYPE &&
    r.tgi.group === STANDARD_MANIFEST_GROUP &&
    r.tgi.instance === STANDARD_MANIFEST_INSTANCE
  );

  // Check for deduplication metadata resource
  const hasDedupMetadata = mergedStructure.resources.some(r =>
    r.tgi.type === METADATA_TGI.type &&
    r.tgi.group === METADATA_TGI.group &&
    r.tgi.instance === METADATA_TGI.instance
  );


  if (hasDedupMetadata) {
    return 'deduplication'; // Prioritize deduplication format if present (what actually created the package)
  } else if (hasStandardManifest) {
    return 'standard';
  } else {
    return 'unknown';
  }
}

/**
 * Extract and parse the StandardMergeManifest from the embedded manifest resource.
 *
 * @param mergedFile - Path to the merged package file
 * @returns Parsed standard merge manifest
 * @throws UnmergeError if manifest resource is missing or corrupted
 */
async function extractStandardMergeManifest(mergedFile: string): Promise<StandardMergeManifest> {
  try {
    // Extract the manifest resource
    const manifestBuffer = await extractResourceData(mergedFile, {
      type: STANDARD_MANIFEST_TYPE,
      group: STANDARD_MANIFEST_GROUP,
      instance: STANDARD_MANIFEST_INSTANCE,
    } as Tgi);

    if (!manifestBuffer) {
      throw new UnmergeError(`No standard manifest resource found in merged package. This does not appear to be a standard merged package.`);
    }

    // Check if the data is compressed and decompress if needed
    let manifestData = manifestBuffer;
    try {
      // Try to decompress in case it's compressed
      const { inflate } = await import('zlib');
      const { promisify } = await import('util');
      const inflateAsync = promisify(inflate);
      manifestData = await inflateAsync(manifestBuffer);
    } catch (decompressError) {
      // Check if this is a zlib-specific error (indicating data is likely not compressed)
      // If it's a different type of error, rethrow it
      if (decompressError instanceof Error && decompressError.message.includes('zlib')) {
        // Decompression failed, assume data is already uncompressed
        manifestData = manifestBuffer;
      } else {
        throw decompressError;
      }
    }

    // Deserialize the binary manifest
    const manifest = StandardBinarySerializer.deserialize(manifestData);

    // Validate manifest structure
    if (manifest.version !== 1) {
      throw new UnmergeError(`Unsupported manifest version: ${manifest.version}. Expected version 1.`);
    }

    const allPackages = StandardMetadataUtils.enumeratePackages(manifest);
    console.log(`Extracted standard manifest: ${allPackages.length} packages, version ${manifest.version}`);

    return manifest;
  } catch (error) {
    if (error instanceof UnmergeError) {
      throw error;
    }
    throw new UnmergeError(
      `Failed to extract or parse standard merge manifest: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Parse the DeduplicatedMergeMetadata from the embedded metadata resource.
 *
 * @param mergedFile - Path to the merged package file
 * @returns Parsed deduplicated merge metadata
 * @throws UnmergeError if metadata resource is missing or corrupted
 */
async function extractDeduplicatedMergeMetadata(mergedFile: string): Promise<DeduplicatedMergeMetadata> {
  try {
    // Extract the metadata resource
    const metadataBuffer = await extractResourceData(mergedFile, METADATA_TGI);

    if (!metadataBuffer) {
      throw new UnmergeError(`No metadata resource found in merged package. This does not appear to be a deduplicated merged package.`);
    }

    // Parse the JSON metadata
    const metadataJson = metadataBuffer.toString('utf8');
    const rawMetadata = JSON.parse(metadataJson);

    // Convert hex strings back to numbers and bigints
    const metadata: DeduplicatedMergeMetadata = {
      version: rawMetadata.version,
      originalPackages: rawMetadata.originalPackages,
      uniqueResources: rawMetadata.uniqueResources.map((resource: any) => ({
        ...resource,
        tgi: {
          type: typeof resource.tgi.type === 'string' ? Number.parseInt(resource.tgi.type, 16) : resource.tgi.type,
          group: typeof resource.tgi.group === 'string' ? Number.parseInt(resource.tgi.group, 16) : resource.tgi.group,
          instance: typeof resource.tgi.instance === 'string' ? BigInt(resource.tgi.instance) : resource.tgi.instance,
        },
        occurrences: resource.occurrences.map((occurrence: any) => ({
          ...occurrence,
          tgi: {
            type: typeof occurrence.tgi.type === 'string' ? Number.parseInt(occurrence.tgi.type, 16) : occurrence.tgi.type,
            group: typeof occurrence.tgi.group === 'string' ? Number.parseInt(occurrence.tgi.group, 16) : occurrence.tgi.group,
            instance: typeof occurrence.tgi.instance === 'string' ? BigInt(occurrence.tgi.instance) : occurrence.tgi.instance,
          },
        })),
      })),
      totalOriginalResources: rawMetadata.totalOriginalResources,
      uniqueResourceCount: rawMetadata.uniqueResourceCount,
      mergedAt: rawMetadata.mergedAt,
    };

    // Validate metadata structure
    if (metadata.version !== "2.0-deduped") {
      throw new UnmergeError(`Unsupported metadata version: ${metadata.version}. Expected "2.0-deduped".`);
    }

    if (!metadata.originalPackages || metadata.originalPackages.length === 0) {
      throw new UnmergeError('Metadata contains no original package information.');
    }

    if (!metadata.uniqueResources || metadata.uniqueResources.length === 0) {
      throw new UnmergeError('Metadata contains no unique resource information.');
    }

    console.log(`Extracted metadata: ${metadata.originalPackages.length} original packages, ${metadata.uniqueResourceCount} unique resources`);

    return metadata;
  } catch (error) {
    if (error instanceof UnmergeError) {
      throw error;
    }
    throw new UnmergeError(
      `Failed to extract or parse deduplicated merge metadata: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Create a mapping of TGI to resource data from a standard merged package.
 * The standard format keeps all resources (no deduplication), so we map each TGI directly.
 *
 * @param mergedStructure - The structure of the standard merged package
 * @returns Map of TGI key to BinaryResource
 */
function createTgiToResourceMapStandard(mergedStructure: DbpfBinaryStructure): Map<string, BinaryResource> {
  const tgiMap = new Map<string, BinaryResource>();

  // Skip the manifest resource when building lookup
  for (const resource of mergedStructure.resources) {
    if (resource.tgi.type === STANDARD_MANIFEST_TYPE &&
        resource.tgi.group === STANDARD_MANIFEST_GROUP &&
        resource.tgi.instance === STANDARD_MANIFEST_INSTANCE) {
      continue;
    }

    const tgiKey = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
    tgiMap.set(tgiKey, resource);
  }

  return tgiMap;
}

/**
 * Create a mapping of TGI to resource data from the merged package.
 * Since the merged package contains multiple index entries pointing to deduplicated data,
 * we need to map each TGI to its corresponding resource data.
 *
 * @param mergedStructure - The structure of the merged package
 * @returns Map of TGI key to BinaryResource
 */
function createTgiToResourceMap(mergedStructure: DbpfBinaryStructure): Map<string, BinaryResource> {
  const tgiMap = new Map<string, BinaryResource>();

  // Skip the metadata resource when building lookup
  for (const resource of mergedStructure.resources) {
    if (resource.tgi.type === METADATA_TGI.type &&
        resource.tgi.group === METADATA_TGI.group &&
        resource.tgi.instance === METADATA_TGI.instance) {
      continue;
    }

    const tgiKey = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
    tgiMap.set(tgiKey, resource);
  }

  return tgiMap;
}

/**
 * Reconstruct a single original package from a standard merged package using manifest mappings.
 *
 * @param pkg - Package information from the standard merge manifest
 * @param mergedStructure - Structure of the standard merged package
 * @param tgiToResourceMap - Map of TGI to merged package resources
 * @returns Reconstructed DbpfBinaryStructure for the original package
 */
function reconstructPackageStandard(
  pkg: import('./types/standard-metadata.js').StandardMergedPackage,
  mergedStructure: DbpfBinaryStructure,
  tgiToResourceMap: Map<string, BinaryResource>
): DbpfBinaryStructure {
  // Find all resources that belong to this package using TGI mappings
  const packageResources: BinaryResource[] = [];

  for (const resourceTgi of pkg.resources) {
    const tgiKey = `${resourceTgi.type}:${resourceTgi.group}:${BigInt(resourceTgi.instance)}`;
    const mergedResource = tgiToResourceMap.get(tgiKey);

    if (!mergedResource) {
      throw new UnmergeError(
        `Resource with TGI ${tgiKey} not found in standard merged package. ` +
        `This indicates corrupted merged package data or manifest mismatch.`
      );
    }

    // Create a resource entry for this TGI occurrence
    const reconstructedResource: BinaryResource = {
      ...mergedResource,
      // Offset will be recalculated when writing
      offset: 0, // Will be set during offset recalculation
      originalOffset: mergedResource.offset, // Keep reference to merged offset
    };

    packageResources.push(reconstructedResource);
  }

  // Use original header if available, otherwise use merged package header as fallback
  let headerBuffer: Buffer;
  if (pkg.headerBytes) {
    headerBuffer = Buffer.from(pkg.headerBytes, 'base64');
  } else {
    headerBuffer = Buffer.from(mergedStructure.header);
  }

  // Create the reconstructed package structure
  const reconstructedStructure: DbpfBinaryStructure = {
    filePath: '', // Will be set when writing
    header: headerBuffer,
    resources: packageResources,
    indexTable: Buffer.alloc(0), // Will be rebuilt when writing
    totalSize: pkg.totalSize || 0, // Use stored size if available
    sha256: '', // Will be calculated when writing
    dataStartOffset: mergedStructure.dataStartOffset, // Use same data start offset
    indexOffset: 0, // Will be calculated when writing
    indexSize: 0, // Will be calculated when writing
    indexFlags: mergedStructure.indexFlags, // Use same index flags
  };

  return reconstructedStructure;
}

/**
 * Reconstruct a single original package from the merged package using metadata mappings.
 *
 * @param packageSummary - Summary of the original package to reconstruct
 * @param metadata - Full deduplicated merge metadata
 * @param mergedStructure - Structure of the merged package
 * @param tgiToResourceMap - Map of TGI to merged package resources
 * @returns Reconstructed DbpfBinaryStructure for the original package
 */
function reconstructPackage(
  packageSummary: PackageSummary,
  metadata: DeduplicatedMergeMetadata,
  mergedStructure: DbpfBinaryStructure,
  tgiToResourceMap: Map<string, BinaryResource>
): DbpfBinaryStructure {
  // Find all resources that belong to this package using TGI mappings
  const packageResources: BinaryResource[] = [];

  for (const uniqueResource of metadata.uniqueResources) {
    // Find occurrences for this package
    const packageOccurrences = uniqueResource.occurrences.filter(
      occurrence => occurrence.packageSha256 === packageSummary.sha256
    );

    if (packageOccurrences.length === 0) {
      continue; // This unique resource doesn't belong to this package
    }

    // For each occurrence in this package, look up the corresponding resource in the merged package
    for (const occurrence of packageOccurrences) {
      const tgiKey = `${occurrence.tgi.type}:${occurrence.tgi.group}:${BigInt(occurrence.tgi.instance)}`;
      const mergedResource = tgiToResourceMap.get(tgiKey);

      if (!mergedResource) {
        throw new UnmergeError(
          `Resource with TGI ${tgiKey} not found in merged package. ` +
          `This indicates corrupted merged package data or metadata mismatch.`
        );
      }

      // Create a resource entry for this TGI occurrence
      const reconstructedResource: BinaryResource = {
        ...mergedResource,
        // Offset will be recalculated when writing
        offset: 0, // Will be set during offset recalculation
        originalOffset: mergedResource.offset, // Keep reference to merged offset
      };

      packageResources.push(reconstructedResource);
    }
  }

  // Decode the original package header
  const headerBuffer = Buffer.from(packageSummary.headerBytes, 'base64');
  if (headerBuffer.length !== 96) {
    throw new UnmergeError(`Invalid header data for package ${packageSummary.filename}: expected 96 bytes, got ${headerBuffer.length}`);
  }

  // Create the reconstructed package structure
  const reconstructedStructure: DbpfBinaryStructure = {
    filePath: '', // Will be set when writing
    header: headerBuffer,
    resources: packageResources,
    indexTable: Buffer.alloc(0), // Will be rebuilt when writing
    totalSize: 0, // Will be calculated when writing
    sha256: '', // Will be calculated when writing
    dataStartOffset: mergedStructure.dataStartOffset, // Use same data start offset
    indexOffset: 0, // Will be calculated when writing
    indexSize: 0, // Will be calculated when writing
    indexFlags: mergedStructure.indexFlags, // Use same index flags
  };

  return reconstructedStructure;
}

/**
 * Recalculate resource offsets for a reconstructed package.
 * Resources are placed sequentially starting from the data start offset.
 * Returns a new DbpfBinaryStructure with updated offsets.
 *
 * @param structure - Package structure to update with new offsets
 * @returns New package structure with recalculated offsets
 */
function recalculateResourceOffsets(structure: DbpfBinaryStructure): DbpfBinaryStructure {
  let currentOffset = structure.dataStartOffset;

  // Create new resource array with updated offsets
  const updatedResources: BinaryResource[] = [];

  for (const resource of structure.resources) {
    const updatedResource: BinaryResource = {
      ...resource,
      offset: currentOffset,
    };
    updatedResources.push(updatedResource);
    currentOffset += resource.size;
  }

  // Return new structure with updated resources
  return {
    ...structure,
    resources: updatedResources,
  };
}

/**
 * Ensure the output directory exists, creating it if necessary.
 *
 * @param outputDir - Directory path to ensure exists
 */
async function ensureOutputDirectory(outputDir: string): Promise<void> {
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
      throw new UnmergeError(`Failed to create output directory "${outputDir}": ${error.message}`, error);
    }
  }
}

/**
 * Check if a file exists at the given path.
 *
 * @param filePath - Path to check
 * @returns true if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unmerge a deduplicated merged package back into its original constituent packages.
 *
 * This function reads a merged package that was created with deduplication, extracts
 * the embedded metadata resource containing package-to-resource mappings, and
 * reconstructs each original package with its exact original content and structure.
 *
 * @param mergedFile - Path to the deduplicated merged package file
 * @param outputDir - Directory where reconstructed packages will be written
 * @param options - Optional configuration for unmerge behavior
 * @throws UnmergeError if unmerging fails due to missing metadata, corrupted data, or I/O errors
 */
export async function unmergePackage(
  mergedFile: string,
  outputDir: string,
  options?: { logger?: { log: (message: string) => void; error: (message: string) => void } }
): Promise<void> {
  const logger = options?.logger ?? console;
  logger.log(`Starting unmerge operation from: ${mergedFile}`);
  logger.log(`Output will be written to: ${outputDir}`);

  // Resolve paths
  const resolvedMergedFile = resolve(mergedFile);
  const resolvedOutputDir = resolve(outputDir);

  // Ensure output directory exists
  await ensureOutputDirectory(resolvedOutputDir);

  // Read the merged package structure
  logger.log('\nReading merged package structure...');
  let mergedStructure: DbpfBinaryStructure;
  try {
    mergedStructure = await DbpfBinary.read({ filePath: resolvedMergedFile });
    logger.log(`Merged package contains ${mergedStructure.resources.length} resources`);
  } catch (error) {
    throw new UnmergeError(
      `Failed to read merged package "${resolvedMergedFile}": ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }

  // Detect the merge format
  const mergeFormat = detectMergeFormat(mergedStructure);
  logger.log(`\nDetected merge format: ${mergeFormat}`);

  if (mergeFormat === 'unknown') {
    throw new UnmergeError(
      `Package "${resolvedMergedFile}" does not appear to be a merged package. ` +
      `Could not find standard manifest (0x${STANDARD_MANIFEST_TYPE.toString(16)}:0x${STANDARD_MANIFEST_GROUP.toString(16)}:0x${STANDARD_MANIFEST_INSTANCE.toString(16)}) ` +
      `or deduplication metadata (0x${METADATA_TGI.type.toString(16)}:0x${METADATA_TGI.group.toString(16)}:${METADATA_TGI.instance.toString(16)}) resources.`
    );
  }

  let packages: StandardMergedPackage[] | PackageSummary[] = [];
  let tgiToResourceMap: Map<string, BinaryResource>;

  let manifest: StandardMergeManifest | undefined;
  let metadata: DeduplicatedMergeMetadata | undefined;

  if (mergeFormat === 'standard') {
    // Extract and parse the standard merge manifest
    logger.log('\nExtracting standard merge manifest...');
    manifest = await extractStandardMergeManifest(resolvedMergedFile);

    // Create TGI to resource map for standard format
    logger.log('\nBuilding TGI to resource map...');
    tgiToResourceMap = createTgiToResourceMapStandard(mergedStructure);

    packages = StandardMetadataUtils.enumeratePackages(manifest);
    logger.log(`\nReconstructing ${packages.length} original packages from standard merge...`);
  } else {
    // Extract and parse the deduplicated merge metadata
    logger.log('\nExtracting deduplicated merge metadata...');
    metadata = await extractDeduplicatedMergeMetadata(resolvedMergedFile);

    // Create TGI to resource map for deduplication format
    logger.log('\nBuilding TGI to resource map...');
    tgiToResourceMap = createTgiToResourceMap(mergedStructure);

    packages = Array.from(metadata.originalPackages);
    logger.log(`\nReconstructing ${packages.length} original packages from deduplicated merge...`);
  }

  // Validate that we have resources to work with
  if (tgiToResourceMap.size === 0) {
    throw new UnmergeError('No resources found in merged package (excluding metadata/manifest). This indicates corrupted merged package data.');
  }

  // Track package names to handle duplicates
  const usedNames = new Set<string>();
  const nameMapping = new Map<string, string>(); // Maps original filename to actual output filename

  // Reconstruct each original package
  for (const pkg of packages) {
    let basePackageName: string;
    let originalFilename: string;
    let reconstructedStructure: DbpfBinaryStructure;

    if (mergeFormat === 'standard') {
      // pkg is StandardMergedPackage
      const stdPkg = pkg as StandardMergedPackage;
      basePackageName = stdPkg.name;
      originalFilename = stdPkg.name;
      reconstructedStructure = reconstructPackageStandard(stdPkg, mergedStructure, tgiToResourceMap);
    } else {
      // pkg is PackageSummary from deduplication metadata
      const pkgSummary = pkg as PackageSummary;
      basePackageName = pkgSummary.filename;
      originalFilename = pkgSummary.filename;
      reconstructedStructure = reconstructPackage(pkgSummary, metadata!, mergedStructure, tgiToResourceMap);
    }

    // Handle duplicate package names by appending suffix
    let packageName = basePackageName;
    let counter = 1;
    while (usedNames.has(packageName)) {
      packageName = `${basePackageName}_${counter}`;
      counter++;
    }
    usedNames.add(packageName);

    const outputFileName = mergeFormat === 'standard'
      ? `${packageName}.package`
      : packageName;

    // Record the mapping for verification (only for deduplication format)
    if (mergeFormat === 'deduplication') {
      nameMapping.set(originalFilename, outputFileName);
    }

    logger.log(`  - Reconstructing: ${outputFileName}`);

    // Check if output file already exists
    const outputPath = resolve(resolvedOutputDir, outputFileName);
    if (await fileExists(outputPath)) {
      throw new UnmergeError(
        `Output file already exists: ${outputPath}. ` +
        `Refusing to overwrite existing files. Please choose a different output directory.`
      );
    }

    // Recalculate resource offsets for the reconstructed package
    reconstructedStructure = recalculateResourceOffsets(reconstructedStructure);

    // Write the reconstructed package
    try {
      await DbpfBinary.write({ structure: reconstructedStructure, outputPath });
      logger.log(`    ✓ Written to: ${outputPath}`);
    } catch (error) {
      throw new UnmergeError(
        `Failed to write reconstructed package "${packageName}.package": ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  // Post-unmerge verification
  logger.log('\nPerforming post-unmerge verification...');
  if (mergeFormat === 'standard') {
    await verifyReconstructedPackagesStandard(resolvedOutputDir, manifest!);
  } else {
    await verifyReconstructedPackages(resolvedOutputDir, metadata!, nameMapping);
  }

  logger.log('\nUnmerge operation completed successfully!');
  logger.log(`Reconstructed ${packages.length} packages in: ${resolvedOutputDir}`);
}

/**
 * Verify that reconstructed standard packages can be read and contain expected resources.
 *
 * @param outputDir - Directory containing reconstructed packages
 * @param manifest - Original standard merge manifest
 */
async function verifyReconstructedPackagesStandard(outputDir: string, manifest: StandardMergeManifest): Promise<void> {
  let verifiedCount = 0;
  let errorCount = 0;

  const packages = StandardMetadataUtils.enumeratePackages(manifest);

  for (const pkg of packages) {
    const packagePath = resolve(outputDir, `${pkg.name}.package`);

    try {
      const reconstructedStructure = await DbpfBinary.read({ filePath: packagePath });

      // Check that the package contains the expected number of resources
      if (reconstructedStructure.resources.length === pkg.resources.length) {
        verifiedCount++;
        console.log(`  ✓ ${pkg.name}.package: ${reconstructedStructure.resources.length} resources verified`);
      } else {
        errorCount++;
        console.error(`  ✗ ${pkg.name}.package: Resource count mismatch!`);
        console.error(`    Expected: ${pkg.resources.length} resources`);
        console.error(`    Actual:   ${reconstructedStructure.resources.length} resources`);
      }
    } catch (error) {
      errorCount++;
      console.error(`  ✗ ${pkg.name}.package: Failed to read reconstructed package - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errorCount > 0) {
    throw new UnmergeError(
      `Verification FAILED: ${errorCount} out of ${packages.length} packages failed verification. ` +
      `This indicates data corruption during the unmerge process.`
    );
  }

  console.log(`Verification PASSED: All ${verifiedCount} packages verified successfully`);
}

/**
 * Verify that reconstructed packages match their expected SHA256 hashes from metadata.
 *
 * @param outputDir - Directory containing reconstructed packages
 * @param metadata - Original deduplicated merge metadata with expected hashes
 */
async function verifyReconstructedPackages(outputDir: string, metadata: DeduplicatedMergeMetadata, nameMapping?: Map<string, string>): Promise<void> {
  let verifiedCount = 0;
  let mismatchCount = 0;

  for (const packageSummary of metadata.originalPackages) {
    // Use the mapped name if available (for handling renamed duplicates), otherwise use original filename
    const actualFilename = nameMapping?.get(packageSummary.filename) ?? packageSummary.filename;
    const packagePath = resolve(outputDir, actualFilename);

    try {
      const reconstructedStructure = await DbpfBinary.read({ filePath: packagePath });

      if (reconstructedStructure.sha256 === packageSummary.sha256) {
        verifiedCount++;
        console.log(`  ✓ ${actualFilename}: SHA256 verified`);
      } else {
        mismatchCount++;
        console.error(`  ✗ ${actualFilename}: SHA256 mismatch!`);
        console.error(`    Expected: ${packageSummary.sha256}`);
        console.error(`    Actual:   ${reconstructedStructure.sha256}`);
      }
    } catch (error) {
      mismatchCount++;
      console.error(`  ✗ ${actualFilename}: Failed to read reconstructed package - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (mismatchCount > 0) {
    throw new UnmergeError(
      `Verification FAILED: ${mismatchCount} out of ${metadata.originalPackages.length} packages failed verification. ` +
      `This indicates data corruption during the unmerge process.`
    );
  }

  console.log(`Verification PASSED: All ${verifiedCount} packages verified successfully`);
}
