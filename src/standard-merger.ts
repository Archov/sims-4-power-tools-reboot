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
  const skippedPackages: string[] = [];

  for (const filePath of packageFiles) {
    try {
      const structure = await DbpfBinary.read({ filePath });
      packageStructures.set(filePath, structure);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Skipping corrupted package ${basename(filePath)}: ${errorMsg}`);
      skippedPackages.push(filePath);
      // Continue with other packages instead of failing completely
    }
  }

  if (packageStructures.size === 0) {
    throw new Error('No valid packages found to merge. All packages appear to be corrupted.');
  }

  if (skippedPackages.length > 0) {
    console.log(`📋 Skipped ${skippedPackages.length} corrupted packages, proceeding with ${packageStructures.size} valid packages.`);
  }

  // Create the merge manifest and resource map (only for successfully loaded packages)
  const validPackageFiles = Array.from(packageStructures.keys());
  const { manifest, resourceMap: globalResourceMap } = await createStandardManifest(validPackageFiles, packageStructures);

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

  // Get base structure to determine data start offset
  const baseStructure = Array.from(packageStructures.values())[0];
  if (!baseStructure) {
    throw new Error('No package structures available');
  }

  // Create the merged package structure (now knowing manifest size)
  const mergedStructure = await createMergedStructure(validPackageFiles, packageStructures, manifest, globalResourceMap, compressedManifestData.compressed.length);

  const manifestResource = createManifestResource(compressedManifestData, mergedStructure.dataStartOffset);

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

  // Sort packages for deterministic merging order
  // Prioritize packages with generational numbers (N##) for compatibility with standard tools,
  // but don't require this pattern - fall back to alphabetical sorting for other packages
  return packageFiles.sort((a, b) => {
    const extractNumber = (path: string): number => {
      const filename = path.split(/[/\\]/).pop() || '';
      const match = filename.match(/N(\d+)/);
      return match ? parseInt(match[1], 10) : -1; // -1 for non-generational packages
    };

    const getBaseName = (path: string): string => {
      const filename = path.split(/[/\\]/).pop() || '';
      return filename.replace(/ \(1\)$/, '').replace(/\.package$/, ''); // Remove " (1)" suffix and .package extension for comparison
    };

    const numA = extractNumber(a);
    const numB = extractNumber(b);

    // Sort generational packages by number descending, then alphabetically
    if (numA >= 0 && numB >= 0) {
      if (numA !== numB) {
        return numB - numA;
      }

      // Within same generation, sort base packages before variants
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
    }

    // At least one package doesn't follow generational naming
    // Sort all packages alphabetically for deterministic order
    return a.localeCompare(b);
  });
}

/**
 * Creates the standard merge manifest with hierarchical structure.
 */
async function createStandardManifest(
  packageFiles: readonly string[],
  packageStructures: Map<string, DbpfBinaryStructure>
): Promise<{ manifest: StandardMergeManifest; resourceMap: Map<string, BinaryResource> }> {
  // Import dependencies once at the top
  const { inflate } = await import('zlib');
  const { promisify } = await import('util');
  const inflateAsync = promisify(inflate);

  const rootFolder: MutableStandardMergedFolder = {
    name: '',
    folders: [],
    packages: [],
  };

  // Global resource map for all packages (including from nested merges)
  const globalResourceMap = new Map<string, BinaryResource>();

  // Single pass: attempt nested merge processing first, then fall back to regular package processing
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
      // For nested merges, treat the entire merged package as a single atomic unit
      // Don't try to extract and re-process individual resources - just include the whole package
      console.log(`📦 Detected nested merged package: ${packageName} (${structure.resources.length} resources)`);

      // Add a single package entry representing the entire nested merge
      const packageItem: StandardMergedPackage = {
        name: packageName,
        resources: structure.resources
          .filter(r => r.tgi.type !== STANDARD_MANIFEST_TYPE) // Exclude manifest resource
          .map(r => ({
            type: r.tgi.type,
            group: r.tgi.group,
            instance: r.tgi.instance.toString(),
          })),
        headerBytes: Buffer.from(structure.header).toString('base64'),
        totalSize: structure.totalSize,
      };

      rootFolder.packages.push(packageItem);

      // Add all resources from this nested package to the global resource map
      for (const resource of structure.resources) {
        // Skip the manifest resource itself
        if (resource.tgi.type === STANDARD_MANIFEST_TYPE &&
            resource.tgi.group === STANDARD_MANIFEST_GROUP &&
            resource.tgi.instance === STANDARD_MANIFEST_INSTANCE) {
          continue;
        }

        const key = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
        const existingResource = globalResourceMap.get(key);
        if (existingResource) {
          if (
            existingResource.size !== resource.size ||
            !existingResource.rawData.equals(resource.rawData)
          ) {
            console.warn(
              `⚠️  Resource conflict detected for TGI ${key} in nested merge "${packageName}": different content found. ` +
              `Using resource from nested package (this is normal for mod overrides).`
            );
            // Replace with the nested resource
            globalResourceMap.set(key, resource);
          }
          // If resources are identical, keep the existing one
        } else {
          globalResourceMap.set(key, resource);
        }
      }

      // Successfully processed as nested merge, skip to next package
      continue;
    }

    // Process as regular package
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
      headerBytes: Buffer.from(structure.header).toString('base64'),
      totalSize: structure.totalSize,
    };

    rootFolder.packages.push(packageItem);

    // Add resources from this regular package to the global resource map
    for (const resource of structure.resources) {
      // Skip the manifest resource itself
      if (resource.tgi.type === STANDARD_MANIFEST_TYPE &&
          resource.tgi.group === STANDARD_MANIFEST_GROUP &&
          resource.tgi.instance === STANDARD_MANIFEST_INSTANCE) {
        continue;
      }

      const key = `${resource.tgi.type}:${resource.tgi.group}:${resource.tgi.instance}`;
      const existingResource = globalResourceMap.get(key);
      if (existingResource) {
        if (
          existingResource.size !== resource.size ||
          !existingResource.rawData.equals(resource.rawData)
        ) {
          console.warn(
            `⚠️  Resource conflict detected for TGI ${key}: different content found in multiple packages. ` +
            `Using resource from current package (this is normal for mod overrides).`
          );
          // Replace with the current resource (later packages "win" in load order)
          globalResourceMap.set(key, resource);
        }
        // If resources are identical, keep the existing one (already deduplicated)
      } else {
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
function mergeHierarchies(target: MutableStandardMergedFolder, source: StandardMergedFolder): void {
  // Add all packages from source
  for (const pkg of source.packages) {
    // Skip if this package name already exists in the target manifest (prevents duplicates)
    const alreadyExists = target.packages.some(existing => existing.name === pkg.name);
    if (!alreadyExists) {
      target.packages.push(pkg);
    }
  }

  // Merge folders with conflict resolution and deep merge
  mergeFolders(target.folders, source.folders);
}

/**
 * Converts a readonly StandardMergedFolder to a mutable one recursively.
 */
function toMutableFolder(source: StandardMergedFolder): MutableStandardMergedFolder {
  return {
    name: source.name,
    folders: source.folders.map(toMutableFolder),
    packages: [...source.packages],
  };
}

/**
 * Recursively merges folders with conflict resolution.
 */
function mergeFolders(targetFolders: MutableStandardMergedFolder[], sourceFolders: readonly StandardMergedFolder[]): void {
  for (const sourceFolder of sourceFolders) {
    const targetFolder = targetFolders.find(f => f.name === sourceFolder.name);
    if (targetFolder) {
      // Recursively merge subfolders
      mergeFolders(targetFolder.folders, sourceFolder.folders);

      // Merge packages (avoid duplicates)
      for (const pkg of sourceFolder.packages) {
        if (!targetFolder.packages.some(p => p.name === pkg.name)) {
          targetFolder.packages.push(pkg);
        }
      }
    } else {
      // No conflict, add folder directly (convert to mutable)
      targetFolders.push(toMutableFolder(sourceFolder));
    }
  }
}

/**
 * Creates the merged package structure with TGI-based deduplication.
 */
async function createMergedStructure(
  packageFiles: readonly string[],
  packageStructures: Map<string, DbpfBinaryStructure>,
  manifest: StandardMergeManifest,
  globalResourceMap: Map<string, BinaryResource>,
  manifestSize: number
): Promise<DbpfBinaryStructure> {
  const mergedResources: BinaryResource[] = [];
  const tgiSet = new Set<string>(); // Track TGIs we've already included

  // Get base structure from first package
  const baseStructure = packageStructures.values().next().value;
  if (!baseStructure) {
    throw new Error('No package structures available');
  }

  // Start after the manifest
  let currentOffset = baseStructure.dataStartOffset + manifestSize;

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
  // Use Node.js zlib with level 6 (gets us to 8018 bytes as is standard)
  const { promisify } = await import('util');
  const { deflate } = await import('zlib');
  const deflateAsync = promisify(deflate);

  const compressed = await deflateAsync(data, { level: 6 });

  // Return the smaller of compressed vs original data
  const result = compressed.length < data.length ? compressed : data;
  return { compressed: result, originalSize: data.length };
}

function createManifestResource(manifestData: { compressed: Buffer; originalSize: number }, dataStartOffset: number): BinaryResource {
  // Place manifest at the beginning of the data section (after header)
  const manifestOffset = dataStartOffset;

  // Check if data is actually compressed
  const isCompressed = manifestData.compressed.length < manifestData.originalSize;
  let sizeField: number;
  let rawData: Buffer;
  let size: number;

  if (isCompressed) {
    const result = BigInt(manifestData.compressed.length) | BigInt(0x80000000);
    // Ensure it fits in 32-bit signed range for JavaScript compatibility
    const clamped = result & BigInt(0xFFFFFFFF);
    sizeField = Number(clamped);
    rawData = manifestData.compressed;
    size = manifestData.compressed.length;
  } else {
    // Use original uncompressed data when compression doesn't help
    sizeField = manifestData.originalSize;
    rawData = StandardBinarySerializer.serialize(StandardBinarySerializer.deserialize(manifestData.compressed));
    size = manifestData.originalSize;
  }

  // Debug logging for large manifests
  if (size > 1000000) { // > 1MB
    console.log(`Large manifest detected: ${size.toLocaleString()} bytes${isCompressed ? ' compressed' : ''}, ${manifestData.originalSize.toLocaleString()} bytes original`);
  }

  return {
    tgi: {
      type: STANDARD_MANIFEST_TYPE,
      group: STANDARD_MANIFEST_GROUP,
      instance: STANDARD_MANIFEST_INSTANCE,
    },
    rawData,
    offset: manifestOffset,
    originalOffset: manifestOffset,
    size,
    uncompressedSize: manifestData.originalSize,
    compressionFlags: isCompressed ? 0x5A42 : 0, // Zlib compression or uncompressed
    sizeField,
    isCompressed,
    indexEntry: Buffer.alloc(0), // Empty buffer - will trigger reconstruction logic
  };
}
