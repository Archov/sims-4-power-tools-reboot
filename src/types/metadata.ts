/**
 * Types and interfaces for metadata capture and merge operations.
 */
import { Tgi } from './tgi.js';

/**
 * Information about a single resource in a package.
 */
export interface ResourceInfo {
  /** Type-Group-Instance identifier for this resource. */
  readonly tgi: Tgi;
  /** SHA256 hash of the raw compressed resource data. */
  readonly rawDataHash: string;
  /** Size of the compressed resource data in bytes. */
  readonly size: number;
  /** Original byte offset of this resource in the package. */
  readonly originalOffset: number;
  /** Compression flags from the resource index entry. */
  readonly compressionFlags: number;
}

/**
 * Metadata captured from a single original package.
 */
export interface OriginalPackageInfo {
  /** Original filename of the package. */
  readonly filename: string;
  /** SHA256 hash of the entire original package file. */
  readonly sha256: string;
  /** Base64-encoded 96-byte header of the original package. */
  readonly headerBytes: string;
  /** Array of all resources in the package. */
  readonly resources: readonly ResourceInfo[];
  /** Total size of the original package file in bytes. */
  readonly totalSize: number;
}

/**
 * JSON-serializable TGI. BigInt instance is encoded as a decimal string.
 */
export interface SerializableTgi {
  readonly type: number;
  readonly group: number;
  readonly instance: string;
}

/**
 * Information about a unique resource stored in the merged package.
 * Resources are deduplicated by content hash, so each unique resource appears only once.
 */
export interface UniqueResourceInfo {
  /** Canonical TGI for this content (first occurrence). */
  readonly tgi: SerializableTgi;
  /** SHA256 hash of the raw compressed resource data. */
  readonly contentHash: string;
  /** Size of the compressed resource data in bytes (compressed). */
  readonly size?: number;
  /** Compression flags from the resource index entry. */
  readonly compressionFlags: number;
  /** List of original package filenames that contained this resource. */
  readonly sourcePackages: readonly string[];
  /** Per-package occurrences mapping for perfect unmerge. */
  readonly occurrences: readonly { readonly filename: string; readonly tgi: SerializableTgi }[];
}

/**
 * Simplified metadata for an original package in a deduplicated merge.
 */
export interface PackageSummary {
  /** Original filename of the package. */
  readonly filename: string;
  /** SHA256 hash of the entire original package file. */
  readonly sha256: string;
  /** Base64-encoded 96-byte header of the original package. */
  readonly headerBytes: string;
  /** Total number of resources in the original package. */
  readonly resourceCount: number;
  /** Total size of the original package file in bytes. */
  readonly totalSize: number;
}

/**
 * Complete metadata for a deduplicated merged package operation.
 * Uses resource deduplication to eliminate redundant storage while preserving
 * perfect unmerging capability through source package mappings.
 */
export interface DeduplicatedMergeMetadata {
  /** Version identifier for the deduplicated merge format. */
  readonly version: "2.0-deduped";
  /** Summary information for all original packages. */
  readonly originalPackages: readonly PackageSummary[];
  /** Information about each unique resource stored in the merged package. */
  readonly uniqueResources: readonly UniqueResourceInfo[];
  /** Total number of resources across all original packages (before deduplication). */
  readonly totalOriginalResources: number;
  /** Number of unique resources stored (after deduplication). */
  readonly uniqueResourceCount: number;
  /** ISO timestamp when the merge operation was performed. */
  readonly mergedAt: string;
}

/**
 * Complete metadata for a merged package operation.
 * @deprecated Use DeduplicatedMergeMetadata for new merges.
 */
export interface MergeMetadata {
  /** Version identifier for the merge format. */
  readonly version: string;
  /** Array of metadata from all original packages that were merged. */
  readonly originalPackages: readonly OriginalPackageInfo[];
  /** ISO timestamp when the merge operation was performed. */
  readonly mergedAt: string;
}

/**
 * Validation result for a package file.
 */
export interface PackageValidationInfo {
  /** Original filename of the package. */
  readonly filename: string;
  /** SHA256 hash of the entire package file. */
  readonly sha256: string;
  /** Number of resources in the package. */
  readonly resourceCount: number;
  /** Total size of the package file in bytes. */
  readonly totalSize: number;
}

/**
 * Error class for metadata-related operations.
 */
export class MetadataError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MetadataError';
  }
}
