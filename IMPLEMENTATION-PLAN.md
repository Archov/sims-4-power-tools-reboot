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

### Phase 2: Merge Implementation (2-3 hours)
**File: `src/merge.ts`**

```typescript
interface MergeMetadata {
  version: string;
  originalPackages: Array<{
    filename: string;
    sha256: string;           // Checksum of original file
    headerBytes: string;      // Base64 encoded 96-byte header
    resources: Array<{
      tgi: TGI;
      rawDataHash: string;    // SHA256 of raw compressed bytes
      originalOffset: number;
      compressionFlags: number;
    }>;
  }>;
  mergedAt: string;           // ISO timestamp
}

async function mergePackages(inputDir: string, outputFile: string): Promise<void>
```

**Process:**
1. Scan directory for .package files
2. Use S4TK to validate packages and extract metadata
3. Use `dbpf-binary.ts` to read raw resource data
4. Create merge metadata with SHA256 checksums
5. Write merged package with metadata as special resource
6. Verify byte-perfect reconstruction capability
7. Provide manual QA checklist (commands to merge fixtures, compare hashes) upon completion.

### Phase 3: Unmerge Implementation (2-3 hours)
**File: `src/unmerge.ts`**

```typescript
async function unmergePackage(mergedFile: string, outputDir: string): Promise<void>
```

**Process:**
1. Read merged package using S4TK (metadata extraction only)
2. Extract merge metadata resource
3. For each original package:
   - Reconstruct exact DBPF structure using stored metadata
   - Copy raw resource data from merged file
   - Write reconstructed package using `dbpf-binary.ts`
   - Verify SHA256 matches original
4. Outline manual steps so users can run unmerge and compare outputs without inspecting internals.

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
1. ✅ Can merge all .package files in a folder
2. ✅ Can unmerge back to identical original files (SHA256 match)
3. ✅ Merged packages validate with S4TK
4. ✅ Reconstructed packages validate with S4TK
5. ✅ CLI interface works for basic operations

### Verification Process:
1. Test with real CC packages from Sims 4 community and record observed outcomes.
2. SHA256 comparison before/after merge/unmerge cycle (manual command).
3. Manual verification that reconstructed packages work in-game (primary).
4. Performance test with large CC libraries (>1GB) and note any manual findings.

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
