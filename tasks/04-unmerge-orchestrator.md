# Task: Implement Unmerge Orchestrator (`src/unmerge.ts`)

## Summary
- **Objective** Reconstruct original `.package` files from a merged DBPF using the embedded metadata resource.
- **Outcome** An exported `unmergePackage(mergedFile, outputDir)` function that reads the merged bundle, pulls metadata, and writes out byte-identical originals.

## Prerequisites
- **Dependencies** `readDbpfBinary()`/`writeDbpfBinary()` utilities and metadata parsing helpers.
- **Inputs** Access to merged packages produced by the merge task for validation.

## Steps
- **Load merged file** Use `readDbpfBinary()` to get header, resources, and index information.
- **Extract metadata** Locate the `METADATA_TGI` resource, parse the JSON, and validate against expected schema.
- **Rebuild packages** For each original entry, reconstruct a `DbpfBinaryStructure` using stored header/index bytes and copy raw resource data from the merged file.
- **Write outputs** Persist each reconstructed package to `outputDir`, maintaining original filenames and verifying SHA256.
- **Validation** Compare checksums with the metadata and throw descriptive errors when mismatches arise.
- **Record manual flow** Capture the CLI/Node commands required to unmerge and verify outputs for QA.

## Definition of Done
- **API** `unmergePackage(mergedFile: string, outputDir: string): Promise<void>` exported for CLI integration.
- **Integrity checks** SHA256 hashes for reconstructed files match the metadata entries.
- **Error surfacing** Clear messaging when metadata resource missing, corrupted, or mismatched.
- **Clean output** Creates directories as needed and never overwrites existing files without explicit intent.
- **Manual guidance** Step-by-step instructions documented for QA to reconstruct and verify packages.

## Manual QA Checklist
- **Unmerge run** Execute `node dist/cli.js unmerge ./tmp/merged.package --out ./tmp/unmerged` and confirm it completes with expected file count.
- **Hash comparison** Run `node ./scripts/hash-compare-directory.js ./test-packages ./tmp/unmerged` to verify SHA256 parity.
- **Metadata spot check** Inspect the metadata resource to confirm per-resource offsets match reconstructed packages.
- **Error handling** Attempt to unmerge a package lacking metadata and ensure a descriptive error surfaces.

## Notes
- **Performance** Consider streaming reads for large merged packages, though correctness comes first.
- **Extensibility** Keep logic modular so future features (e.g., selective unmerge) can hook in.
