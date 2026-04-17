# Structured Markdown Access — Agent Tool Spec

**v0.1 — Draft**

## Overview

This library gives agents structured read/write access to markdown documents. It exists to support
agent–human collaboration on long-running creative work — drafting specs, writing papers,
maintaining a design log alongside a codebase — where the shared artifact is markdown because that's
where humans already keep their thinking: plain text, diffable, version-controlled, editable in any
tool.

Typical interactions:

- The agent proposes a section; the human sharpens the prose.
- The human raises a question inline; the agent answers it on the next turn.
- The agent appends to a running decision log while refactoring code.
- Either party updates a status table — adding a row, correcting a cell.

These interactions need two things at once: **predictability** — the agent shouldn't clobber a
paragraph the human just rewrote, and interleaved edits shouldn't silently overwrite each other —
and **flexibility** — the agent should still be able to restructure passages, introduce new
sections, or rewrite whole chunks when the work calls for it.

Raw file writes give flexibility without predictability. This library sits in between. Agents
address named **regions** — sections, tables, code blocks — with optimistic-concurrency hashes. They
change exactly the part of the document they mean to; concurrent edits surface as conflicts rather
than silent corruption; untouched regions remain byte-identical after write, preserving the human's
formatting choices.

Because regions are addressable by name, access can also be scoped per-region — an agent might be
given write permission on `Updates` or `Open Questions` while needing approval to modify the formal
`Spec`. Enforcing the policy is the caller's job; the library's contribution is making regions
addressable so the policy is expressible at all.

## Region Model

A **region** is a structurally meaningful span of a markdown document. Region types:

- **Section** — a heading and all content up to the next heading of equal or lesser depth. Sections
  nest. The root section is the implicit container for the entire document.
- **Table** — a markdown pipe table. Addressable for structured cell/row/column operations.
- **Code block** — a fenced code block.

Everything else (paragraphs, lists, inline content) is addressed via its containing section — not
independently.

## Region IDs

There are two ways to address a region: by **slug** (derived from structure) or by **stable ID** (an
explicit anchor comment).

### Slug IDs

- **Sections**: qualified slug path derived from heading text. Example: `installation/setup`,
  `release-notes/v2`.
- **Sub-elements** within a section: `installation/setup#table-1`, `installation/setup#code-2`.
  Numbered sequentially within their parent section.

Slugging: lowercase, non-alphanumeric runs become `-`, leading/trailing `-` stripped.

Collisions: each heading is slugged independently, then siblings are made unique by appending the
smallest `-N` (N≥2) not already taken. The suffixed form may itself collide and chain. Example:

    # setup       → setup
    # setup       → setup-2
    # setup 2     → setup-2-2

Slug IDs are not stable. Any edit that renames, adds, removes, or reorders headings can shift other
slugs. When a slug ID fails to resolve, re-discover via `list_regions`.

### Stable IDs

For regions whose ID must survive heading renames — anything a permission policy references,
anything a long-running task pins — use a stable ID anchor: an HTML comment of the form
`<!-- mdr:id=open-questions -->`. Placement:

- **Sections**: trailing on the heading line — `## Open Questions <!-- mdr:id=open-questions -->`
- **Tables and code blocks**: on the line immediately before the region. That anchor line is part of
  the region's canonical source — covered by its hash and preserved across edits, just like a
  section's heading.

Stable IDs are opt-in. A region without an anchor is addressed by slug; the zero-config case stays
simple. Use `stabilize_region` to stamp an anchor when durability matters.

Resolution: every operation accepts either a slug ID or a stable ID. If both could resolve, the
stable ID wins.

The library treats the anchor comment as metadata: it is preserved across edits, excluded from
`content` returned by `read_region`, but included in the canonical source covered by the region's
hash.

Stable IDs must match `[a-z0-9][a-z0-9-]*` and be unique within a document. The format excludes `/`
and `#` so a stable ID never collides with slug-path addressing.

### Root

The **root** region — the implicit section containing the entire document — is addressed by the
empty string `""` (or, where the ID parameter is optional, by omission). The root behaves like a
section with no heading: `read_region("")` returns `{title: null, content, hash}`;
`append_region("")` adds to the very end of the document; `insert_region` with `parent_id=""` (or
omitted) inserts at the top level. The root has no title and no stable ID, so `set_title` and
`stabilize_region` error on it.

