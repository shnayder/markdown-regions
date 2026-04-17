import { assertEquals, assertNotEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("hash — deterministic: same source yields same hashes", () => {
  const src = `# A\n\nBody.\n\n## Sub\n\nMore.\n`;
  const a = Document.from_string(src).list_regions();
  const b = Document.from_string(src).list_regions();
  assertEquals(a.hash, b.hash);
  assertEquals(a.children[0].hash, b.children[0].hash);
  assertEquals(a.children[0].children[0].hash, b.children[0].children[0].hash);
});

Deno.test("hash — 16 hex characters", () => {
  const tree = Document.from_string("# A\n\nx\n").list_regions();
  const hex = /^[0-9a-f]{16}$/;
  assertEquals(hex.test(tree.hash), true);
  assertEquals(hex.test(tree.children[0].hash), true);
});

Deno.test("hash — different content yields different hashes", () => {
  const a = Document.from_string("# A\n\nfoo\n").list_regions();
  const b = Document.from_string("# A\n\nbar\n").list_regions();
  assertNotEquals(a.hash, b.hash);
  assertNotEquals(a.children[0].hash, b.children[0].hash);
});

Deno.test("hash — section hash covers all descendants", () => {
  const v1 = Document.from_string(
    `# A\n\n## Sub\n\noriginal text\n`,
  ).list_regions();
  const v2 = Document.from_string(
    `# A\n\n## Sub\n\nchanged text\n`,
  ).list_regions();
  // A's subsection changed → A's hash must change too.
  assertNotEquals(v1.children[0].hash, v2.children[0].hash);
  // And the sub's own hash.
  assertNotEquals(
    v1.children[0].children[0].hash,
    v2.children[0].children[0].hash,
  );
});

Deno.test("hash — sibling section change does NOT affect an unrelated sibling", () => {
  const v1 = Document.from_string(
    `# A\n\noriginal A body\n\n# B\n\nB body\n`,
  ).list_regions();
  const v2 = Document.from_string(
    `# A\n\nCHANGED A body\n\n# B\n\nB body\n`,
  ).list_regions();
  // A changed
  assertNotEquals(v1.children[0].hash, v2.children[0].hash);
  // B unchanged
  assertEquals(v1.children[1].hash, v2.children[1].hash);
});

Deno.test("hash — table and code regions hash their own source", () => {
  const src_a = "```ts\nfoo\n```\n";
  const src_b = "```ts\nbar\n```\n";
  const a = Document.from_string(src_a).list_regions();
  const b = Document.from_string(src_b).list_regions();
  assertNotEquals(a.children[0].hash, b.children[0].hash);
});

Deno.test("hash — anchor comment line is part of table/code canonical source", () => {
  const with_anchor = `<!-- mdr:id=foo -->\n\`\`\`\nx\n\`\`\`\n`;
  const without_anchor = "```\nx\n```\n";
  const a = Document.from_string(with_anchor).list_regions();
  const b = Document.from_string(without_anchor).list_regions();
  // Different canonical source → different hash (the anchor is covered).
  assertNotEquals(a.children[0].hash, b.children[0].hash);
});

Deno.test("hash — root hash matches the full document hash invariant (changes on any edit)", () => {
  const v1 = Document.from_string(`# A\n\nbody\n`).list_regions();
  const v2 = Document.from_string(`# A\n\nbody changed\n`).list_regions();
  assertNotEquals(v1.hash, v2.hash);
});
