# Task: Build Merge/Unmerge Integration Test Suite (`test/integration.test.ts`)

## Summary
- **Objective** Verify the end-to-end merge and unmerge flow reproduces the original `.package` files byte-for-byte.
- **Outcome** A documented manual validation flow supplemented by a Vitest integration spec (optional) that exercises the CLI modules against fixtures and enforces SHA256 parity.

## Prerequisites
- **Test framework** `vitest` installed and configured in `package.json`.
- **Fixtures** Representative `.package` files in `test-packages/` for testing.
- **Modules** Completed merge and unmerge orchestrators available for import.

## Steps
- **Define manual flow** Write a short script or README section describing how to run merge/unmerge manually and compare hashes.
- **Set up test harness** Initialize Vitest config (if needed) and stub temporary directories for outputs (optional automation).
- **Execute merge** Call `mergePackages()` on fixture directory, capturing the merged output path.
- **Execute unmerge** Call `unmergePackage()` on the merged artifact, directing output to a temp folder.
- **Assert hashes** Compare SHA256 of each reconstructed file with the original fixtures; expect exact matches.
- **Clean up** Remove temporary files/directories created during the test run and capture commands for QA reuse.

## Definition of Done
- **Manual procedure** README or task notes include a clear sequence of commands for human QA to run merge/unmerge and compare hashes.
- **Repeatable test (optional)** `npm run test` (or `vitest`) executes the integration test without manual setup when automation is implemented.
- **SHA256 guarantees** Manual or automated comparisons yield descriptive diagnostics for any mismatches.
- **Resource coverage** Validation ensures metadata resource is present and parsable.
- **CI ready (optional)** Automated test runs within reasonable time (<30s) on typical hardware when enabled.

## Manual QA Checklist
- **Prepare fixtures** Copy or reference packages under `test-packages/` and note expected file count.
- **Run merge** Execute `node dist/cli.js merge ./test-packages --out ./tmp/merged.package` and note resulting file size/hash.
- **Run unmerge** Execute `node dist/cli.js unmerge ./tmp/merged.package --out ./tmp/unmerged` and compare output directory contents to original fixtures.
- **Hash comparison** Use `node ./scripts/hash-compare-directory.js ./test-packages ./tmp/unmerged` (or documented command) to confirm parity.
- **Game check (optional)** Install reconstructed packages in Sims 4 and observe identical behavior.

## Notes
- **Performance** For large fixture sets, consider sampling a subset to keep tests fast.
- **Future expansion** Add additional cases later (e.g., selective unmerge, corrupted metadata) as separate tests.
