import { assertEquals, assertNotEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("set_title — rename a section updates the heading and slug ID", () => {
  const src = `# Old Title

body
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("old-title");
  const r = doc.set_title({ id: "old-title", title: "New Title", expected_hash: hash });
  assertEquals("id" in r, true);
  if ("id" in r) assertEquals(r.id, "new-title");
  assertEquals(doc.to_string(), "# New Title\n\nbody\n");
});

Deno.test("set_title — renaming a section with a stable_id preserves the anchor", () => {
  const src = `## Old <!-- mdr:id=pinned -->

body
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("pinned");
  doc.set_title({ id: "pinned", title: "New", expected_hash: hash });
  assertEquals(
    doc.to_string().startsWith("## New <!-- mdr:id=pinned -->"),
    true,
  );
  // Stable ID still resolves.
  const after = doc.read_region("pinned");
  assertEquals(after.title, "New");
  assertEquals(after.stable_id, "pinned");
});

Deno.test("set_title — descendant slugs cascade with parent rename", () => {
  const src = `# Parent

## Child

body
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("parent");
  doc.set_title({ id: "parent", title: "Renamed", expected_hash: hash });
  // Old descendant slug no longer resolves
  let old_resolved = true;
  try {
    doc.read_region("parent/child");
  } catch (_e) {
    old_resolved = false;
  }
  assertEquals(old_resolved, false);
  // New descendant slug does resolve
  const child = doc.read_region("renamed/child");
  assertEquals(child.title, "Child");
});

Deno.test("set_title — changes a code block's language", () => {
  const doc = Document.from_string("```ts\nfoo\n```\n");
  const { hash } = doc.read_region("#code-1");
  const r = doc.set_title({ id: "#code-1", title: "python", expected_hash: hash });
  assertEquals("id" in r, true);
  assertEquals(doc.to_string(), "```python\nfoo\n```\n");
  assertEquals(doc.read_region("#code-1").title, "python");
});

Deno.test("set_title — empty string clears a code block's language", () => {
  const doc = Document.from_string("```ts\nfoo\n```\n");
  const { hash } = doc.read_region("#code-1");
  doc.set_title({ id: "#code-1", title: "", expected_hash: hash });
  assertEquals(doc.to_string(), "```\nfoo\n```\n");
  assertEquals(doc.read_region("#code-1").title, null);
});

Deno.test("set_title — error on a table", () => {
  const doc = Document.from_string(`| A | B |\n|---|---|\n| 1 | 2 |\n`);
  const { hash } = doc.read_region("#table-1");
  const r = doc.set_title({
    id: "#table-1",
    title: "whatever",
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("set_title — error on root", () => {
  const doc = Document.from_string("# A\n");
  const { hash } = doc.read_region("");
  const r = doc.set_title({ id: "", title: "x", expected_hash: hash });
  assertEquals("error" in r, true);
});

Deno.test("set_title — Conflict on stale hash", () => {
  const doc = Document.from_string("# A\n");
  const r = doc.set_title({
    id: "a",
    title: "B",
    expected_hash: "0".repeat(16),
  });
  assertEquals("conflict" in r, true);
});

Deno.test("set_title — section hash changes after rename", () => {
  const doc = Document.from_string("# A\n\nbody\n");
  const before = doc.read_region("a").hash;
  doc.set_title({ id: "a", title: "B", expected_hash: before });
  const after = doc.read_region("b").hash;
  assertNotEquals(before, after);
});
