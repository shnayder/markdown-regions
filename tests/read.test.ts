import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("read_region — section returns title + post-heading content + hash", () => {
  const src = `# Intro

Hello, world.

More text.
`;
  const doc = Document.from_string(src);
  const r = doc.read_region("intro");
  assertEquals(r.title, "Intro");
  assertEquals(r.content, "\nHello, world.\n\nMore text.\n");
  assertEquals(r.hash, doc.list_regions().children[0].hash);
  assertEquals(r.stable_id, undefined);
});

Deno.test("read_region — root returns title=null and the full doc as content", () => {
  const src = `# A\n\nbody\n`;
  const doc = Document.from_string(src);
  const r = doc.read_region("");
  assertEquals(r.title, null);
  assertEquals(r.content, src);
  assertEquals(r.hash, doc.list_regions().hash);
});

Deno.test("read_region — code block returns language as title + inner body + hash", () => {
  const src = "```typescript\nconst x = 1;\nconst y = 2;\n```\n";
  const doc = Document.from_string(src);
  const r = doc.read_region("#code-1");
  assertEquals(r.title, "typescript");
  assertEquals(r.content, "const x = 1;\nconst y = 2;");
});

Deno.test("read_region — code block with no language has title=null", () => {
  const src = "```\nplain\n```\n";
  const doc = Document.from_string(src);
  const r = doc.read_region("#code-1");
  assertEquals(r.title, null);
  assertEquals(r.content, "plain");
});

Deno.test("read_region — table returns null title + full source + hash", () => {
  const src = `| A | B |
|---|---|
| 1 | 2 |
`;
  const doc = Document.from_string(src);
  const r = doc.read_region("#table-1");
  assertEquals(r.title, null);
  // Full source of the table block (no preceding anchor here).
  assertEquals(
    r.content,
    `| A | B |
|---|---|
| 1 | 2 |`,
  );
});

Deno.test("read_region — resolves by stable ID and surfaces stable_id field", () => {
  const src = `## Open Questions <!-- mdr:id=open-questions -->

A body.
`;
  const doc = Document.from_string(src);
  const r = doc.read_region("open-questions");
  assertEquals(r.title, "Open Questions");
  assertEquals(r.stable_id, "open-questions");
});

Deno.test("read_region — nested section content excludes its own heading but includes descendant headings", () => {
  const src = `# A

Intro para.

## A1

Sub body.
`;
  const doc = Document.from_string(src);
  const r = doc.read_region("a");
  // A's content starts after the "# A" line and includes the "## A1" heading and its body.
  assertEquals(
    r.content,
    `\nIntro para.\n\n## A1\n\nSub body.\n`,
  );
});

Deno.test("read_region — unknown id throws", () => {
  const doc = Document.from_string("# A\n");
  let threw = false;
  try {
    doc.read_region("nope");
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("read_table — returns parsed grid + hash", () => {
  const src = `| Name | Status |
|------|--------|
| Alice | done |
| Bob   | todo |
`;
  const doc = Document.from_string(src);
  const t = doc.read_table("#table-1");
  assertEquals(t.headers, ["Name", "Status"]);
  assertEquals(t.rows, [
    ["Alice", "done"],
    ["Bob", "todo"],
  ]);
  assertEquals(t.hash, doc.list_regions().children[0].hash);
});

Deno.test("read_table — errors when id is not a table", () => {
  const doc = Document.from_string("# Section\n\nBody.\n");
  let threw = false;
  try {
    doc.read_table("section");
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});
