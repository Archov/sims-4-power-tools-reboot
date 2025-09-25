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
 * Complete metadata for a merged package operation.
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
