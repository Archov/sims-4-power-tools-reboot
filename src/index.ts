/**
 * Sims 4 Power Tools Reboot - Main entry point
 *
 * Provides byte-perfect merge/unmerge functionality for Sims 4 package files.
 */

// Re-export standard merge functionality
export { mergePackagesStandard } from './standard-merger.js';

// Re-export unmerge functionality
export { unmergePackage, UnmergeError, detectMergeFormat } from './unmerge.js';

// Re-export metadata utilities
export { METADATA_TGI } from './constants/metadata-tgi.js';
