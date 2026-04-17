# markdown-regions — Usage Guide

How to use the library in the common agent–human collaboration patterns. See [spec.md](spec.md) for
the complete API.

## Conventions

Operations use `snake_case` throughout — matching the spec and the agent tool-use schema. Parameters
are passed as an options object:

```typescript
doc.edit_region({ id, find, replacement, expected_hash });
```

Writes return one of three shapes:

- **Ok** — carries the new `hash` (and sometimes `id`).
- **Conflict** — carries `{ conflict: true, current_content, current_hash, region_still_exists }`.
  Re-read and retry, or re-plan.
- **Error** / **FindError** — carries `{ error: "…", … }` for targeting failures (wrong region type,
  find string not unique, duplicate stable ID, etc.). The doc didn't change; the call was wrong.

Discriminate by property:

```typescript
if ("error" in result) { /* bad call */ }
else if ("conflict" in result) { /* doc drifted */ }
else { /* ok — result.hash is the new hash */ }
```

## Opening a document

```typescript
import { open_document } from "jsr:@you/markdown-regions";

const doc = await open_document("./project.md");
```

The returned `doc` is a handle with all operations as methods. Changes are written back to the file
on each call.

## Recipes

### 1. Propose a new section

The agent adds an "Open Questions" section at the end of the document and stabilizes it so future
references survive heading renames.

```typescript
const tree = await doc.list_regions();
const last_top = tree.children.at(-1)?.id;

const { id, hash } = await doc.insert_region({
  content: "# Open Questions\n\nNone yet.",
  after_child_id: last_top,
  expected_hash: tree.hash,
  stable_id: "open-questions",
});
```

The heading `# Open Questions` is normalized to the right depth automatically (`##` under the root).
`stable_id: "open-questions"` pins the section — even if a human later renames the heading,
`"open-questions"` still resolves.

### 2. Answer an inline question

The human left a question inline; the agent answers it without disturbing surrounding prose.

```typescript
const { content, hash } = await doc.read_region("open-questions");
// content includes:
//   > Should we use JWTs or session cookies?

const result = await doc.edit_region({
  id: "open-questions",
  find: "> Should we use JWTs or session cookies?",
  replacement: [
    "> Should we use JWTs or session cookies?",
    "",
    "**Decided (2026-04-16):** session cookies — JWTs don't compose with our mobile flow.",
  ].join("\n"),
  expected_hash: hash,
});
```

Because `find` is a verbatim slice of the content we just read, no offset math is needed. If the
human edited the question between read and write, the hash check fires first (`Conflict`) — re-read
and retry. If the question was rephrased, the find fails (`FindError`) — re-read, pick a different
target, or escalate.

### 3. Append to a decision log

End-of-session: the agent drops a new entry at the end of the Decisions section.

```typescript
const tree = await doc.list_regions({ root: "decisions" });

await doc.append_region({
  id: "decisions",
  content: [
    "",
    "## 2026-04-16 — Auth strategy",
    "",
    "Chose session cookies. See [open-questions](#open-questions).",
  ].join("\n"),
  expected_hash: tree.hash,
});
```

`append_region` is the dedicated path for "add to the end." No find/replace, no offset math. The
leading blank line gives the new subsection visual breathing room.

### 4. Update a status table

Mark a row as done, then append a new row.

```typescript
const table = await doc.read_table("status#table-1");
const row_idx = table.rows.findIndex((r) => r[0] === "Review spec");

await doc.update_cells({
  id: "status#table-1",
  edits: [{ row: row_idx, col: 2, value: "done" }],
  expected_hash: table.hash,
});

// Re-read: the previous write changed the hash.
const refreshed = await doc.read_table("status#table-1");

await doc.insert_rows({
  id: "status#table-1",
  after_row: refreshed.rows.length, // append
  rows: [["Wire up auth", "Claude", "todo"]],
  expected_hash: refreshed.hash,
});
```

Each write revalidates against the freshest hash, so we re-read between ops. Tables re-serialize on
write — don't rely on column-width or alignment stability across edits.

### 5. Scoped access

An agent is allowed to edit `Updates` and `Open Questions` but must ask before touching the formal
`Spec`.

Before handing out scoped permissions, stabilize the sections so the policy pins durable IDs:

```typescript
await doc.stabilize_region({ id: "updates" });
await doc.stabilize_region({ id: "open-questions" });
await doc.stabilize_region({ id: "spec" });
```

The policy lives outside this library — a simple allowlist keyed by stable ID:

```typescript
const policy = {
  write: ["updates", "open-questions"],
  require_approval: ["spec"],
};
```

Even if the human renames "Open Questions" → "Outstanding Questions," the stable ID `open-questions`
resolves correctly and the policy still applies.

### 6. Conflict handling pattern

A small wrapper for find/replace edits that retries on drift:

```typescript
async function edit_with_retry(
  id: string,
  find: string,
  replacement: string,
): Promise<{ hash: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { content, hash } = await doc.read_region(id);
    if (!content.includes(find)) {
      throw new Error(`Target text no longer present in ${id}`);
    }
    const result = await doc.edit_region({ id, find, replacement, expected_hash: hash });
    if ("error" in result) throw new Error(`Find failed: ${result.error}`);
    if ("conflict" in result) continue; // drift — re-read and retry
    return result; // ok
  }
  throw new Error("Too many retries");
}
```

Two distinct errors:

- **Conflict** (hash mismatch): the doc changed. Re-read and retry.
- **FindError** (find didn't resolve uniquely): the doc may not have changed, but the target text
  isn't where the agent expected. Usually better to re-plan than to blindly retry.

In practice, for turn-based work with infrequent concurrent edits, retry loops are rarely exercised.
This is defensive.

## Tips

- **Pick the narrowest ID.** A hash on `open-questions#code-2` invalidates less often than one on
  `open-questions`, which invalidates less often than one on the root. Smaller scope = fewer
  spurious conflicts.
- **Stabilize early when policy applies.** Any region referenced by an access policy, a long-running
  plan, or cross-session memory deserves a stable ID the first time it's created.
- **Prefer structural ops over find/replace** for structured content: `append_region`,
  `insert_rows`, `update_cells` beat `edit_region` with find/replace. Reserve find/replace for
  prose.
- **One region per `insert_region`.** For multi-region templates, use `append_region` on the parent
  with a multi-region markdown body.
