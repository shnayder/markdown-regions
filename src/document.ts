import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export interface RegionNode {
  id: string;
  stable_id?: string;
  type: "section" | "table" | "code";
  title: string | null;
  hash: string;
  char_length: number;
  child_count: number;
  children: RegionNode[];
}

// deno-lint-ignore no-explicit-any
type AstNode = any;

const processor = unified().use(remarkParse).use(remarkGfm);

// Anchor comment format: <!-- mdr:id=<slug> -->. Stable IDs must match the
// format before they take effect — anything else is just a regular HTML comment.
const ANCHOR_RE = /^<!--\s*mdr:id=([a-z0-9][a-z0-9-]*)\s*-->$/;

// Richer internal record: everything needed for read/edit ops. Not exposed.
interface RegionData {
  id: string;
  stable_id?: string;
  type: "section" | "table" | "code";
  title: string | null;
  hash: string;
  content: string;
  range_start: number;
  range_end: number;
  ast_node: AstNode;
}

export interface ReadRegionResult {
  title: string | null;
  content: string;
  hash: string;
  stable_id?: string;
}

export interface ReadTableResult {
  headers: string[];
  rows: string[][];
  hash: string;
}

export class Document {
  #source: string;
  #ast: AstNode;
  #tree: RegionNode;
  #regions: Map<string, RegionData>;
  #root: { content: string; hash: string };

  private constructor(source: string) {
    this.#source = source;
    this.#ast = processor.parse(source);
    this.#regions = new Map();
    const children = collect_regions(
      this.#ast.children,
      0,
      "",
      this.#source,
      this.#source.length,
      this.#regions,
    );
    this.#root = {
      content: source,
      hash: compute_hash(source),
    };
    this.#tree = {
      id: "",
      type: "section",
      title: null,
      hash: this.#root.hash,
      char_length: codepoint_length(source),
      child_count: children.length,
      children,
    };
    validate_stable_ids(this.#tree);
  }

  static from_string(source: string): Document {
    return new Document(source);
  }

  to_string(): string {
    return this.#source;
  }

  list_regions(opts?: { root?: string; depth?: number }): RegionNode {
    const root_id = opts?.root ?? "";
    const subtree = root_id === "" ? this.#tree : find_region(this.#tree, root_id);
    if (!subtree) {
      throw new Error(`region not found: ${JSON.stringify(root_id)}`);
    }
    return opts?.depth !== undefined ? truncate_depth(subtree, opts.depth) : subtree;
  }

  read_region(id: string): ReadRegionResult {
    if (id === "") {
      return { title: null, content: this.#root.content, hash: this.#root.hash };
    }
    const region = this.#regions.get(id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(id)}`);
    }
    const out: ReadRegionResult = {
      title: region.title,
      content: region.content,
      hash: region.hash,
    };
    if (region.stable_id !== undefined) out.stable_id = region.stable_id;
    return out;
  }

  read_table(id: string): ReadTableResult {
    const region = this.#regions.get(id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(id)}`);
    }
    if (region.type !== "table") {
      throw new Error(`region is not a table: ${JSON.stringify(id)}`);
    }
    return {
      headers: table_headers(region.ast_node),
      rows: table_rows(region.ast_node),
      hash: region.hash,
    };
  }
}

function compute_hash(canonical: string): string {
  const digest = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(digest).slice(0, 16);
}

function collect_regions(
  nodes: AstNode[],
  parent_depth: number,
  parent_path: string,
  source: string,
  scope_end: number,
  registry: Map<string, RegionData>,
): RegionNode[] {
  const result: RegionNode[] = [];
  let table_idx = 1;
  let code_idx = 1;
  const section_slugs_taken = new Set<string>();
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    if (node.type === "heading" && node.depth > parent_depth) {
      // Section: span until next heading of equal/lesser depth.
      const section_depth: number = node.depth;
      const title = heading_text(node);
      const stable_id = stable_id_in_heading(node);

      let j = i + 1;
      while (j < nodes.length) {
        const n = nodes[j];
        if (n.type === "heading" && n.depth <= section_depth) break;
        j++;
      }

      // Content extends until the next terminating heading (whose start
      // offset marks the boundary), or — if we're the last sibling in this
      // scope — to the end of the enclosing scope. Picking up the trailing
      // whitespace between us and the next section matters for round-tripping.
      const section_start = node.position?.start.offset ?? 0;
      let content_start = node.position?.end.offset ?? section_start;
      // remark's heading.end.offset stops at the heading text; advance past
      // the heading line's terminator so "content" is everything after the line.
      if (content_start < source.length && source[content_start] === "\n") {
        content_start++;
      }
      const content_end = j < nodes.length
        ? (nodes[j].position?.start.offset ?? scope_end)
        : scope_end;

      const body = nodes.slice(i + 1, j);
      const slug = disambiguate(slugify(title), section_slugs_taken);
      section_slugs_taken.add(slug);
      const path = parent_path ? `${parent_path}/${slug}` : slug;
      const children = collect_regions(
        body,
        section_depth,
        path,
        source,
        content_end,
        registry,
      );

      const content = source.slice(content_start, content_end);
      const canonical = source.slice(section_start, content_end);
      const hash = compute_hash(canonical);

      const data: RegionData = {
        id: path,
        ...(stable_id ? { stable_id } : {}),
        type: "section",
        title,
        hash,
        content,
        range_start: section_start,
        range_end: content_end,
        ast_node: node,
      };
      register(registry, data);

      result.push({
        id: path,
        ...(stable_id ? { stable_id } : {}),
        type: "section",
        title,
        hash,
        char_length: codepoint_length(content),
        child_count: children.length,
        children,
      });

      i = j;
      continue;
    }

    if (node.type === "table" || node.type === "code") {
      const is_table = node.type === "table";
      const id = is_table
        ? `${parent_path}#table-${table_idx++}`
        : `${parent_path}#code-${code_idx++}`;
      const stable_id = preceding_anchor_id(nodes, i);
      const { start, end } = region_extent_with_anchor(nodes, i, stable_id !== undefined);
      const canonical = source.slice(start, end);
      const content = is_table ? canonical : String(node.value ?? "");
      const hash = compute_hash(canonical);

      const data: RegionData = {
        id,
        ...(stable_id ? { stable_id } : {}),
        type: is_table ? "table" : "code",
        title: is_table ? null : (node.lang ?? null),
        hash,
        content,
        range_start: start,
        range_end: end,
        ast_node: node,
      };
      register(registry, data);

      result.push({
        id,
        ...(stable_id ? { stable_id } : {}),
        type: is_table ? "table" : "code",
        title: is_table ? null : (node.lang ?? null),
        hash,
        char_length: codepoint_length(canonical),
        child_count: 0,
        children: [],
      });
      i++;
      continue;
    }

    // Paragraphs, lists, blockquotes, raw HTML (incl. anchor comments), etc.
    // are not regions on their own — skip.
    i++;
  }
  return result;
}

