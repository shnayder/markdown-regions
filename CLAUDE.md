# markdown-regions

A library that exposes structured, scoped read/write access to markdown documents for agent tool
use. Agents operate on named **regions** (sections, tables, code blocks) with optimistic-concurrency
hashes instead of arbitrary file writes.

**[spec.md](spec.md) is the source of truth** for the public API. When spec and code disagree,
update one of them deliberately — don't let them drift.

## Stack

- **Runtime/tooling**: Deno. Use `deno test`, `deno fmt`, `deno lint`, `deno check`. No separate
  test runner or bundler config.
- **Assertions**: `jsr:@std/assert`.
- **Parser**: **remark/unified** via `npm:` specifiers. Use node `position` data for offset mapping.
- **Distribution**: TBD — JSR, npm (via `dnt`), or both.

## Status

Pre-implementation. Only `spec.md` and this file exist. No code, no tests, no package manifest yet.

## Load-bearing invariants

These are easy to get subtly wrong and hard to catch in review:

- **Codepoint offsets, not bytes.** Every `start`/`end`/`char_length` in the API is a Unicode
  codepoint count. Parser libraries often report byte offsets — convert at the boundary.
- **Line endings normalized to `\n`** on ingest and on write. Hashes are computed on the normalized
  form; a CRLF round-trip must not change a hash.
- **Hash = SHA-256 of canonical UTF-8 source, truncated to 16 hex chars.** For sections, the hash
  covers the heading line _and_ all descendants. Deterministic: same bytes → same hash.
- **Section hash covers descendants.** A writer holding a section hash must see a conflict if any
  nested region changed. Don't compute section hashes from only the section's own text.
- **Edits preserve untouched bytes.** Apply edits as offset-based splices on the original source —
  do not AST-rewrite-and-reserialize. Regions outside the edit must be byte-identical after write.
- **Heading is not in the editable range.** `edit_region` offsets are relative to `content`
  (post-heading). Use `rename_region` for the heading.
- **Slug collisions use positional suffixes** (`setup`, `setup-2`, `setup-3`) by order of
  appearance. IDs are not stable across edits that reorder or rename — agents must re-discover via
  `list_regions`.

## Out of scope for v0

Move/reorder, delete-region (edit the parent instead), multi-document ops, CRDT/multi-agent merge,
persisted anchor IDs. Don't build toward these yet.

## Conventions

- Tests should cover the invariants above explicitly — especially codepoint vs byte offsets on
  non-ASCII input, CRLF normalization, and section-hash-covers-descendants.
- When adding an operation, update `spec.md` in the same change.
