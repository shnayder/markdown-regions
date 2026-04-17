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

Deno.test("insert_rows — insert at top (after_row = -1)", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_rows({
    id: "#table-1",
    after_row: -1,
    rows: [["Zach", "done"]],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [
    ["Zach", "done"],
    ["Alice", "todo"],
    ["Bob", "todo"],
  ]);
});

Deno.test("insert_rows — append when after_row = rows.length", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_rows({
    id: "#table-1",
    after_row: 2,
    rows: [["Carol", "todo"]],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [
    ["Alice", "todo"],
    ["Bob", "todo"],
    ["Carol", "todo"],
  ]);
});

Deno.test("insert_rows — insert multiple rows at once", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_rows({
    id: "#table-1",
    after_row: 0,
    rows: [["Amelia", "todo"], ["Andrew", "done"]],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [
    ["Alice", "todo"],
    ["Amelia", "todo"],
    ["Andrew", "done"],
    ["Bob", "todo"],
  ]);
});

Deno.test("insert_rows — out-of-range after_row errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.insert_rows({
    id: "#table-1",
    after_row: 99,
    rows: [["x", "y"]],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("delete_rows — remove one row", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.delete_rows({
    id: "#table-1",
    row_indices: [0],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [["Bob", "todo"]]);
});

Deno.test("delete_rows — remove multiple rows (indices processed atomically)", () => {
  const src = `| N |
|---|
| 1 |
| 2 |
| 3 |
| 4 |
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_table("#table-1");
  doc.delete_rows({
    id: "#table-1",
    row_indices: [0, 2],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.rows, [["2"], ["4"]]);
});

Deno.test("delete_rows — out-of-range index errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.delete_rows({
    id: "#table-1",
    row_indices: [99],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("insert_columns — append column with per-row values", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_columns({
    id: "#table-1",
    after_col: 1,
    headers: ["Owner"],
    cells: [["Alice"], ["Bob"]],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["Name", "Status", "Owner"]);
  assertEquals(after.rows, [
    ["Alice", "todo", "Alice"],
    ["Bob", "todo", "Bob"],
  ]);
});

Deno.test("insert_columns — prepend at left (after_col = -1) with empty cells", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_columns({
    id: "#table-1",
    after_col: -1,
    headers: ["#"],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["#", "Name", "Status"]);
  assertEquals(after.rows, [
    ["", "Alice", "todo"],
    ["", "Bob", "todo"],
  ]);
});

Deno.test("insert_columns — multiple columns at once", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.insert_columns({
    id: "#table-1",
    after_col: 1,
    headers: ["A", "B"],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["Name", "Status", "A", "B"]);
  assertEquals(after.rows[0], ["Alice", "todo", "", ""]);
});

Deno.test("insert_columns — out-of-range after_col errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.insert_columns({
    id: "#table-1",
    after_col: 99,
    headers: ["X"],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});

Deno.test("delete_columns — remove a column", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  doc.delete_columns({
    id: "#table-1",
    col_indices: [1],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["Name"]);
  assertEquals(after.rows, [["Alice"], ["Bob"]]);
});

Deno.test("delete_columns — multiple columns atomically", () => {
  const src = `| a | b | c | d |
|---|---|---|---|
| 1 | 2 | 3 | 4 |
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_table("#table-1");
  doc.delete_columns({
    id: "#table-1",
    col_indices: [0, 2],
    expected_hash: hash,
  });
  const after = doc.read_table("#table-1");
  assertEquals(after.headers, ["b", "d"]);
  assertEquals(after.rows, [["2", "4"]]);
});

Deno.test("delete_columns — out-of-range errors", () => {
  const doc = Document.from_string(TABLE);
  const { hash } = doc.read_table("#table-1");
  const r = doc.delete_columns({
    id: "#table-1",
    col_indices: [99],
    expected_hash: hash,
  });
  assertEquals("error" in r, true);
});
