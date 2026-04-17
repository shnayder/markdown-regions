import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("insert_region — insert a section at top level as first child", () => {
  const doc = Document.from_string(`# Existing\n\nbody\n`);
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "# Intro\n\nhello\n",
    expected_hash: root_hash,
  });
  assertEquals("id" in r, true);
  if ("id" in r) assertEquals(r.id, "intro");
  // New section inserted before existing.
  assertEquals(
    doc.to_string().startsWith("# Intro\n\nhello\n"),
    true,
  );
});

Deno.test("insert_region — after_child_id places the new region after that sibling", () => {
  const src = `# A\n\na body\n\n# B\n\nb body\n`;
  const doc = Document.from_string(src);
  const root_hash = doc.read_region("").hash;
  doc.insert_region({
    content: "# Middle\n\nmid\n",
    after_child_id: "a",
    expected_hash: root_hash,
  });
  // Order should be: A, Middle, B
  const ids = doc.list_regions().children.map((c) => c.id);
  assertEquals(ids, ["a", "middle", "b"]);
});

Deno.test("insert_region — heading levels normalize relative to parent depth", () => {
  // Parent 'a' is at depth 1; inserting a section whose leading heading is '#'
  // should land at depth 2 ('##').
  const doc = Document.from_string(`# A\n\na body\n`);
  const a_hash = doc.read_region("a").hash;
  doc.insert_region({
    parent_id: "a",
    content: "# Sub\n\nsub body\n",
    expected_hash: a_hash,
  });
  // After insert, 'a/sub' must resolve and 'sub' must be h2 in output.
  assertEquals(doc.to_string().includes("## Sub"), true);
  const children = doc.list_regions({ root: "a" }).children.map((c) => c.id);
  assertEquals(children, ["a/sub"]);
});

Deno.test("insert_region — interior heading levels shift by the same delta", () => {
  const doc = Document.from_string(`# A\n\nbody\n`);
  const a_hash = doc.read_region("a").hash;
  doc.insert_region({
    parent_id: "a",
    content: "# Top\n\nx\n\n## Sub\n\ny\n",
    expected_hash: a_hash,
  });
  // Top should be ## (parent depth 1 + 1 = 2); Sub should be ### (delta 1 applied).
  const out = doc.to_string();
  assertEquals(out.includes("## Top"), true);
  assertEquals(out.includes("### Sub"), true);
});

Deno.test("insert_region — inserts a code block at top level", () => {
  const doc = Document.from_string("");
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "```ts\nconst x = 1;\n```\n",
    expected_hash: root_hash,
  });
  assertEquals("id" in r, true);
  if ("id" in r) assertEquals(r.id, "#code-1");
  assertEquals(doc.to_string().includes("```ts"), true);
});

Deno.test("insert_region — inserts a table at top level", () => {
  const doc = Document.from_string("");
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "| A | B |\n|---|---|\n| 1 | 2 |\n",
    expected_hash: root_hash,
  });
  assertEquals("id" in r, true);
  if ("id" in r) assertEquals(r.id, "#table-1");
});

Deno.test("insert_region — stamps stable_id anchor when provided", () => {
  const doc = Document.from_string("");
  const root_hash = doc.read_region("").hash;
  doc.insert_region({
    content: "# Open Questions\n\nnone yet\n",
    expected_hash: root_hash,
    stable_id: "open-questions",
  });
  assertEquals(doc.to_string().includes("<!-- mdr:id=open-questions -->"), true);
  // Section resolves by stable ID.
  const r = doc.read_region("open-questions");
  assertEquals(r.stable_id, "open-questions");
  assertEquals(r.title, "Open Questions");
});

Deno.test("insert_region — Error: content doesn't start with heading/table/code", () => {
  const doc = Document.from_string("");
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "Just a paragraph.\n",
    expected_hash: root_hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("insert_region — Error: content has more than one top-level region", () => {
  const doc = Document.from_string("");
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "# A\n\nbody\n\n# B\n\nmore\n",
    expected_hash: root_hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("insert_region — Error: parent_id is a code block (no children possible)", () => {
  const doc = Document.from_string("```\ncode\n```\n");
  const r = doc.insert_region({
    parent_id: "#code-1",
    content: "# X\n",
    expected_hash: doc.read_region("#code-1").hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("insert_region — Error: stable_id already in use", () => {
  const doc = Document.from_string(
    "# A <!-- mdr:id=taken -->\n\nbody\n",
  );
  const root_hash = doc.read_region("").hash;
  const r = doc.insert_region({
    content: "# New\n\nx\n",
    expected_hash: root_hash,
    stable_id: "taken",
  });
  assertEquals("error" in r, true);
});

Deno.test("insert_region — Conflict on stale parent hash", () => {
  const doc = Document.from_string("# A\n");
  const r = doc.insert_region({
    content: "# B\n",
    expected_hash: "0".repeat(16),
  });
  assertEquals("conflict" in r, true);
});
