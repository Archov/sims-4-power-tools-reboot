/**
 * Standard-compatible package merger.
 * Produces merged packages that are compatible with existing merge/unmerge workflows.
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { DbpfBinary } from './dbpf-binary.js';
import { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import { BinaryResource } from './types/binary-resource.js';
import { Tgi } from './types/tgi.js';
import { extractResourceData } from './metadata.js';
import {
  StandardMergeManifest,
  StandardMergedFolder,
  StandardMergedPackage,
  MutableStandardMergedFolder,
  StandardMetadataUtils
} from './types/standard-metadata.js';
import { StandardBinarySerializer } from './utils/standard-binary-serializer.js';
import { STANDARD_MANIFEST_TYPE, STANDARD_MANIFEST_GROUP, STANDARD_MANIFEST_INSTANCE } from './utils/standard-constants.js';

/**
 * Standard-compatible package merger options.
 */
export interface StandardMergerOptions {
  /** Input directory containing packages to merge. */
  inputDir: string;
  /** Output file path for the merged package. */
  outputFile: string;
  /** Optional manifest output for debugging/validation. */
  manifestFile?: string;
}

/**
 * Merges multiple DBPF packages using standard-compatible format.
 * Supports nested merges and TGI-based deduplication.
 */
export async function mergePackagesStandard(options: StandardMergerOptions): Promise<void> {
  const { inputDir, outputFile, manifestFile } = options;

  console.log(`Starting standard-compatible merge operation from: ${inputDir}`);
  console.log(`Output will be written to: ${outputFile}`);

  // Resolve input directory path
  const resolvedInputDir = resolve(inputDir);

  // Enumerate package files
  const packageFiles = await enumeratePackageFiles(resolvedInputDir);
  if (packageFiles.length === 0) {
    throw new Error(`No package files found in directory: ${resolvedInputDir}`);
  }

  console.log(`Found ${packageFiles.length} package files to process`);

  // Load all package structures
  const packageStructures = new Map<string, DbpfBinaryStructure>();
  for (const filePath of packageFiles) {
    try {
      const structure = await DbpfBinary.read({ filePath });
      packageStructures.set(filePath, structure);
    } catch (error) {
      console.error(`Failed to read package ${basename(filePath)}: ${error}`);
      throw error;
    }
  }

  // Create the merge manifest and resource map
  const { manifest, resourceMap: globalResourceMap } = await createStandardManifest(packageFiles, packageStructures);

  // Create the merged package structure
  const mergedStructure = await createMergedStructure(packageFiles, packageStructures, manifest, globalResourceMap);

  // Generate and compress the manifest
  const uncompressedManifestData = StandardBinarySerializer.serialize(manifest);

  // Validate manifest size
  if (uncompressedManifestData.length > 50000000) { // 50MB limit
    throw new Error(`Manifest too large: ${uncompressedManifestData.length.toLocaleString()} bytes. This suggests a bug in manifest generation.`);
  }

  const compressedManifestData = await compressManifestData(uncompressedManifestData);

  if (compressedManifestData.compressed.length > 100000000) { // 100MB compressed limit
    throw new Error(`Compressed manifest too large: ${compressedManifestData.compressed.length.toLocaleString()} bytes. Aborting to prevent corruption.`);
  }

  const manifestResource = createManifestResource(compressedManifestData, mergedStructure.resources);

  mergedStructure.resources.unshift(manifestResource);

  // Write the merged package
  console.log(`\nWriting merged package to: ${outputFile}`);
  await DbpfBinary.write({ structure: mergedStructure, outputPath: outputFile });
  console.log('Standard-compatible merged package written successfully');

  // Save manifest for debugging if requested
  if (manifestFile) {
    console.log(`Saving manifest to: ${manifestFile}`);
    const fs = await import('node:fs/promises');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('Manifest saved successfully');
  }

  // Show summary
  const allPackages = StandardMetadataUtils.enumeratePackages(manifest);
  console.log(`\nMerge Summary:`);
  console.log(`  Total packages merged: ${allPackages.length}`);
  console.log(`  Total resources: ${mergedStructure.resources.length - 1}`); // -1 for manifest
  console.log(`  TGI-based deduplication applied`);
}

