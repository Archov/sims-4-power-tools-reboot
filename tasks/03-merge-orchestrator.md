# Task: Implement Merge Orchestrator (`src/merge.ts`)

## Summary
- **Objective** Combine multiple `.package` files into a single DBPF while generating rich metadata about the originals.
- **Outcome** An exported `mergePackages(inputDir, outputFile)` function that walks an input folder, gathers metadata, writes the merged binary, and embeds the metadata resource.

## Prerequisites
- **Modules ready** `readDbpfBinary()` from `src/dbpf-binary.ts` and metadata helpers from `src/metadata.ts`.
- **Fixtures** Sample packages located under `test-packages/` for manual spot-checks.

## Steps
- **Enumerate inputs** Use `node:fs` utilities to list `.package` files within `inputDir`, skipping non-files.
- **Collect metadata** For each package, call the metadata module to capture headers, index tables, and resource hashes.
- **Assemble merged structure** Concatenate all resource payloads into a new `DbpfBinaryStructure`, ensuring offsets align and compression flags remain untouched.
- **Embed metadata resource** Encode the `MergeMetadata` JSON as bytes and append it as the final resource using the reserved `METADATA_TGI`.
- **Write output** Forward the built structure to `writeDbpfBinary()` and persist to `outputFile`.
- **Post-merge verification** Log SHA256 summaries and confirm the metadata resource can be re-read.
- **Document manual walkthrough** Record the exact commands used to merge fixtures and verify outputs for future QA.

## Definition of Done
- **Function signature** `mergePackages(inputDir: string, outputFile: string): Promise<void>` exported as default or named.
- **Metadata accuracy** Metadata resource records original filenames, SHA256 digests, and per-resource hashes exactly as produced by the metadata module.
- **Byte preservation** No mutation of `rawData` buffers; offsets and sizes remain consistent.
- **Error handling** Meaningful errors for empty directories, inaccessible files, or DBPF validation failures.
- **Manual guidance** Task description or README contains step-by-step CLI commands for merging and validating outputs.

## Manual QA Checklist
- **Fixture merge** Run `node dist/cli.js merge ./test-packages --out ./tmp/merged.package` (or equivalent) and confirm completion message.
- **Metadata inspection** Execute `node ./scripts/show-metadata.js ./tmp/merged.package` and verify original filenames and hashes are listed.
- **Hash comparison** Use `node ./scripts/hash-compare.js ./tmp/merged.package ./test-packages` to ensure aggregated hashes align with expectations.
- **Error scenario** Try merging an empty directory and confirm a descriptive error is surfaced to the CLI.

## Notes
- **Performance** Use streaming or buffered reads for large libraries if needed, but correctness precedes optimization.
- **Future CLI** Ensure function resolves/rejects cleanly so `src/cli.ts` can surface results to the user.
