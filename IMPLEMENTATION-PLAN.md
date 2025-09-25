# Sims 4 Power Tools Reboot - Implementation Plan

## Executive Summary

Implementing byte-perfect merge/unmerge CLI tool using : S4TK for metadata extraction + direct binary operations for data copying. No decompression/recompression cycle. Delivery prioritizes manually verifiable functionality, with exhaustive automated testing treated as follow-up work.

## Core Architecture Decision

**Hybrid Approach:**
- **S4TK**: Package validation, metadata extraction, TGI info only
- **Direct Binary**: Raw data copying using FileStream operations 
- **Custom DBPF Writer**: Implement correct 96-byte header structure

## Directory Structure
```
src/
├── cli.ts                 # Main CLI entry point
├── dbpf-binary.ts         # Direct binary DBPF operations 
├── merge.ts               # Merge orchestration
├── unmerge.ts             # Unmerge orchestration
├── metadata.ts            # Metadata capture/reconstruction
└── types.ts               # Core type definitions

test/
├── fixtures/              # Test .package files
└── integration.test.ts    # Full merge/unmerge cycle tests

package.json               # Dependencies: @s4tk/models, commander
README.md                  # Usage instructions
```

## Implementation Phases

### Manual Validation Doctrine
- Build each phase so it can be demonstrated with quick, observable manual checks (CLI commands, hash comparisons, file inspections).
- Provide clear validation instructions alongside feature work so non-developers can confirm behavior without reading code.
- Defer comprehensive automated coverage until core workflows are proven manually; capture deferred tests as TODOs or follow-up tasks.

### Phase 1: Binary DBPF Foundation (2-3 hours)
**File: `src/dbpf-binary.ts`**

Implement direct binary operations:

```typescript
interface DbpfBinaryStructure {
  header: Buffer;           // Exactly 96 bytes
  resources: BinaryResource[];
  indexTable: Buffer;       // 32 bytes per entry
}

interface BinaryResource {
  tgi: { type: number; group: number; instance: bigint };
  rawData: Buffer;          // Original compressed bytes - never modified
  offset: number;           // Position in merged file
  compressionFlags: number; // Preserved exactly
}

// Core functions:
function readDbpfBinary(filePath: string): DbpfBinaryStructure
function writeDbpfBinary(structure: DbpfBinaryStructure, outputPath: string): void
function extractResourceBinary(structure: DbpfBinaryStructure, tgi: TGI): Buffer
```

**Key Requirements:**
- Read raw compressed bytes directly from source files
- Never decompress/recompress resource data
- Preserve original compression flags exactly
- Implement correct DBPF structure (96-byte header, data at 0x60)
- Document manual validation: save/load a package and compare SHA256 checksums using CLI or simple Node scripts.

### Phase 2: Merge Implementation with Deduplication (3-4 hours)
**File: `src/merge.ts`**

```typescript
interface DeduplicatedMergeMetadata {
  version: "2.0-deduped";
  originalPackages: PackageSummary[];        // Package info without full resource lists
  uniqueResources: UniqueResourceInfo[];     // Unique resources with source mappings
  totalOriginalResources: number;            // Statistics
  uniqueResourceCount: number;
  mergedAt: string;
}

async function mergePackages(inputDir: string, outputFile: string): Promise<void>
```

**Process:**
1. Scan directory for .package files
2. Analyze all resources across all packages for deduplication by SHA256 content hash
3. Build deduplication map tracking which packages contain each unique resource
4. Store only unique resources in merged package (50-70% space savings typical)
5. Create `DeduplicatedMergeMetadata` with resource-to-package mappings
6. Write deduplicated merged package with metadata as special resource
7. Verify perfect unmerging capability through metadata mappings
8. Provide manual QA checklist for deduplication validation and round-trip testing.

### Phase 3: Unmerge Implementation (2-3 hours)
**File: `src/unmerge.ts`**

```typescript
async function unmergePackage(mergedFile: string, outputDir: string): Promise<void>
```

**Process:**
1. Read deduplicated merged package using S4TK (metadata extraction only)
2. Extract `DeduplicatedMergeMetadata` resource with resource-to-package mappings
3. For each original package in metadata:
   - Use `sourcePackages` mappings to identify which unique resources belong to this package
   - Create new `DbpfBinaryStructure` with package's header information
   - Copy appropriate resource data from merged package's unique resources
   - Recalculate offsets for the reconstructed package structure
   - Write reconstructed package with original filename and verify SHA256 matches metadata
