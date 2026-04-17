import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("conflicts — stale hash after a prior edit triggers Conflict", () => {
  const doc = Document.from_string("# A\n\noriginal\n");
  const stale = doc.read_region("a").hash;
  // First edit succeeds.
  doc.edit_region({
    id: "a",
    find: "original",
    replacement: "first",
    expected_hash: stale,
  });
  // Second edit with the same (now stale) hash conflicts.
  const r = doc.edit_region({
    id: "a",
    find: "first",
    replacement: "second",
    expected_hash: stale,
  });
  assertEquals("conflict" in r, true);
  if ("conflict" in r) {
    assertEquals(r.region_still_exists, true);
  }
});

Deno.test("conflicts — sibling hash still valid after editing unrelated sibling", () => {
  const doc = Document.from_string(`# A\n\na body\n\n# B\n\nb body\n`);
  const b_hash = doc.read_region("b").hash;
  const a_hash = doc.read_region("a").hash;
  // Edit A.
  doc.edit_region({
    id: "a",
    find: "a body",
    replacement: "A BODY",
    expected_hash: a_hash,
  });
  // B's stored hash should still work.
  const r = doc.edit_region({
    id: "b",
    find: "b body",
    replacement: "B BODY",
    expected_hash: b_hash,
  });
  assertEquals("hash" in r, true);
});

Deno.test("conflicts — root hash invalidates after any edit", () => {
  const doc = Document.from_string("# A\n\nbody\n");
  const root_hash_before = doc.read_region("").hash;
  const a_hash = doc.read_region("a").hash;
  doc.edit_region({
    id: "a",
    find: "body",
    replacement: "changed",
    expected_hash: a_hash,
  });
  const r = doc.append_region({
    id: "",
    content: "\n# B\n",
    expected_hash: root_hash_before,
  });
  assertEquals("conflict" in r, true);
});

Deno.test("conflicts — parent hash invalidates after any descendant edit", () => {
  const doc = Document.from_string("# A\n\n## Sub\n\nbody\n");
  const a_hash_before = doc.read_region("a").hash;
  const sub_hash = doc.read_region("a/sub").hash;
  // Edit the descendant.
  doc.edit_region({
    id: "a/sub",
    find: "body",
    replacement: "changed",
    expected_hash: sub_hash,
  });
  // Parent-scoped edit with the pre-edit hash conflicts.
  const r = doc.edit_region({
    id: "a",
    find: "changed",
    replacement: "again",
    expected_hash: a_hash_before,
  });
  assertEquals("conflict" in r, true);
});

Deno.test("conflicts — FindError does not apply changes; subsequent edit with same hash works", () => {
  const doc = Document.from_string("# A\n\nbody\n");
  const hash = doc.read_region("a").hash;
  const bad = doc.edit_region({
    id: "a",
    find: "not-there",
    replacement: "x",
    expected_hash: hash,
  });
  assertEquals("error" in bad, true);
  // Same hash still valid — no mutation happened.
  const good = doc.edit_region({
    id: "a",
    find: "body",
    replacement: "updated",
    expected_hash: hash,
  });
  assertEquals("hash" in good, true);
});

Deno.test("conflicts — table write Conflict carries parsed grid", () => {
  const src = `| A | B |\n|---|---|\n| 1 | 2 |\n`;
  const doc = Document.from_string(src);
  const r = doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 0, value: "x" }],
    expected_hash: "0".repeat(16),
  });
  assertEquals("conflict" in r, true);
  if ("conflict" in r) {
    assertEquals(r.current_table.headers, ["A", "B"]);
    assertEquals(r.current_table.rows, [["1", "2"]]);
  }
});
