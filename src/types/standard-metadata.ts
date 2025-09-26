/**
 * Standard-compatible merge metadata format.
 * This format ensures compatibility with existing merge/unmerge workflows.
 */

import { SerializableTgi } from './metadata.js';

// Re-export for convenience
export type { SerializableTgi };

/**
 * Represents a package in a standard merge hierarchy.
 */
export interface StandardMergedPackage {
  /** Package name (filename without extension). */
  readonly name: string;
  /** Resources contained in this package. */
  readonly resources: readonly SerializableTgi[];
  /** Original package header (96 bytes, base64 encoded) for byte-perfect reconstruction. */
  readonly headerBytes?: string;
  /** Original package total size for validation. */
  readonly totalSize?: number;
}

/**
 * Represents a folder in the merge hierarchy.
 * Folders can contain subfolders and packages.
 */
export interface StandardMergedFolder {
  /** Folder name/path component. */
  readonly name: string;
  /** Subfolders in this folder. */
  readonly folders: readonly StandardMergedFolder[];
  /** Packages in this folder. */
  readonly packages: readonly StandardMergedPackage[];
}

/**
 * Mutable version for construction.
 */
export interface MutableStandardMergedFolder {
  /** Folder name/path component. */
  name: string;
  /** Subfolders in this folder. */
  folders: MutableStandardMergedFolder[];
  /** Packages in this folder. */
  packages: StandardMergedPackage[];
}

/**
 * Root metadata structure for standard-compatible merges.
 * Uses a hierarchical tree structure to support nested merges.
 */
export interface StandardMergeManifest {
  /** Format version identifier. */
  readonly version: number;
  /** Root folder containing the entire merge hierarchy. */
  readonly root: StandardMergedFolder;
}

/**
 * Utility functions for working with standard merge metadata.
 */
export class StandardMetadataUtils {
  /**
   * Creates an empty root folder.
   */
  static createEmptyRoot(): StandardMergedFolder {
    return {
      name: '',
      folders: [],
      packages: [],
    };
  }

  /**
   * Finds all packages in the manifest hierarchy.
   */
  static enumeratePackages(manifest: StandardMergeManifest): StandardMergedPackage[] {
    const packages: StandardMergedPackage[] = [];

    const traverseFolder = (folder: StandardMergedFolder): void => {
      // Add packages from this folder
      packages.push(...folder.packages);

      // Recursively traverse subfolders
      for (const subfolder of folder.folders) {
        traverseFolder(subfolder);
      }
    };

    traverseFolder(manifest.root);
    return packages;
  }

  /**
   * Finds which package contains a specific TGI.
   */
  static findPackageForTgi(manifest: StandardMergeManifest, tgi: SerializableTgi): StandardMergedPackage | null {
    const packages = StandardMetadataUtils.enumeratePackages(manifest);

    for (const pkg of packages) {
      if (pkg.resources.some(r =>
        r.type === tgi.type &&
        r.group === tgi.group &&
        String(r.instance) === String(tgi.instance)
      )) {
        return pkg;
      }
    }

    return null;
  }
}
