/**
 * Constants for generating standard-compatible resource identifiers.
 * These values ensure compatibility with existing merge/unmerge workflows.
 */

/**
 * Standard manifest resource type identifier.
 * This is the established TGI Type used for merge metadata resources.
 */
export const STANDARD_MANIFEST_TYPE = 0x7FB6AD8A;

/**
 * Standard manifest resource group (always 0).
 */
export const STANDARD_MANIFEST_GROUP = 0x00000000;

/**
 * Standard manifest resource instance (always 0).
 */
export const STANDARD_MANIFEST_INSTANCE = 0n;
