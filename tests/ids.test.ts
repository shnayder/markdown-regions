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
