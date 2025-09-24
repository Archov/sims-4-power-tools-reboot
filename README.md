# Sims 4 Power Tools Reboot

## Overview
Byte-perfect merge/unmerge tooling for Sims 4 `.package` files. The project emphasizes manual validation so QA can confirm behavior via documented commands before automated tests are added.

## Prerequisites
- Node.js 20 or newer
- npm (bundled with Node.js)

## Getting Started
```bash
npm install
```

## Core Commands
- `npm run build` – Compile TypeScript to `dist/`
- `npm run typecheck` – Static type analysis with no emit
- `npm run lint` – ESLint across `src/`
- `npm run test` – Vitest test suite (optional automation)

## Manual Validation Checklist
- **Install dependencies**: Run `npm install` and confirm it finishes without errors.
- **Compile**: Execute `npm run build`; verify `dist/` exists.
- **Type checking**: Run `npm run typecheck`; ensure it exits cleanly.
- **Placeholder tests**: Run `npm run test`; observe output (even if minimal initially).
- **DBPF round-trip validation**: Run `node scripts/round-trip-test.js --input test-packages/Grafton.package` and confirm all checks pass.
- **Docs review**: Confirm this README remains up-to-date with observed behavior.

## Project Structure
```
src/                 # TypeScript source files
node_modules/        # Installed dependencies (gitignored)
dist/                # Compiled JavaScript output
tasks/               # Task briefs with manual QA steps
test-packages/       # Fixture packages for manual checks
```

## Next Steps
Implement the tasks under `tasks/` in order, following the manual QA checklists provided in each document.
