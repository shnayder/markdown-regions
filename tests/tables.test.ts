import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

const TABLE = `| Name | Status |
|------|--------|
| Alice | todo |
| Bob | todo |
`;

Deno.test("update_cells — single edit", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 1, value: "done" }],
    expected_hash: hash,
  });
  assertEquals("hash" in r, true);
  const after = doc.read_table("#table-1");
  assertEquals(after.rows[0][1], "done");
  assertEquals(after.rows[1][1], "todo");
});

Deno.test("update_cells — multiple edits in one call", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.update_cells({
    id: "#table-1",
    edits: [
      { row: 0, col: 0, value: "Alison" },
      { row: 1, col: 1, value: "done" },
    ],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [
    ["Alison", "todo"],
    ["Bob", "done"],
  ]);
});

Deno.test("update_cells — out-of-range row errors without applying edits", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 0, value: "good" }, { row: 99, col: 0, value: "bad" }],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
  // Verify no change applied.
  const after = doc.read_table("#table-1");
  assertEquals(after.rows[0][0], "Alice");
});

Deno.test("update_cells — out-of-range col errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 5, value: "x" }],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("update_headers — rename a header", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.update_headers({
    id: "#table-1",
    edits: [{ col: 1, value: "State" }],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["Name", "State"]);
});

Deno.test("update_headers — out-of-range col errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.update_headers({
    id: "#table-1",
    edits: [{ col: 10, value: "x" }],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("table write — Conflict on stale hash", () => {
  const doc = Document.from_string(TABLE);
  const r = doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 0, value: "x" }],
    expected_hash: "0".repeat(16),
  });
  assertEquals("conflict" in r, true);
  if ("conflict" in r) {
    // Conflict carries the parsed grid for table ops, not a string.
    const t = r.current_table;
    assertEquals(t.headers, ["Name", "Status"]);
  }
});

Deno.test("table write — re-serialization preserves logical content", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.update_cells({
    id: "#table-1",
    edits: [{ row: 0, col: 1, value: "done" }],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["Name", "Status"]);
  assertEquals(after.rows, [
    ["Alice", "done"],
    ["Bob", "todo"],
  ]);
});

Deno.test("table write — wrong region type errors", () => {
  const doc = Document.from_string("# Section\n");
  let threw = false;
  try {
    doc.update_cells({
      id: "section",
      edits: [{ row: 0, col: 0, value: "x" }],
      expected_hash: doc.read_region("section").hash,
    });
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