## Text Encoding

- Line endings normalized to `\n` on ingest; written normalized.
- All character lengths (`char_length`, find/replace match spans) are counted in **codepoints**, not
  bytes.
- Hashing uses SHA-256 of the region's full canonical UTF-8 source (including heading for sections),
  truncated to 16 hex chars. Implementation detail — agents see only the hex string.

## Markdown Flavor

The library reads and writes **CommonMark + GFM tables** (via remark + `remark-gfm`). Other GFM
additions — task lists, strikethrough, autolinks — are passed through as inline content within
sections.

**YAML frontmatter** at the top of the file is detected and preserved verbatim. It is not exposed as
a region in v1 and is not editable via the region API. Modify it by editing the file directly
outside the library.

**Obsidian-flavored extras** — wikilinks (`[[Page]]`), embeds (`![[file]]`), callouts (`> [!info]`),
tags (`#tag`), highlights (`==text==`), math (`$...$`), comments (`%%...%%`), block IDs
(`^block-id`), footnotes (`[^1]`) — are not parsed structurally. They round-trip unchanged as plain
inline text within their containing section.

**Known sharp edges:**

- Footnote definitions can live anywhere in the document. An `edit_region` that removes a definition
  while a reference remains elsewhere will silently break the reference. The library does not check
  footnote integrity.
- Block-level anchors (`^block-id`) are inline text only — not addressable in v1 (see Out of Scope).

## Concurrency: Optimistic Hashing

Every read returns a `hash` of the region's content. Every write accepts an `expected_hash`.

- A section's hash **covers all descendants**. A writer holding a section hash detects any nested
  change.
- Same content → same hash (deterministic).
- **Edit at the narrowest scope that contains your change.** A held section hash invalidates on any
  descendant change — a typo fixed deep in a subsection conflicts with an unrelated edit planned at
  the parent. Reading and writing the smallest enclosing region keeps conflict noise low.

Write outcomes:

- **Ok** `{hash}` — new hash of the region after the write. If the agent needs post-edit structural
  information (e.g., IDs of regions created or removed by the edit), it should re-read via
  `list_regions` or `read_region`.
