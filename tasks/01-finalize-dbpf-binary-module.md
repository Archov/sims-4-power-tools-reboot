# Task: Finalize DBPF Binary Module (`src/dbpf-binary.ts`)

## Summary
- **Objective** Ensure the low-level DBPF reader and writer honor the 96-byte header, index layout, and raw byte preservation strategy described in `IMPLEMENTATION-PLAN.md`.
- **Outcome** A trustworthy binary layer that higher-level merge and unmerge logic can depend on without re-reading raw packages.

## Prerequisites
- **Knowledge** Understanding of the DBPF format sections (header, resource data, index table) from the plan.
- **Resources** Access to sample `.package` files in `test-packages/` for manual verification.

## Steps
- **Review existing implementation** Audit `readDbpfBinary()` and `writeDbpfBinary()` to confirm they match the plan’s requirements (no decompression, correct offsets, compression flags preserved).
- **Patch gaps** Adjust logic for index parsing/writing, compression flags, or checksum handling if discrepancies are found.
- **Add targeted checks** Extend `hashResourceData()` or add lightweight assertions to guard against regressions (e.g., header length validation).
- **Document manual validation** Capture CLI/Node commands used to confirm round-trip fidelity so others can replay them.
- **Smoke test manually** Run quick Node scripts to load and re-save a package, comparing byte sizes and hashes to validate round-trip accuracy.

## Definition of Done
- **Header compliance** 96-byte header copied verbatim and updated offsets accurate for regenerated files.
- **Resource fidelity** Stored `rawData` buffers are identical before and after writing (SHA256 match).
- **Index integrity** Calculated index size/offsets match file layout; compression flags remain untouched.
- **Documentation touchpoint** Inline comments updated where necessary to reflect any clarifications.
- **Manual guidance** README or task notes include step-by-step instructions for verifying the binary module.

## Manual QA Checklist
- **Round-trip test** Run a Node script invoking `readDbpfBinary()` then `writeDbpfBinary()` on `test-packages/` samples; compare SHA256 hashes using `node ./scripts/hash-compare.js` (or documented command).
- **Header inspection** Use `xxd` or Node buffer logging to confirm the first 96 bytes match between original and regenerated files.
- **Index verification** Print index entry offsets before/after write to ensure they line up.
- **Compression flag check** Log `compressionFlags` for a sample resource to confirm values persist unchanged.

## Notes
- **No full test suite yet** Comprehensive verification is handled in the integration task; here we focus on correctness of the core helpers.
- **Avoid refactors** Keep edits scoped—future tasks will layer additional abstractions atop this module.