4. Outline manual steps for unmerging deduplicated packages and validating reconstruction integrity.

### Phase 4: CLI Interface (1 hour)
**File: `src/cli.ts`**

```bash
# Merge all packages in folder (manual QA step)
node cli.js merge ./cc-folder --out merged.package

# Unmerge back to original packages  
node cli.js unmerge merged.package --out ./reconstructed/

# Verify reconstruction (hash comparison guidance)
node cli.js verify merged.package original-folder/
```

## Critical Technical Specifications

### DBPF Structure (From S4S Analysis)
- **Header**: Exactly 96 bytes (not 128)
- **Data Start**: Offset 0x60 (after 96-byte header)
- **Index Table**: 32 bytes per entry, positioned after data section
- **Compression**: Preserve original flags and compressed data exactly

### Methodology Rules
1. **Never decompress/recompress** resource data
2. **Copy raw bytes directly** from source to target
3. **Use S4TK for metadata only** - validation, TGI extraction
4. **Implement custom DBPF writer** - don't rely on S4TK serialization
5. **Preserve compression state exactly** - flags and data layout

## Testing Strategy

### Manual Validation Flow (Critical Path)
```text
1. Merge known fixture packages.
2. Inspect CLI output/logs for resource counts and generated file paths.
3. Run provided hash comparison command and confirm parity.
4. Optionally launch Sims 4 with reconstructed packages to observe in-game behavior.
```

### Integration Test (Deferred Automation)
```typescript
test('full merge/unmerge cycle produces identical files', async () => {
  // 1. Create test packages with known content
  // 2. Merge packages
  // 3. Unmerge packages  
  // 4. Compare SHA256 checksums - must be identical
  // 5. Verify packages still work in-game (manual)
});
```

### Validation Points
- **Pre-merge**: SHA256 of all input files (manual command documented per task)
- **Post-unmerge**: SHA256 comparison (manual CLI step)
- **S4TK validation**: Spot-check using S4TK tooling or logs
- **Game compatibility**: Manual verification with Sims 4 (primary confidence path)

## Dependencies

```json
{
  "dependencies": {
    "@s4tk/models": "^0.6.14",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.7",
    "typescript": "^5.4.5",
    "vitest": "^3.2.4"
  }
}
```

## Success Criteria

### MVP Complete When:
1. ✅ Can merge all .package files in a folder with automatic deduplication (50-70% space savings)
2. ✅ Can unmerge deduplicated merged packages back to identical original files (SHA256 match)
3. ✅ Deduplicated merged packages validate with S4TK
4. ✅ Reconstructed packages validate with S4TK and work in-game
5. ✅ CLI interface works for merge/unmerge operations with deduplication support

### Verification Process:
1. Test deduplication with real CC packages and measure space savings (target: 50-70% reduction).
2. SHA256 comparison before/after merge/unmerge cycle (manual command validation).
3. Manual verification that reconstructed packages work in-game (primary success criterion).
4. Performance test with large CC libraries (>1GB) and validate deduplication efficiency.
5. Round-trip validation ensuring metadata accurately represents source packages.

## Risk Mitigation

### Technical Risks:
- **Binary format changes**: Test with various package versions
- **Compression edge cases**: Handle different compression types
- **Large file handling**: Stream processing for >1GB libraries
- **Cross-platform**: Test on Windows/macOS/Linux

### Implementation Risks:
- **Scope creep**: Focus on core merge/unmerge only
- **Perfect being enemy of good**: Get MVP working first
- **S4TK dependency**: Keep usage minimal and well-isolated

## Next Actions

1. **Setup project**: Initialize npm project with dependencies and document manual smoke check commands.
2. **Implement Phase 1**: `dbpf-binary.ts`, conclude with manual round-trip verification instructions.
3. **Draft manual QA script**: Outline CLI/Node commands for merge/unmerge validation (automation optional later).
4. **Implement Phase 2**: Basic merge functionality, deliver manual checklist.
5. **Test with real data**: Use actual CC packages for validation and log manual observations.
