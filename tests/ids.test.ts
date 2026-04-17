import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("slug collision — two siblings with identical slug get `-2` suffix", () => {
  const src = `# Setup

# Setup
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.map((c) => c.id), ["setup", "setup-2"]);
});

Deno.test("slug collision — three siblings get `-2` and `-3`", () => {
  const src = `# Setup

# Setup

# Setup
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.map((c) => c.id), ["setup", "setup-2", "setup-3"]);
});

Deno.test("slug collision — chaining: natural `setup-2` collides with suffixed form, becomes `setup-2-2`", () => {
  const src = `# setup

# setup

# setup 2
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children.map((c) => c.id), [
    "setup",
    "setup-2",
    "setup-2-2",
  ]);
});

Deno.test("slug collision — collisions are scoped to siblings; same slug at different nesting is fine", () => {
  const src = `# A

## Setup

# B

## Setup
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].children.map((c) => c.id), ["a/setup"]);
  assertEquals(tree.children[1].children.map((c) => c.id), ["b/setup"]);
});

Deno.test("slug collision — sections and same-named sub-elements don't interfere (different separators)", () => {
  const src = `# Table 1

| A | B |
|---|---|
| 1 | 2 |
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  // Section "Table 1" slugs to "table-1"; the pipe table inside it is "table-1#table-1".
  const section = tree.children[0];
  assertEquals(section.id, "table-1");
  assertEquals(section.children[0].id, "table-1#table-1");
});

Deno.test("slug — leading digits, punctuation, and multiple whitespace normalize", () => {
  const src = `# 2026 Review

## Hello,   World!!

### C++ Notes
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].id, "2026-review");
  assertEquals(tree.children[0].children[0].id, "2026-review/hello-world");
  assertEquals(
    tree.children[0].children[0].children[0].id,
    "2026-review/hello-world/c-notes",
  );
});

Deno.test("stable_id — trailing anchor on section heading is extracted", () => {
  const src = `## Open Questions <!-- mdr:id=open-questions -->

Some content.
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const section = tree.children[0];
  assertEquals(section.stable_id, "open-questions");
  // Slug ID still derives from the heading text (with the anchor stripped).
  assertEquals(section.id, "open-questions");
  // Heading title excludes the anchor comment.
  assertEquals(section.title, "Open Questions");
});

Deno.test("stable_id — anchor before a code block is extracted", () => {
  const src = `<!-- mdr:id=snippet -->
\`\`\`ts
const x = 1;
\`\`\`
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const code = tree.children[0];
  assertEquals(code.type, "code");
  assertEquals(code.stable_id, "snippet");
});

Deno.test("stable_id — anchor before a table is extracted", () => {
  const src = `<!-- mdr:id=status -->
| Item | Done |
|------|------|
| A    | yes  |
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  const table = tree.children[0];
  assertEquals(table.type, "table");
  assertEquals(table.stable_id, "status");
});

Deno.test("stable_id — unrelated HTML comments are not anchors", () => {
  const src = `<!-- just a note -->
\`\`\`
x
\`\`\`
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].stable_id, undefined);
});

Deno.test("stable_id — malformed id (uppercase or slash) is ignored", () => {
  const src = `<!-- mdr:id=Foo/Bar -->
\`\`\`
x
\`\`\`
`;
  const doc = Document.from_string(src);
  const tree = doc.list_regions();
  assertEquals(tree.children[0].stable_id, undefined);
});

Deno.test("stable_id — duplicate stable IDs in a document throw on parse", () => {
  const src = `## A <!-- mdr:id=dup -->

## B <!-- mdr:id=dup -->
`;
  let threw = false;
  try {
    Document.from_string(src);
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("list_regions — root='' returns the full tree (same as no root)", () => {
  const src = `# A

## A1
`;
  const doc = Document.from_string(src);
  const a = doc.list_regions();
  const b = doc.list_regions({ root: "" });
  assertEquals(a, b);
});

Deno.test("list_regions — root by slug returns that subtree", () => {
  const src = `# A

## A1

## A2

# B
`;
  const doc = Document.from_string(src);
  const a = doc.list_regions({ root: "a" });
  assertEquals(a.id, "a");
  assertEquals(a.children.map((c) => c.id), ["a/a1", "a/a2"]);
});

Deno.test("list_regions — root by stable ID resolves to the same subtree", () => {
  const src = `# Intro <!-- mdr:id=intro -->

## Sub
`;
  const doc = Document.from_string(src);
  const by_slug = doc.list_regions({ root: "intro" });
  const by_stable = doc.list_regions({ root: "intro" }); // same here since slug==stable
  assertEquals(by_slug, by_stable);
  // Rename-proof: change the heading but keep the anchor, stable ID still resolves.
  const src2 = `# Renamed <!-- mdr:id=intro -->

## Sub
`;
  const doc2 = Document.from_string(src2);
  const node = doc2.list_regions({ root: "intro" });
  assertEquals(node.id, "renamed");
  assertEquals(node.stable_id, "intro");
  assertEquals(node.children.map((c) => c.id), ["renamed/sub"]);
});

Deno.test("list_regions — unknown root throws", () => {
  const doc = Document.from_string(`# A\n`);
  let threw = false;
  try {
    doc.list_regions({ root: "does-not-exist" });
  } catch (_e) {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("list_regions — depth limits how deep children are populated", () => {
  const src = `# A

## A1

### A1a

## A2
`;
  const doc = Document.from_string(src);
  const d0 = doc.list_regions({ depth: 0 });
  assertEquals(d0.children, []);
  const d1 = doc.list_regions({ depth: 1 });
  assertEquals(d1.children.map((c) => c.id), ["a"]);
  assertEquals(d1.children[0].children, []);
  const d2 = doc.list_regions({ depth: 2 });
  assertEquals(d2.children[0].children.map((c) => c.id), ["a/a1", "a/a2"]);
  assertEquals(d2.children[0].children[0].children, []);
});