- **Conflict** `{conflict: true, current_content, current_hash, region_still_exists}` — region
  content changed since the read. Agent decides to retry, re-plan, or escalate. (For table
  operations, `current_content: string` is replaced by `current_table: {headers, rows}` — see
  [Table Operations](#table-operations).)
- If `region_still_exists=false`, the ID no longer resolves. Re-discover via `list_regions`.
- **FindError**
  `{error: "find_not_found" | "find_ambiguous", match_count?, current_content, current_hash}` — for
  find/replace edits, the find string didn't resolve uniquely. `match_count` is present on
  `find_ambiguous` (≥2), omitted on `find_not_found`. Distinct from `Conflict`: the doc didn't
  change; the find string is wrong. Agent should revise it and retry.

## Operations

### `list_regions(root?, depth?) → RegionNode`

Returns the `RegionNode` rooted at the requested region, with children populated to `depth`.

```
RegionNode {
  id: string             # slug-derived ID (always present)
  stable_id: string?     # explicit anchor ID, if the region has been stabilized
  type: "section" | "table" | "code"
  title: string?         # heading text, code language, null for tables
  hash: string
  char_length: number    # length of content (excludes heading for sections; matches read_region)
  child_count: number
  children: RegionNode[]
}
```

- `root`: a region ID to scope the response. Omit (or pass `""`) for the full doc.
- `depth`: max tree depth to return. Controls token cost on large docs.

### `read_region(id) → {title?, content, hash, stable_id?}`

Returns the region's content.

- **Sections**: `title` is the heading text; `content` is everything after the heading line. The
  heading is not editable via `edit_region` — use `set_title`.
- **Code blocks**: `title` is the language (null if unset); `content` is the fenced body.
- **Tables**: `title` is null; `content` is the full source.

`stable_id` is present iff the region has an anchor comment.

### `edit_region(id, find?, replacement, expected_hash) → Ok | Conflict | FindError`

Replace text within the region's `content` (as returned by `read_region`). Two forms:

- **Find/replace** (`find` provided): the substring `find` must occur exactly once in the region's
  current content; it is replaced by `replacement`. Returns `FindError` if `find` is absent
  (`find_not_found`) or matches more than once (`find_ambiguous`) — no edit is applied. The agent
  should revise the find string with more surrounding context and retry.
- **Whole-body** (`find` omitted): the entire body is replaced. Heading preserved for sections.

`Conflict` (hash mismatch) is checked before the find resolution, so a `FindError` always means the
doc didn't change since the read — only the find string is wrong.

The heading line is never editable here; use `set_title`. The replacement is raw markdown and may
cross what were previously sub-region boundaries — creating, removing, or restructuring nested
regions is the caller's responsibility. If the edit changes structure, re-read via `list_regions` to
see the new region layout.

### `append_region(id, content, expected_hash) → Ok | Conflict`

Append `content` to the end of the region.

- **Sections**: appended after all existing content, including descendants. Common cases:
  decision-log entries, new items in `Open Questions`.
- **Code blocks**: appended inside the fence.
- **Tables**: not applicable — use `insert_rows`.

### `prepend_region(id, content, expected_hash) → Ok | Conflict`

Insert `content` at the start of the region.

- **Sections**: inserted immediately after the heading line, before any existing content.
- **Code blocks**: inserted at the start of the fenced body.
- **Tables**: not applicable.

### `insert_region(parent_id?, after_child_id?, content, expected_hash, stable_id?) → {id, hash} | Conflict | Error`

Insert a new region as a child of `parent_id`.

- `parent_id`: omit (or pass `""`) for top-level insertion under the root.
- `after_child_id`: insert after this sibling and its descendants. Omit to insert as the first
  child.
- `expected_hash` is of the **parent** region.
- `stable_id` (optional): stamp an anchor on the new region as part of the insert; equivalent to a
  follow-up `stabilize_region`.

`content` must begin with a heading (`#…`), table row (`|…|`), or fenced code block (`` ``` … ``).
The leading element determines the region's type; **only one region per call**.

For section content, **heading levels are normalized**: the leading heading is shifted to
`parent_depth + 1`, and all interior headings shift by the same delta. So `# Title\n## Sub\n…` lands
at the right depth regardless of where it's inserted.

Errors:

- `parent_id` resolves to a table or code block (no children possible).
- `content` doesn't start with a heading, table, or code fence — use
  `append_region`/`prepend_region` for prose without a heading.
- `content` contains more than one top-level region — use `append_region` with multi-region markdown
  instead.
- `stable_id` is already in use elsewhere in the document.

### `set_title(id, title, expected_hash) → {id, hash} | Conflict | Error`

Set the region's title.

- **Sections**: updates the heading text. The slug changes, and descendant slug IDs change with it —
  callers holding descendant slugs must re-discover via `list_regions`. Stable IDs (the region's own
  or its descendants') are unaffected.
- **Code blocks**: updates the language. Pass `""` to clear the language.
- **Tables and root**: error — no title exists.

The returned `id` is the region's slug ID after the op, which may differ from the input `id` when a
section is renamed. Use it for subsequent calls.

### `stabilize_region(id, stable_id?, expected_hash) → {stable_id, hash} | Conflict | Error`

Stamp a stable-ID anchor on the region (see [Stable IDs](#stable-ids)).

- `stable_id` defaults to the leaf of the region's current slug ID (e.g., `open-questions` for
  `category/open-questions`).
- If the region already has a stable ID, it is rewritten to the new value (no-op if equal).
- Errors if `stable_id` is already in use by another region in the document, or if `id` resolves to
  the root (root has no stable ID).

### Table Operations

Tables have structure that character offsets are the wrong abstraction for. These operate on the
parsed grid.

Table writes re-serialize the table from the parsed grid; whitespace and column-padding may be
normalized even on logically-identical content. The hash reflects the post-serialization source.

Conflict responses for table operations carry `current_table: {headers, rows}` instead of
`current_content: string`, matching the shape of `read_table`.

**Out-of-range indices error and the operation is rejected as a whole** — no partial application.
Any `row`, `col`, `after_row`, `after_col`, or index in `row_indices` / `col_indices` that falls
outside its valid range causes an `Error` response with no changes written.

#### `read_table(id) → {headers, rows, hash}`

Returns the table as a parsed grid.

```
{
  headers: string[]
  rows: string[][]
  hash: string
}
```

#### `update_cells(id, edits, expected_hash) → Ok | Conflict`

Batch cell updates.

```
edits: [{row: number, col: number, value: string}, ...]
```

Row/col are 0-indexed. Row 0 is the first data row.

#### `update_headers(id, edits, expected_hash) → Ok | Conflict`

Update header cells. Separate from `update_cells` — headers are semantically distinct.

```
edits: [{col: number, value: string}, ...]
```

#### `insert_rows(id, after_row, rows, expected_hash) → Ok | Conflict | Error`

Insert one or more rows after `after_row`. Valid range: `-1` through current `rows.length`,
inclusive. `after_row=-1` inserts at the top; `after_row=rows.length` appends.

```
rows: [["cell", "cell", ...], ...]
```

#### `delete_rows(id, row_indices, expected_hash) → Ok | Conflict`

Delete rows by index.

#### `insert_columns(id, after_col, headers, cells?, expected_hash) → Ok | Conflict | Error`

Insert one or more columns after `after_col`. Valid range: `-1` through current column count,
inclusive. `after_col=-1` inserts at the left; `after_col=column_count` appends on the right.

```
headers: ["Header A", "Header B"]
cells: [["r0a", "r0b"], ["r1a", "r1b"], ...]  # one inner array per existing row; omit to fill empty
```

#### `delete_columns(id, col_indices, expected_hash) → Ok | Conflict`

Delete columns by index.

## Out of Scope (v0)

- Move/reorder regions
- Delete regions (use `edit_region` on parent with the child's text as `find` and `replacement=""`)
- Multi-document operations
- CRDT / true simultaneous multi-agent editing
- Block-level anchors for paragraphs and list items (Obsidian-style `^block-id`) — revisit if
  find/replace targeting proves insufficient in practice

## Roadmap

Features designed but not yet implemented. They follow the same conventions as the v0 API.

### Task Items

A sub-API for directly addressing GFM task-list items (`- [ ]`, `- [x]`) within a section, without
going through `edit_region` + find/replace. Mirrors Table Operations: tasks live inside a section,
are addressed by path, and concurrency piggybacks on the containing section's hash.

#### Addressing

A task is identified by `(section_id, path)`.

`path` is a 0-indexed array: `[0]` = first top-level task in the section; `[0, 1]` = second child of
the first. Path enumeration is flat across physical task lists within a section — two task lists
separated by a paragraph share a continuous sequence. Non-task list items (plain bullets, numbered
items without checkboxes) are skipped.

`read_tasks(section_id)` returns the section's own tasks, not tasks in nested subsections. For a
deeper sweep, walk `list_regions` and call `read_tasks` on each subsection.

#### Operations

```
read_tasks(section_id) → {tasks: TaskNode[], hash}

TaskNode {
  path: number[]
  state: "checked" | "unchecked"
  text: string                 # label after the checkbox
  children: TaskNode[]
}

set_task_state(section_id, path, checked, expected_hash) → Ok | Conflict | Error
set_task_text(section_id, path, text, expected_hash) → Ok | Conflict | Error
insert_task(section_id, parent_path?, after_path?, text, checked?, expected_hash) → {path, hash} | Conflict | Error
delete_task(section_id, path, expected_hash) → Ok | Conflict | Error
```

Semantics mirror Table Operations: out-of-range paths error with no partial application; writes
re-serialize the affected list (whitespace may normalize); `expected_hash` is the containing
section's.

#### Open questions

- **Text-based locator.** Allow `set_task_state(section_id, {find: "…"}, ...)` as an alternative to
  `path`, matching `edit_region`'s find/replace ergonomics. Strong candidate for inclusion when this
  feature ships.
- **Batch state updates** for "mark these N done in one call."
- **Extended states.** Obsidian `[/]`, `[!]`, `[-]`, custom chars — expose via `state: string`, or
  keep GFM-only.
- **Block-level anchors.** `^block-id` on a task would give persistent addressing for long-running
  pins — see the block-anchor item in Out of Scope.
- **Mixed list types.** Behavior when a numbered or plain bulleted list contains task items (GFM
  permits `1. [ ] Foo`).

## Implementation Notes

- Parse with **remark/unified** plus `remark-gfm` (tables) and `remark-frontmatter`. Use node
  `position` data for source-offset mapping.
- Edits operate on the original source text via offset mapping, not AST-rewrite-and-serialize.
  Untouched regions are byte-identical after write.
- Section boundaries: a section spans from its heading to (exclusive) the next heading of equal or
  lesser depth, or end of document.
