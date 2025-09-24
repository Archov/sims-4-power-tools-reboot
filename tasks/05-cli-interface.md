# Task: Build CLI Interface (`src/cli.ts`)

## Summary
- **Objective** Deliver a command-line entry point that wires together merge and unmerge capabilities with user-friendly flags.
- **Outcome** A TypeScript CLI that can merge, unmerge, and verify packages per the implementation plan.

## Prerequisites
- **Modules needed** Merge and unmerge orchestrators, metadata helpers, and core binary utilities.
- **Tooling** `commander` dependency installed for command parsing.

- **Set up CLI skeleton** Use `commander` to define `merge`, `unmerge`, and `verify` commands with options like `--out`.
- **Hook business logic** Call into `mergePackages()` and `unmergePackage()` depending on user command; for `verify`, compare SHA256 hashes across directories.
- **Error handling** Catch and print errors with clear messages; exit with non-zero codes on failure.
- **Build script** Configure package `bin` entry or `npm` script to run the compiled CLI.
- **Document commands** Capture the exact CLI invocations and expected outputs so manual QA can reuse them.

- **Command coverage** `node dist/cli.js merge`, `unmerge`, and `verify` behave as documented.
- **Help output** `--help` displays usage examples consistent with `IMPLEMENTATION-PLAN.md`.
- **Type safety** CLI implemented in TypeScript, compiled to JavaScript in `dist/`.
- **Documentation** `README.md` updated with CLI usage and manual QA steps.
- **Manual guidance** CLI emits or references instructions that help users validate behavior without reading code.

## Manual QA Checklist
- **Help command** Run `node dist/cli.js --help` and confirm commands/options display correctly.
- **Merge smoke test** Execute `node dist/cli.js merge ./test-packages --out ./tmp/merged.package` and note summary output.
- **Unmerge smoke test** Run `node dist/cli.js unmerge ./tmp/merged.package --out ./tmp/unmerged` and verify reconstructed file count.
- **Verify command** Use `node dist/cli.js verify ./tmp/merged.package ./test-packages` and confirm success or clear failure messaging.
- **Error paths** Attempt an invalid command (e.g., missing `--out`) and ensure the CLI reports a descriptive usage error.

## Notes
- **Testing** Consider a smoke test invoking the CLI with fixture packages once integration tests exist.
- **Future enhancements** Keep structure flexible for later options like selective merges.
