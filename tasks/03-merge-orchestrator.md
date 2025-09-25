# Task: Implement Merge Orchestrator with Deduplication (src/merge.ts)

## Summary
|- **Objective** Combine multiple .package files into a single deduplicated DBPF while generating rich metadata about the originals.
|- **Outcome** An exported mergePackages(inputDir, outputFile) function that performs automatic resource deduplication (like Sims 4 Studio), preserves perfect unmerging capability, and embeds comprehensive deduplicated metadata.
|- **Deduplication** Automatic elimination of duplicate resources by content hash, with space savings of 50-70% typical.

## Prerequisites
|- **Modules ready**
readDbpfBinary() from src/dbpf-binary.ts and metadata helpers from src/metadata.ts.
|- **Fixtures** Sample packages located under test-packages/ for manual spot-checks.

## Steps
|- **Enumerate inputs** Use node:fs utilities to list .package files within inputDir, skipping non-files.
|- **Analyze deduplication** Scan all packages to identify duplicate resources by SHA256 content hash.
|- **Build deduplication map** Create mappings of which original packages contain each unique resource.
|- **Assemble deduplicated structure** Store only unique resources in the merged package with proper offset calculation.
|- **Generate deduplicated metadata** Create DeduplicatedMergeMetadata with package summaries and resource-to-package mappings.
|- **Embed metadata resource** Encode the deduplicated metadata JSON as bytes using the reserved METADATA_TGI.
|- **Write output** Forward the deduplicated structure to writeDbpfBinary() and persist to outputFile.
|- **Post-merge verification** Log deduplication statistics, SHA256 summaries, and confirm metadata extraction.
|- **Document manual walkthrough** Record commands for merging fixtures and validating deduplication results.

## Definition of Done
|- **Function signature** mergePackages(inputDir: string, outputFile: string): Promise<void> exported as default or named.
|- **Deduplication** Automatic resource deduplication by content hash (50-70% typical space savings).
|- **Metadata accuracy** DeduplicatedMergeMetadata records original filenames, SHA256 digests, and resource-to-package mappings.
|- **Perfect unmerging** Metadata contains sufficient information to reconstruct original packages exactly.
|- **Byte preservation** No mutation of rawData buffers; compression flags and data remain untouched.
|- **Space efficiency** Only unique resources stored once, regardless of duplication across packages.
|- **Error handling** Meaningful errors for empty directories, inaccessible files, or DBPF validation failures.
|- **Manual guidance** Step-by-step CLI commands for merging, validating deduplication, and round-trip testing.

## Manual QA Checklist
|- **Deduplication merge** Run merge and verify automatic deduplication (expect 50-70% resource reduction).
|- **Space savings validation** Compare merged package size vs. sum of individual packages.
|- **Metadata inspection** Extract and validate DeduplicatedMergeMetadata with resource mappings.
|- **Round-trip validation** Use validate-merge-roundtrip.js to ensure metadata matches source packages.
|- **Hash verification** Confirm all original package SHA256s are preserved in metadata.
|- **Error scenario** Try merging empty directory and confirm descriptive error handling.

## Technical Implementation

### Deduplication Algorithm
```typescript
// 1. Analyze all resources across all packages
// 2. Group by content hash (SHA256)
// 3. Track which packages contain each unique resource
// 4. Store only unique resources in merged package
// 5. Create metadata with package-to-resource mappings
```

### Metadata Structure
```typescript
interface DeduplicatedMergeMetadata {
  version: "2.0-deduped";
  originalPackages: PackageSummary[];        // Package info without full resource lists
  uniqueResources: UniqueResourceInfo[];     // Unique resources with source mappings
  totalOriginalResources: number;            // Statistics
  uniqueResourceCount: number;
  mergedAt: string;
}
```

## Notes
|- **Performance** Deduplication analysis adds upfront cost but saves significant space.
|- **Compatibility** Maintains S4S-like behavior with automatic deduplication.
|- **Extensibility** Resource mappings enable future selective unmerging features.
|- **Space Savings** Typical 50-70% reduction in merged package size vs. simple concatenation.
