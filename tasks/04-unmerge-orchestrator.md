# Task: Implement Unmerge Orchestrator for Deduplicated Merges (src/unmerge.ts)

## Summary
- **Objective** Reconstruct original .package files from deduplicated merged DBPFs using embedded metadata resource mappings.
- **Outcome** An exported unmergePackage(mergedFile, outputDir) function that reads deduplicated merged bundles, uses resource-to-package mappings to reconstruct byte-identical originals.
- **Deduplication Handling** Process DeduplicatedMergeMetadata to determine which unique resources belong to each reconstructed package.

## Prerequisites
- **Dependencies** readDbpfBinary()/writeDbpfBinary() utilities and metadata parsing helpers.
- **Inputs** Access to deduplicated merged packages produced by the merge task for validation.
- **Metadata Format** Must handle DeduplicatedMergeMetadata with resource-to-package mappings.

## Steps
- **Load merged file** Use readDbpfBinary() to get header, unique resources, and index information.
- **Extract deduplicated metadata** Locate the METADATA_TGI resource, parse DeduplicatedMergeMetadata, and validate schema.
- **Map resources to packages** For each original package, identify which unique resources belong to it using sourcePackages mappings.
- **Rebuild packages** For each original package, create a DbpfBinaryStructure with appropriate header, selected resources, and recalculated offsets.
- **Write outputs** Persist each reconstructed package to outputDir, maintaining original filenames and verifying SHA256.
- **Validation** Compare reconstructed package checksums with metadata and throw errors on mismatches.
- **Record manual flow** Capture CLI/Node commands for unmerging deduplicated packages and verifying reconstruction.

## Definition of Done
- **API** unmergePackage(mergedFile: string, outputDir: string): Promise<void> exported for CLI integration.
- **Deduplication support** Correctly reconstructs packages from deduplicated merged bundles using resource mappings.
- **Integrity checks** SHA256 hashes for reconstructed files match the metadata entries.
- **Error surfacing** Clear messaging when metadata resource missing, corrupted, or mismatched.
- **Clean output** Creates directories as needed and never overwrites existing files without explicit intent.
- **Manual guidance** Step-by-step instructions documented for QA to reconstruct and verify deduplicated packages.

## Technical Implementation

### Deduplication-Aware Unmerging Algorithm
`
// 1. Read merged package and extract DeduplicatedMergeMetadata
// 2. For each original package in metadata:
//    - Identify unique resources that belong to this package (sourcePackages array)
//    - Create new DbpfBinaryStructure with package's header
//    - Copy resource data from merged package to reconstructed package
//    - Recalculate offsets for the reconstructed package
//    - Write reconstructed package with original filename
// 3. Validate SHA256 hashes match metadata
`

### Key Differences from Simple Unmerging
- **Resource Selection**: Must select appropriate unique resources using source package mappings
- **Offset Recalculation**: Resources get new offsets in reconstructed packages vs. merged package
- **Metadata Format**: Handles DeduplicatedMergeMetadata instead of simple package lists
- **Space Efficiency**: Reconstructed packages must expand back to match the original byte-for-byte layout (resource count, order, size, and checksum)

## Manual QA Checklist
- **Unmerge deduplicated package** Execute node dist/cli.js unmerge ./tmp/dedup-merged.package --out ./tmp/unmerged and confirm reconstruction.
- **Hash comparison** Run validation scripts to verify SHA256 parity between originals and reconstructed packages.
- **Resource mapping validation** Verify that each reconstructed package contains exactly the resources it originally had.
- **Metadata integrity** Confirm deduplicated metadata resource is correctly parsed and utilized.
- **Error handling** Attempt to unmerge invalid inputs (non-merged packages) and ensure clear error messages.

## Notes
- **Performance** Resource mapping lookups add complexity but enable perfect reconstruction.
- **Extensibility** Design supports future selective unmerging (extract specific packages).
- **Compatibility** Supports deduplicated merge metadata format produced by the merge tool.
