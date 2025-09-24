# Task: Implement Metadata Capture Module (`src/metadata.ts`)

## Summary
- **Objective** Build a wrapper around `@s4tk/models` that extracts package metadata (headers, TGIs, SHA256) without touching resource payloads.
- **Outcome** A reusable helper that supplies the merge/unmerge flows with validated metadata and checksum data aligned with the implementation plan.

## Prerequisites
- **Dependencies** `@s4tk/models` installed and working in the environment.
- **Reference files** `src/types.ts` for `MergeMetadata`, `OriginalPackageInfo`, and `ResourceInfo` contracts.

## Steps
- **Load packages** Use S4TK APIs to open `.package` files and enumerate resources, capturing TGI identifiers and compression flags.
- **Compute hashes** Stream raw bytes via `readDbpfBinary()` to generate SHA256 for whole files and per-resource `rawData`.
- **Assemble structures** Convert captured data into `MergeMetadata`-compatible objects, including Base64-encoded header/index tables.
- **Expose entry points** Provide functions like `collectPackageMetadata(filePath: string)` and `buildMergeMetadata(packages: PackageInfo[])`.
- **Capture manual validation** Note the exact commands or scripts used to inspect metadata output for future QA runs.

## Definition of Done
- **Type alignment** Returned objects satisfy interfaces in `src/types.ts` without `any` usage.
- **No decompression** Resource bytes are sourced from `readDbpfBinary()` buffers to honor the "never decompress" rule.
- **Validation hooks** Errors from S4TK get surfaced with descriptive messages for CLI reporting.
- **Manual artifacts** Example metadata JSON and validation commands documented for manual review.
- **Unit coverage (optional)** Basic tests confirming metadata extraction on fixture files.

## Manual QA Checklist
- **Metadata dump** Run `node ./scripts/collect-metadata.js path/to/package.package` and inspect the JSON output for expected fields (TGI, hashes).
- **Hash confirmation** Use `node ./scripts/hash-compare.js original.package metadata-output.json` to ensure captured SHA256 matches manual calculation.
- **Error surface check** Temporarily provide an invalid package path and confirm the thrown error message is descriptive.
- **Repeatability** Execute the metadata command twice and confirm outputs are stable and can be shared with QA.

## Notes
- **Separation of concerns** Keep S4TK-specific logic inside this module so other layers stay agnostic.
- **Error surfaces** Prefer typed error classes for failure modes (missing metadata resource, invalid DBPF header, etc.).
