import { assertEquals } from "@std/assert";
import { open_document } from "../src/mod.ts";

async function with_temp_doc(
  initial: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "mdr-test-" });
  const path = `${dir}/doc.md`;
  await Deno.writeTextFile(path, initial);
  try {
    await fn(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("open_document — reads initial source from disk", async () => {
  await with_temp_doc("# A\n\nhello\n", async (path) => {
    const doc = await open_document(path);
    const r = doc.read_region("a");
    assertEquals(r.title, "A");
    assertEquals(r.content, "\nhello\n");
  });
});

Deno.test("open_document — edit_region persists to disk", async () => {
  await with_temp_doc("# A\n\nhello\n", async (path) => {
    const doc = await open_document(path);
    const { hash } = doc.read_region("a");
    await doc.edit_region({
      id: "a",
      find: "hello",
      replacement: "goodbye",
      expected_hash: hash,
    });
    const on_disk = await Deno.readTextFile(path);
    assertEquals(on_disk, "# A\n\ngoodbye\n");
  });
});

Deno.test("open_document — multiple writes chain through disk", async () => {
  await with_temp_doc("# A\n\nbody\n", async (path) => {
    const doc = await open_document(path);
    // Append a B section.
    const root_hash = doc.read_region("").hash;
    await doc.append_region({
      id: "",
      content: "\n# B\n",
      expected_hash: root_hash,
    });
    // Then rename A.
    const a_hash = doc.read_region("a").hash;
    await doc.set_title({ id: "a", title: "First", expected_hash: a_hash });
    const on_disk = await Deno.readTextFile(path);
    assertEquals(on_disk.startsWith("# First\n\nbody\n"), true);
    assertEquals(on_disk.includes("# B\n"), true);
  });
});

Deno.test("open_document — Conflict responses don't write a redundant save", async () => {
  await with_temp_doc("# A\n\nbody\n", async (path) => {
    const doc = await open_document(path);
    const before_stat = await Deno.stat(path);
    const r = await doc.edit_region({
      id: "a",
      find: "body",
      replacement: "x",
      expected_hash: "0".repeat(16),
    });
    assertEquals("conflict" in r, true);
    const after_stat = await Deno.stat(path);
    // mtime should be unchanged since no write occurred.
    assertEquals(before_stat.mtime?.getTime(), after_stat.mtime?.getTime());
  });
});

Deno.test("open_document — list_regions works without touching disk", async () => {
  await with_temp_doc("# A\n\n# B\n", async (path) => {
    const doc = await open_document(path);
    const tree = doc.list_regions();
    assertEquals(tree.children.map((c) => c.id), ["a", "b"]);
  });
});
