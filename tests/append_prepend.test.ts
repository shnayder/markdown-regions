import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("append_region — section appends after existing content, preserves heading", () => {
  const src = `# Log

entry 1
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("log");
  const r = doc.append_region({
    id: "log",
    content: "entry 2\n",
    expected_hash: hash,
  });
  assertEquals("hash" in r, true);
  assertEquals(doc.to_string(), "# Log\n\nentry 1\nentry 2\n");
});

Deno.test("append_region — root appends at the very end of the document", () => {
  const doc = Document.from_string("# A\n\nbody\n");
  const { hash } = doc.read_region("");
  doc.append_region({ id: "", content: "\n# B\n", expected_hash: hash });
  assertEquals(doc.to_string(), "# A\n\nbody\n\n# B\n");
});

Deno.test("append_region — code block appends inside the fence", () => {
  const doc = Document.from_string("```ts\nfoo\n```\n");
  const { hash } = doc.read_region("#code-1");
  doc.append_region({
    id: "#code-1",
    content: "\nbar",
    expected_hash: hash,
  });
  assertEquals(doc.to_string(), "```ts\nfoo\nbar\n```\n");
});

Deno.test("append_region — table errors (use insert_rows instead)", () => {
  const src = `| A | B |
|---|---|
| 1 | 2 |
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("#table-1");
  let threw = false;
  try {
    doc.append_region({ id: "#table-1", content: "x", expected_hash: hash });
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("append_region — Conflict on stale hash", () => {
  const doc = Document.from_string("# A\n\nx\n");
  const r = doc.append_region({
    id: "a",
    content: "y\n",
    expected_hash: "0".repeat(16),
  });
  assertEquals("conflict" in r, true);
});

Deno.test("prepend_region — section inserts after heading, before body", () => {
  const src = `# Log

existing
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("log");
  doc.prepend_region({
    id: "log",
    content: "\nfirst\n",
    expected_hash: hash,
  });
  assertEquals(doc.to_string(), "# Log\n\nfirst\n\nexisting\n");
});

Deno.test("prepend_region — root prepends at the start of the document", () => {
  const doc = Document.from_string("# A\n");
  const { hash } = doc.read_region("");
  doc.prepend_region({
    id: "",
    content: "Preamble.\n\n",
    expected_hash: hash,
  });
  assertEquals(doc.to_string(), "Preamble.\n\n# A\n");
});

Deno.test("prepend_region — code block inserts at start of fenced body", () => {
  const doc = Document.from_string("```ts\nfoo\n```\n");
  const { hash } = doc.read_region("#code-1");
  doc.prepend_region({
    id: "#code-1",
    content: "bar\n",
    expected_hash: hash,
  });
  assertEquals(doc.to_string(), "```ts\nbar\nfoo\n```\n");
});

Deno.test("prepend_region — table errors", () => {
  const doc = Document.from_string(`| A | B |
|---|---|
| 1 | 2 |
`);
  const { hash } = doc.read_region("#table-1");
  let threw = false;
  try {
    doc.prepend_region({ id: "#table-1", content: "x", expected_hash: hash });
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
