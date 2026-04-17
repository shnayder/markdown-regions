import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

const WITH_FRONTMATTER = `---
title: My Doc
tags: [foo, bar]
---

# Intro

body
`;

Deno.test("frontmatter — not exposed as a region", () => {
  const doc = Document.from_string(WITH_FRONTMATTER);
  const tree = doc.list_regions();
  // Only the Intro section; no yaml region surfaces.
  assertEquals(tree.children.length, 1);
  assertEquals(tree.children[0].id, "intro");
});

Deno.test("frontmatter — preserved in root content and after edits", () => {
  const doc = Document.from_string(WITH_FRONTMATTER);
  const root = doc.read_region("");
  assertEquals(root.content.startsWith("---\ntitle: My Doc"), true);

  // Edit the body — frontmatter must still be there verbatim.
  const { hash } = doc.read_region("intro");
  doc.edit_region({
    id: "intro",
    find: "body",
    replacement: "new body",
    expected_hash: hash,
  });
  assertEquals(doc.to_string().startsWith("---\ntitle: My Doc"), true);
  assertEquals(doc.to_string().includes("new body"), true);
});

Deno.test("GFM — task list items pass through as inline content", () => {
  const src = `# Todos

- [ ] first
- [x] second
`;
  const doc = Document.from_string(src);
  // Task items aren't their own regions yet.
  const tree = doc.list_regions();
  assertEquals(tree.children[0].children.length, 0);
  // They round-trip through read/edit.
  const { content } = doc.read_region("todos");
  assertEquals(content.includes("- [ ] first"), true);
  assertEquals(content.includes("- [x] second"), true);
});

Deno.test("GFM — strikethrough and autolinks pass through", () => {
  const src = `# Notes

~~old~~ and https://example.com
`;
  const doc = Document.from_string(src);
  // Round-trips unchanged.
  assertEquals(doc.to_string(), src);
});

Deno.test("Obsidian — wikilinks, embeds, callouts, tags, highlights, math, comments, block IDs all round-trip", () => {
  const src = `# Mix

See [[Other Note]] and ![[pic.png]].

> [!info] Title
> callout body

Tags: #one #two

Highlight: ==important==

Math: $x^2$ and $$E=mc^2$$

%%obsidian comment%%

paragraph ^block-id

Footnote ref[^1]

[^1]: Footnote text
`;
  const doc = Document.from_string(src);
  // The structural parser treats all of this as inline text inside the "Mix"
  // section — it round-trips byte-for-byte through the document.
  assertEquals(doc.to_string(), src);
});

Deno.test("edits preserve Obsidian-flavored text around the edit point", () => {
  const src = `# A

See [[Other Note]].

Status: ==pending==
`;
  const doc = Document.from_string(src);
  const { hash } = doc.read_region("a");
  doc.edit_region({
    id: "a",
    find: "pending",
    replacement: "done",
    expected_hash: hash,
  });
  // Wiki link and highlight syntax preserved.
  assertEquals(doc.to_string().includes("[[Other Note]]"), true);
  assertEquals(doc.to_string().includes("==done=="), true);
});