function register(registry: Map<string, RegionData>, data: RegionData): void {
  registry.set(data.id, data);
  if (data.stable_id !== undefined) registry.set(data.stable_id, data);
}

function table_headers(table_node: AstNode): string[] {
  const rows = table_node.children ?? [];
  if (rows.length === 0) return [];
  return (rows[0].children ?? []).map((cell: AstNode) => extract_text(cell).trim());
}

function table_rows(table_node: AstNode): string[][] {
  const rows = table_node.children ?? [];
  return rows.slice(1).map((row: AstNode) =>
    (row.children ?? []).map((cell: AstNode) => extract_text(cell).trim())
  );
}

function stable_id_in_heading(heading: AstNode): string | undefined {
  for (const child of heading.children ?? []) {
    if (child.type !== "html") continue;
    const m = String(child.value ?? "").trim().match(ANCHOR_RE);
    if (m) return m[1];
  }
  return undefined;
}

function preceding_anchor_id(nodes: AstNode[], i: number): string | undefined {
  if (i === 0) return undefined;
  const prev = nodes[i - 1];
  if (prev.type !== "html") return undefined;
  const m = String(prev.value ?? "").trim().match(ANCHOR_RE);
  return m ? m[1] : undefined;
}

// When a table/code block has a preceding anchor line, the anchor is part of
// the region's canonical source — extend the region's start offset to cover it.
function region_extent_with_anchor(
  nodes: AstNode[],
  i: number,
  has_anchor: boolean,
): { start: number; end: number } {
  const node = nodes[i];
  const node_start = node.position?.start.offset ?? 0;
  const node_end = node.position?.end.offset ?? node_start;
  if (!has_anchor) return { start: node_start, end: node_end };
  const prev = nodes[i - 1];
  const start = prev.position?.start.offset ?? node_start;
  return { start, end: node_end };
}

function find_region(tree: RegionNode, id: string): RegionNode | undefined {
  if (tree.id === id || tree.stable_id === id) return tree;
  for (const child of tree.children) {
    const found = find_region(child, id);
    if (found) return found;
  }
  return undefined;
}

function truncate_depth(node: RegionNode, depth: number): RegionNode {
  if (depth <= 0) return { ...node, children: [] };
  return {
    ...node,
    children: node.children.map((c) => truncate_depth(c, depth - 1)),
  };
}

function validate_stable_ids(tree: RegionNode): void {
  const seen = new Set<string>();
  const walk = (node: RegionNode) => {
    if (node.stable_id !== undefined) {
      if (seen.has(node.stable_id)) {
        throw new Error(`duplicate stable_id: ${node.stable_id}`);
      }
      seen.add(node.stable_id);
    }
    for (const child of node.children) walk(child);
  };
  walk(tree);
}

function heading_text(node: AstNode): string {
  const parts: string[] = [];
  for (const child of node.children ?? []) {
    if (
      child.type === "html" &&
      ANCHOR_RE.test(String(child.value ?? "").trim())
    ) continue;
    parts.push(extract_text(child));
  }
  return parts.join("").trim();
}

function extract_text(node: AstNode): string {
  if (node.type === "text") return node.value;
  if (node.value) return node.value;
  if (node.children) return (node.children as AstNode[]).map(extract_text).join("");
  return "";
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Per spec: if raw is already taken, try raw-2, raw-3, ... until a free slot.
// The suffixed form may itself collide with a raw slug elsewhere, hence the loop.
function disambiguate(raw: string, taken: Set<string>): string {
  if (!taken.has(raw)) return raw;
  let n = 2;
  while (taken.has(`${raw}-${n}`)) n++;
  return `${raw}-${n}`;
}

function codepoint_length(s: string): number {
  return Array.from(s).length;
}
