import { assertEquals, assertNotEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("edit_region — whole-body replace on a section preserves heading", () => {
  const src = `# Intro

old body
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("intro");
  const result = doc.edit_region({
    id: "intro",
    replacement: "new body\n",
    expected_hash: hash,
  });
  assertEquals("hash" in result, true);
  assertEquals(doc.to_string(), "# Intro\nnew body\n");
  const after = doc.read_region("intro");
  assertEquals(after.content, "new body\n");
  assertNotEquals(after.hash, hash);
});

Deno.test("edit_region — find/replace swaps a specific substring", () => {
  const src = `# Notes

The answer is 42.

More text.
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("notes");
  const result = doc.edit_region({
    id: "notes",
    find: "42",
    replacement: "yes",
    expected_hash: hash,
  });
  assertEquals("hash" in result, true);
  assertEquals(
    doc.to_string(),
    `# Notes\n\nThe answer is yes.\n\nMore text.\n`,
  );
});

Deno.test("edit_region — FindError: find_not_found when substring absent", () => {
  const doc = Document.from_string(`# A\n\nhello\n`);
  const { hash } = doc.read_region("a");
  const result = doc.edit_region({
    id: "a",
    find: "missing",
    replacement: "x",
    expected_hash: hash,
  });
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertEquals(result.error, "find_not_found");
  }
});

Deno.test("edit_region — FindError: find_ambiguous with match_count", () => {
  const doc = Document.from_string(`# A\n\nfoo and foo again\n`);
  const { hash } = doc.read_region("a");
  const result = doc.edit_region({
    id: "a",
    find: "foo",
    replacement: "bar",
    expected_hash: hash,
  });
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertEquals(result.error, "find_ambiguous");
    assertEquals(result.match_count, 2);
  }
});

Deno.test("edit_region — Conflict when expected_hash is stale", () => {
  const doc = Document.from_string(`# A\n\nbody\n`);
  const stale_hash = "0000000000000000";
  const result = doc.edit_region({
    id: "a",
    replacement: "new\n",
    expected_hash: stale_hash,
  });
  assertEquals("conflict" in result, true);
  if ("conflict" in result) {
    assertEquals(result.region_still_exists, true);
    assertEquals(result.current_content, "\nbody\n");
  }
});

Deno.test("edit_region — Conflict check precedes FindError", () => {
  // With stale hash AND a find that wouldn't match, we should see Conflict (not FindError).
  const doc = Document.from_string(`# A\n\nbody\n`);
  const result = doc.edit_region({
    id: "a",
    find: "nonexistent",
    replacement: "x",
    expected_hash: "deadbeef00000000",
  });
  assertEquals("conflict" in result, true);
});

Deno.test("edit_region — whole-body replace on root rewrites entire source", () => {
  const doc = Document.from_string(`# A\n\nold\n`);
  const { hash } = doc.read_region("");
  const result = doc.edit_region({
    id: "",
    replacement: "# A\n\nnew\n",
    expected_hash: hash,
  });
  assertEquals("hash" in result, true);
  assertEquals(doc.to_string(), "# A\n\nnew\n");
});

Deno.test("edit_region — whole-body replace on a code block swaps fenced body", () => {
  const src = "```ts\nold\n```\n";
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("#code-1");
  const result = doc.edit_region({
    id: "#code-1",
    replacement: "new line 1\nnew line 2",
    expected_hash: hash,
  });
  assertEquals("hash" in result, true);
  assertEquals(doc.to_string(), "```ts\nnew line 1\nnew line 2\n```\n");
});

Deno.test("edit_region — find/replace inside a code block", () => {
  const src = "```ts\nconst x = 1;\nconst y = 2;\n```\n";
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("#code-1");
  const result = doc.edit_region({
    id: "#code-1",
    find: "const y = 2;",
    replacement: "const y = 99;",
    expected_hash: hash,
  });
  assertEquals("hash" in result, true);
  assertEquals(
    doc.to_string(),
    "```ts\nconst x = 1;\nconst y = 99;\n```\n",
  );
});

Deno.test("edit_region — untouched regions round-trip byte-identical", () => {
  const src = `# A

body A

# B

body B
`;
  const doc = Document.from_string(src);
  const b_before = doc.read_region("b");
  const { hash } = doc.read_region("a");
  doc.edit_region({
    id: "a",
    find: "body A",
    replacement: "BODY A",
    expected_hash: hash,
  });
  const b_after = doc.read_region("b");
  assertEquals(b_after.content, b_before.content);
  assertEquals(b_after.hash, b_before.hash);
});

Deno.test("edit_region — unknown id throws", () => {
  const doc = Document.from_string(`# A\n`);
  let threw = false;
  try {
    doc.edit_region({ id: "nope", replacement: "x", expected_hash: "0".repeat(16) });
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
