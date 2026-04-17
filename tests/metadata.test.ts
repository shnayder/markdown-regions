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

Deno.test("stabilize_region — default stable_id is the region's slug leaf", () => {
  const doc = Document.from_string(`# Parent\n\n## Child\n\nbody\n`);
  const { hash } = doc.read_region("parent/child");
  const r = doc.stabilize_region({ id: "parent/child", expected_hash: hash });
  assertEquals("stable_id" in r, true);
  if ("stable_id" in r) assertEquals(r.stable_id, "child");
  // Anchor stamped on the heading.
  assertEquals(doc.to_string().includes("## Child <!-- mdr:id=child -->"), true);
  // Resolves by stable ID now.
  const after = doc.read_region("child");
  assertEquals(after.stable_id, "child");
});

Deno.test("stabilize_region — explicit stable_id overrides the default", () => {
  const doc = Document.from_string("# A\n");
  const { hash } = doc.read_region("a");
  doc.stabilize_region({ id: "a", stable_id: "custom-id", expected_hash: hash });
  assertEquals(doc.to_string().includes("<!-- mdr:id=custom-id -->"), true);
  assertEquals(doc.read_region("custom-id").stable_id, "custom-id");
});

Deno.test("stabilize_region — stamps anchor above a code block", () => {
  const doc = Document.from_string("```ts\nx\n```\n");
  const { hash } = doc.read_region("#code-1");
  doc.stabilize_region({ id: "#code-1", stable_id: "snip", expected_hash: hash });
  assertEquals(doc.to_string(), "<!-- mdr:id=snip -->\n```ts\nx\n```\n");
});

Deno.test("stabilize_region — stamps anchor above a table", () => {
  const doc = Document.from_string("| A | B |\n|---|---|\n| 1 | 2 |\n");
  const { hash } = doc.read_region("#table-1");
  doc.stabilize_region({ id: "#table-1", stable_id: "grid", expected_hash: hash });
  assertEquals(
    doc.to_string(),
    "<!-- mdr:id=grid -->\n| A | B |\n|---|---|\n| 1 | 2 |\n",
  );
});

Deno.test("stabilize_region — rewriting an existing stable_id", () => {
  const src = `## A <!-- mdr:id=old -->\n\nbody\n`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("old");
  doc.stabilize_region({ id: "old", stable_id: "new", expected_hash: hash });
  assertEquals(
    doc.to_string().startsWith("## A <!-- mdr:id=new -->"),
    true,
  );
});

Deno.test("stabilize_region — no-op when requested equals current", () => {
  const src = `## A <!-- mdr:id=pinned -->\n\nbody\n`;
  const doc = Document.from_string(src);
  const before = doc.to_string();
  const { hash } = doc.read_region("pinned");
  const r = doc.stabilize_region({
    id: "pinned",
    stable_id: "pinned",
    expected_hash: hash,
  });
  assertEquals("stable_id" in r, true);
  assertEquals(doc.to_string(), before);
});

Deno.test("stabilize_region — Error: stable_id already in use elsewhere", () => {
  const src = `## A <!-- mdr:id=taken -->\n\n## B\n`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("b");
  const r = doc.stabilize_region({
    id: "b",
    stable_id: "taken",
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("stabilize_region — Error: root has no stable_id", () => {
  const doc = Document.from_string("# A\n");
  const { hash } = doc.read_region("");
  const r = doc.stabilize_region({ id: "", expected_hash: hash });
  assertEquals("error" in r, true);
});

Deno.test("stabilize_region — Conflict on stale hash", () => {
  const doc = Document.from_string("# A\n");
  const r = doc.stabilize_region({ id: "a", expected_hash: "0".repeat(16) });
  assertEquals("conflict" in r, true);
});
