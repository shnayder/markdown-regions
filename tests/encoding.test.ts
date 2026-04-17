import { assertEquals } from "@std/assert";
import { Document } from "../src/mod.ts";

Deno.test("CRLF — normalized to LF on ingest", () => {
  const src = "# A\r\n\r\nbody\r\n";
  const doc = Document.from_string(src);
  assertEquals(doc.to_string().includes("\r"), false);
  assertEquals(doc.to_string(), "# A\n\nbody\n");
});

Deno.test("CRLF — hashes are equal after normalization", () => {
  const crlf = Document.from_string("# A\r\nbody\r\n").list_regions();
  const lf = Document.from_string("# A\nbody\n").list_regions();
  assertEquals(crlf.hash, lf.hash);
  assertEquals(crlf.children[0].hash, lf.children[0].hash);
});

Deno.test("lone CR — normalized to LF", () => {
  const src = "# A\rbody\r";
  const doc = Document.from_string(src);
  assertEquals(doc.to_string().includes("\r"), false);
});

Deno.test("codepoint char_length — counts codepoints, not UTF-16 code units", () => {
  // 💡 is a non-BMP codepoint (UTF-16 surrogate pair length 2, codepoint 1).
  const src = "# A\n\n💡💡💡\n";
  const doc = Document.from_string(src);
  const a = doc.list_regions().children[0];
  const content = doc.read_region("a").content;
  // Codepoint length of the content (as reported by char_length).
  const expected = Array.from(content).length;
  assertEquals(a.char_length, expected);
});

Deno.test("codepoint char_length — multibyte CJK characters count as one each", () => {
  // ASCII heading so the slug is well-defined; CJK in the body.
  const src = "# Intro\n\n日本語の本文\n";
  const doc = Document.from_string(src);
  const a = doc.list_regions().children[0];
  const content = doc.read_region("intro").content;
  assertEquals(a.char_length, Array.from(content).length);
});

Deno.test("CRLF — edits on CRLF input work after normalization", () => {
  const doc = Document.from_string("# A\r\n\r\nbody\r\n");
  const { hash } = doc.read_region("a");
  doc.edit_region({
    id: "a",
    find: "body",
    replacement: "changed",
    expected_hash: hash,
  });
  assertEquals(doc.to_string(), "# A\n\nchanged\n");
});
