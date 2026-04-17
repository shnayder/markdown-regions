import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("list_regions — empty document returns root with no children", () => {
  const doc = Document.from_string("");
  const tree = doc.list_regions();
  assertEquals(tree.id, "");
  assertEquals(tree.type, "section");
  assertEquals(tree.title, null);
  assertEquals(tree.children, []);
});

Deno.test("list_regions — single top-level section", () => {
  const doc = Document.from_string("# Intro\n\nHello.\n");
  const tree = doc.list_regions();
  assertEquals(tree.children.length, 1);
  const intro = tree.children[0];
  assertEquals(intro.id, "intro");
  assertEquals(intro.title, "Intro");
  assertEquals(intro.type, "section");
  assertEquals(intro.children, []);
});

Deno.test("list_regions — nested sections form hierarchy", () => {
  const src = `# A

## A1

### A1a

## A2

# B
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.map((c) => c.id), ["a", "b"]);
  assertEquals(tree.children[0].children.map((c) => c.id), ["a/a1", "a/a2"]);
  assertEquals(
    tree.children[0].children[0].children.map((c) => c.id),
    ["a/a1/a1a"],
  );
});

Deno.test("list_regions — skipped heading level (h1 -> h3) nests under h1", () => {
  const src = `# A

### A-a
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].id, "a");
  assertEquals(tree.children[0].children.map((c) => c.id), ["a/a-a"]);
});

Deno.test("list_regions — preamble paragraphs do not appear as regions", () => {
  const src = `Preamble paragraph.

# Intro

Body.

## Sub
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.length, 1);
  assertEquals(tree.children[0].id, "intro");
  assertEquals(tree.children[0].children.map((c) => c.id), ["intro/sub"]);
});

Deno.test("list_regions — multiple top-level siblings", () => {
  const src = `# First Section

Body.

# Second Section

More body.

# Third Section
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.map((c) => c.id), [
    "first-section",
    "second-section",
    "third-section",
  ]);
});

Deno.test("list_regions — heading text with punctuation slugs correctly", () => {
  const src = `# Hello, World!

## What's Next?
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].id, "hello-world");
  assertEquals(tree.children[0].children[0].id, "hello-world/what-s-next");
});

Deno.test("list_regions — fenced code block at top level", () => {
  const src = "```typescript\nconst x = 1;\n```\n";
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.length, 1);
  const code = tree.children[0];
  assertEquals(code.id, "#code-1");
  assertEquals(code.type, "code");
  assertEquals(code.title, "typescript");
  assertEquals(code.children, []);
});

Deno.test("list_regions — fenced code block with no language has null title", () => {
  const src = "```\nplain code\n```\n";
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].type, "code");
  assertEquals(tree.children[0].title, null);
});

Deno.test("list_regions — pipe table at top level", () => {
  const src = `| A | B |
|---|---|
| 1 | 2 |
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.length, 1);
  const table = tree.children[0];
  assertEquals(table.id, "#table-1");
  assertEquals(table.type, "table");
  assertEquals(table.title, null);
  assertEquals(table.children, []);
});

Deno.test("list_regions — code and table nested inside a section", () => {
  const src = `# Intro

\`\`\`ts
x
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const intro = tree.children[0];
  assertEquals(intro.children.map((c) => c.id), [
    "intro#code-1",
    "intro#table-1",
  ]);
  assertEquals(intro.children[0].type, "code");
  assertEquals(intro.children[0].title, "ts");
  assertEquals(intro.children[1].type, "table");
});

Deno.test("list_regions — sub-elements number within their parent section; counters reset per section", () => {
  const src = `# A

\`\`\`
a1
\`\`\`

\`\`\`
a2
\`\`\`

## Sub

\`\`\`
s1
\`\`\`
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const a = tree.children[0];
  assertEquals(a.children.map((c) => c.id), [
    "a#code-1",
    "a#code-2",
    "a/sub",
  ]);
  const sub = a.children[2];
  assertEquals(sub.children.map((c) => c.id), ["a/sub#code-1"]);
});

Deno.test("list_regions — table and code counters are independent within a section", () => {
  const src = `# Mix

| A | B |
|---|---|
| 1 | 2 |

\`\`\`
c1
\`\`\`

| X | Y |
|---|---|
| 9 | 8 |

\`\`\`
c2
\`\`\`
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const mix = tree.children[0];
  assertEquals(mix.children.map((c) => c.id), [
    "mix#table-1",
    "mix#code-1",
    "mix#table-2",
    "mix#code-2",
  ]);
});