/**
 * Enumerates all package files in a directory.
 */
async function enumeratePackageFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const packageFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.package') {
      packageFiles.push(resolve(directoryPath, entry.name));
    }
  }

  // Sort packages in the same order as standard tools (by N## number, descending, base packages before variants)
  return packageFiles.sort((a, b) => {
    const extractNumber = (path: string): number => {
      const filename = path.split(/[/\\]/).pop() || '';
      const match = filename.match(/N(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const getBaseName = (path: string): string => {
      const filename = path.split(/[/\\]/).pop() || '';
      return filename.replace(/ \(1\)$/, '').replace(/\.package$/, ''); // Remove " (1)" suffix and .package extension for comparison
    };

    const numA = extractNumber(a);
    const numB = extractNumber(b);

    // First sort by number descending
    if (numA !== numB) {
      return numB - numA;
    }

    // Within same number, sort base packages before variants
    const filenameA = a.split(/[/\\]/).pop() || '';
    const filenameB = b.split(/[/\\]/).pop() || '';
    const baseA = getBaseName(a);
    const baseB = getBaseName(b);
    const isVariantA = filenameA.includes(' (1)');
    const isVariantB = filenameB.includes(' (1)');

    if (baseA === baseB) {
      // Same base name, base package comes first
      return isVariantA ? 1 : -1;
    }

    // Different base names, sort alphabetically
    return baseA.localeCompare(baseB);
  });
}

/**
 * Creates the standard merge manifest with hierarchical structure.
 */
async function createStandardManifest(
  packageFiles: readonly string[],
  packageStructures: Map<string, DbpfBinaryStructure>
): Promise<{ manifest: StandardMergeManifest; resourceMap: Map<string, BinaryResource> }> {
  const rootFolder: MutableStandardMergedFolder = {
    name: '',
    folders: [],
    packages: [],
  };

  // Track packages we've already processed from nested merges
  const processedPackages = new Set<string>();

  // Global resource map for all packages (including from nested merges)
  const globalResourceMap = new Map<string, BinaryResource>();

  // First pass: process nested merges
  for (const filePath of packageFiles) {
    const structure = packageStructures.get(filePath);
    if (!structure) continue;

    const packageName = basename(filePath, '.package');

    // Check if this is already a merged package
    const isMerged = structure.resources.some(r =>
      r.tgi.type === STANDARD_MANIFEST_TYPE &&
      r.tgi.group === STANDARD_MANIFEST_GROUP &&
      r.tgi.instance === STANDARD_MANIFEST_INSTANCE
    );

    if (isMerged) {
      // Handle nested merge - extract existing manifest and merge hierarchies
      try {
        const existingManifestData = await extractResourceData(filePath, {
          type: STANDARD_MANIFEST_TYPE,
          group: STANDARD_MANIFEST_GROUP,
          instance: STANDARD_MANIFEST_INSTANCE,
        } as Tgi);

        if (existingManifestData) {
          // Check if the data is compressed and decompress if needed
          let manifestData = existingManifestData;
          try {
            // Try to decompress in case it's compressed
            const { inflate } = await import('zlib');
            const { promisify } = await import('util');
            const inflateAsync = promisify(inflate);
            manifestData = await inflateAsync(existingManifestData);
          } catch (decompressError) {
            // If decompression fails, assume it's already uncompressed
          }

          const existingManifest = StandardBinarySerializer.deserialize(manifestData);
          mergeHierarchies(rootFolder, existingManifest.root, processedPackages);

          // Mark this nested merge package as processed so it doesn't get added as a regular package
          processedPackages.add(packageName);

          // Also add resources from the nested package to the global resource map
          for (const resource of structure.resources) {
            // Skip the manifest resource itself
            if (resource.tgi.type === STANDARD_MANIFEST_TYPE &&
                resource.tgi.group === STANDARD_MANIFEST_GROUP &&
                resource.tgi.instance === STANDARD_MANIFEST_INSTANCE) {
              continue;
            }

            const key = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
            if (!globalResourceMap.has(key)) {
              globalResourceMap.set(key, resource);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to extract nested manifest from ${packageName}, treating as regular package: ${error instanceof Error ? error.message : String(error)}`);
        // Mark as processed even on failure to prevent duplicate processing
        processedPackages.add(packageName);
      }
    }
  }

  // Second pass: process regular packages
  for (const filePath of packageFiles) {
    const structure = packageStructures.get(filePath);
    if (!structure) continue;

    const packageName = basename(filePath, '.package');

    // Skip if already processed from nested merge
    if (processedPackages.has(packageName)) {
      console.log(`Skipping processed package: ${packageName}`);
      continue;
    }

    // Skip nested merge files - we already processed them
    const isMerged = structure.resources.some(r =>
      r.tgi.type === STANDARD_MANIFEST_TYPE &&
      r.tgi.group === STANDARD_MANIFEST_GROUP &&
      r.tgi.instance === STANDARD_MANIFEST_INSTANCE
    );
    if (isMerged) {
      continue; // Skip nested merge files
    }

    const resources = structure.resources
      .filter(r => r.tgi.type !== STANDARD_MANIFEST_TYPE) // Exclude any existing manifests
      .map(r => ({
        type: r.tgi.type,
        group: r.tgi.group,
        instance: r.tgi.instance.toString(),
      }));

    const packageItem: StandardMergedPackage = {
      name: packageName,
      resources,
    };

    rootFolder.packages.push(packageItem);

    // Also add resources from this regular package to the global resource map
    for (const resource of structure.resources) {
      // Skip the manifest resource itself
      if (resource.tgi.type === STANDARD_MANIFEST_TYPE &&
          resource.tgi.group === STANDARD_MANIFEST_GROUP &&
          resource.tgi.instance === STANDARD_MANIFEST_INSTANCE) {
        continue;
      }

      const key = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
      if (!globalResourceMap.has(key)) {
        globalResourceMap.set(key, resource);
      }
    }
  }

  return {
    manifest: {
      version: 1,
      root: rootFolder,
    },
    resourceMap: globalResourceMap,
  };
}

/**
 * Merges two folder hierarchies for nested merge support.
 */
function mergeHierarchies(target: MutableStandardMergedFolder, source: StandardMergedFolder, processedPackages: Set<string>): void {
  // Add all packages from source
  for (const pkg of source.packages) {
    // Skip if this package name already exists in the target manifest (prevents duplicates)
    const alreadyExists = target.packages.some(existing => existing.name === pkg.name);
    if (!alreadyExists) {
      target.packages.push(pkg);
    }
    processedPackages.add(pkg.name);
  }

  // Merge folders (simplified - assumes no conflicts)
  target.folders.push(...source.folders);
}

/**
 * Creates the merged package structure with TGI-based deduplication.
 */
async function createMergedStructure(
  packageFiles: readonly string[],
  packageStructures: Map<string, DbpfBinaryStructure>,
  manifest: StandardMergeManifest,
  globalResourceMap: Map<string, BinaryResource>
): Promise<DbpfBinaryStructure> {
  const mergedResources: BinaryResource[] = [];
  const tgiSet = new Set<string>(); // Track TGIs we've already included

  // Get base structure from first package
  const baseStructure = packageStructures.values().next().value;
  if (!baseStructure) {
    throw new Error('No package structures available');
  }

  // Start after the manifest (which is placed at offset 96, uncompressed)
  const uncompressedManifestData = StandardBinarySerializer.serialize(manifest);
  let currentOffset = baseStructure.dataStartOffset + uncompressedManifestData.length;

  // Collect all TGIs that need to be included (with deduplication for data, but multiple index entries)
  const tgiToDataOffset = new Map<string, number>();

  // First pass: assign data offsets for each unique TGI
  const allPackages = StandardMetadataUtils.enumeratePackages(manifest);
  for (const pkg of allPackages) {
    for (const resourceTgi of pkg.resources) {
      const key = `${resourceTgi.type}:${resourceTgi.group}:${BigInt(resourceTgi.instance)}`;
      const tgiString = `${resourceTgi.type}:${resourceTgi.group}:${resourceTgi.instance}`;

      // Skip manifest resources
      if (resourceTgi.type === STANDARD_MANIFEST_TYPE) continue;

      // Skip if we've already assigned a data offset for this TGI
      if (tgiToDataOffset.has(tgiString)) continue;

      // Look up resource in the global resource map
      const sourceResource = globalResourceMap.get(key);
      if (!sourceResource) continue;

      // Assign data offset for this TGI
      tgiToDataOffset.set(tgiString, currentOffset);
      currentOffset += sourceResource.size;
    }
  }

  // Second pass: create index entries for ALL TGI occurrences (even duplicates)
  for (const pkg of allPackages) {
    for (const resourceTgi of pkg.resources) {
      const key = `${resourceTgi.type}:${resourceTgi.group}:${BigInt(resourceTgi.instance)}`;
      const tgiString = `${resourceTgi.type}:${resourceTgi.group}:${resourceTgi.instance}`;

      // Skip manifest resources
      if (resourceTgi.type === STANDARD_MANIFEST_TYPE) continue;

      // Get the data offset for this TGI
      const dataOffset = tgiToDataOffset.get(tgiString);
      if (dataOffset === undefined) continue;

      // Look up the source resource to get other properties
      const sourceResource = globalResourceMap.get(key);
      if (!sourceResource) continue;

      // Create index entry for this TGI occurrence
      const mergedResource: BinaryResource = {
        ...sourceResource,
        tgi: {
          type: resourceTgi.type,
          group: resourceTgi.group,
          instance: BigInt(resourceTgi.instance),
        },
        offset: dataOffset,
        originalOffset: sourceResource.originalOffset,
      };

      mergedResources.push(mergedResource);
    }
  }

  return {
    filePath: '',
    header: Buffer.from(baseStructure.header),
    resources: mergedResources,
    indexTable: Buffer.alloc(0),
    totalSize: 0,
    sha256: '',
    dataStartOffset: baseStructure.dataStartOffset,
    indexOffset: 0,
    indexSize: 0,
    indexFlags: baseStructure.indexFlags,
  };
}

/**
 * Creates the manifest resource to embed in the merged package.
 */
async function compressManifestData(data: Buffer): Promise<{ compressed: Buffer; originalSize: number }> {
  // Use Node.js zlib with level 6 (gets us to 8018 bytes like S4S)
  const { promisify } = await import('util');
  const { deflate } = await import('zlib');
  const deflateAsync = promisify(deflate);

  const compressed = await deflateAsync(data, { level: 6 });
  return { compressed, originalSize: data.length };
}

function createManifestResource(manifestData: { compressed: Buffer; originalSize: number }, existingResources: BinaryResource[]): BinaryResource {
  // Place manifest at the beginning of the data section (after 96-byte header)
  const manifestOffset = 96;

  // Check if data is actually compressed
  const isCompressed = manifestData.compressed.length < manifestData.originalSize;
  let sizeField: number;
  if (isCompressed) {
    const result = BigInt(manifestData.compressed.length) | BigInt(0x80000000);
    // Ensure it fits in 32-bit signed range for JavaScript compatibility
    const clamped = result & BigInt(0xFFFFFFFF);
    sizeField = Number(clamped);
  } else {
    sizeField = manifestData.compressed.length;
  }

  // Debug logging for large manifests
  if (manifestData.compressed.length > 1000000) { // > 1MB
    console.log(`Large manifest detected: ${manifestData.compressed.length.toLocaleString()} bytes compressed, ${manifestData.originalSize.toLocaleString()} bytes original`);
  }

  return {
    tgi: {
      type: STANDARD_MANIFEST_TYPE,
      group: STANDARD_MANIFEST_GROUP,
      instance: STANDARD_MANIFEST_INSTANCE,
    },
    rawData: manifestData.compressed,
    offset: manifestOffset,
    originalOffset: manifestOffset,
    size: manifestData.compressed.length,
    uncompressedSize: manifestData.originalSize,
    compressionFlags: isCompressed ? 0x5A42 : 0, // Zlib compression or uncompressed
    sizeField,
    isCompressed,
    indexEntry: Buffer.alloc(0), // Empty buffer - will trigger reconstruction logic
  };
}
