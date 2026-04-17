# markdown-regions

Structured, scoped read/write access to markdown documents — designed for agent–human collaboration
on long-running creative work (specs, papers, design logs, shared todo lists).

Agents address named **regions** — sections, tables, and code blocks — with optimistic-concurrency
hashes instead of raw file writes. Interleaved edits surface as conflicts; untouched regions remain
byte-identical; human formatting is preserved.

## Why

When a human and an agent share a markdown document, they need the same affordances a human
collaborator has: revise one section without touching unrelated ones, add a row to a table, answer
an inline question, stamp a decision at the end of a log. Raw file writes give flexibility without
predictability; AST-level APIs give predictability at the cost of expressiveness. This library sits
in between.

## Status

v0 feature-complete. 144 tests passing. Pre-publish.

## Quickstart

```typescript
import { open_document } from "jsr:@shnayder/markdown-regions"; // not yet published
// or, from this repo:
// import { open_document } from "./src/mod.ts";

const doc = await open_document("./project.md");

// List the region tree.
const tree = doc.list_regions();

// Read a section.
const { content, hash } = doc.read_region("open-questions");

// Answer an inline question via find/replace.
await doc.edit_region({
  id: "open-questions",
  find: "> Should we use JWTs or session cookies?",
  replacement: [
    "> Should we use JWTs or session cookies?",
    "",
    "**Decided:** session cookies.",
  ].join("\n"),
  expected_hash: hash,
});
```

Every write returns one of three shapes: `Ok` (with the new `hash`), `Conflict` (doc drifted —
re-read and retry), or `FindError` / `Error` (targeting failure — the doc is current but the call
was wrong).

## Documentation

- **[spec.md](spec.md)** — complete API reference and concurrency model
- **[usage.md](usage.md)** — worked recipes for the common collaboration patterns

## Development

Runs on [Deno](https://deno.com). No separate build or test runner config.

```
deno task test    # run the full test suite
deno task check   # type-check
deno task fmt     # format
deno task lint    # lint
```

## License

[MIT](LICENSE)
