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
