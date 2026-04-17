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
  // Canonical source extent (used for hashing).
  range_start: number;
  range_end: number;
  // Editable content extent (what edit_region splices over).
  content_range_start: number;
  content_range_end: number;
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

export interface OkResult {
  hash: string;
}

export interface ConflictResult {
  conflict: true;
  current_content: string;
  current_hash: string;
  region_still_exists: boolean;
}

export interface FindErrorResult {
  error: "find_not_found" | "find_ambiguous";
  match_count?: number;
  current_content: string;
  current_hash: string;
}

export type EditResult = OkResult | ConflictResult | FindErrorResult;

export interface InsertOkResult {
  id: string;
  hash: string;
}

export interface ErrorResult {
  error: string;
}

export type InsertResult = InsertOkResult | ConflictResult | ErrorResult;

export class Document {
  #source!: string;
  // deno-lint-ignore no-explicit-any
  #ast!: any;
  #tree!: RegionNode;
  #regions!: Map<string, RegionData>;
  #root!: { content: string; hash: string };

  private constructor(source: string) {
    this.#parse(source);
  }

  #parse(source: string): void {
    this.#source = source;
    this.#ast = processor.parse(source);
    this.#regions = new Map();
    const children = collect_regions(
      this.#ast.children,
      0,
      "",
      source,
      source.length,
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

  edit_region(opts: {
    id: string;
    find?: string;
    replacement: string;
    expected_hash: string;
  }): EditResult {
    // Root is addressed separately — no entry in the regions map.
    if (opts.id === "") {
      return this.#edit_root(opts);
    }
    const region = this.#regions.get(opts.id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(opts.id)}`);
    }
    if (region.hash !== opts.expected_hash) {
      return {
        conflict: true,
        current_content: region.content,
        current_hash: region.hash,
        region_still_exists: true,
      };
    }
    const new_content_or_err = resolve_new_content(region.content, opts);
    if ("error" in new_content_or_err) {
      return {
        ...new_content_or_err,
        current_content: region.content,
        current_hash: region.hash,
      };
    }
    const new_source = splice(
      this.#source,
      region.content_range_start,
      region.content_range_end,
      new_content_or_err.new_content,
    );
    this.#parse(new_source);
    const updated = this.#regions.get(opts.id);
    if (!updated) {
      // Shouldn't normally happen — find/replace in body doesn't change section
      // IDs. If it does (e.g., whole-body edit with no heading), fall back to
      // the new root hash.
      return { hash: this.#root.hash };
    }
    return { hash: updated.hash };
  }

  append_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): OkResult | ConflictResult {
    return this.#at_boundary(opts.id, opts.expected_hash, "end", opts.content);
  }

  prepend_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): OkResult | ConflictResult {
    return this.#at_boundary(opts.id, opts.expected_hash, "start", opts.content);
  }

  #at_boundary(
    id: string,
    expected_hash: string,
    where: "start" | "end",
    content: string,
  ): OkResult | ConflictResult {
    // Root: insert at 0 (start) or source.length (end).
    if (id === "") {
      if (this.#root.hash !== expected_hash) {
        return {
          conflict: true,
          current_content: this.#root.content,
          current_hash: this.#root.hash,
          region_still_exists: true,
        };
      }
      const new_source = where === "end" ? this.#source + content : content + this.#source;
      this.#parse(new_source);
      return { hash: this.#root.hash };
    }
    const region = this.#regions.get(id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(id)}`);
    }
    if (region.type === "table") {
      throw new Error(
        `append/prepend not applicable to tables — use insert_rows`,
      );
    }
    if (region.hash !== expected_hash) {
      return {
        conflict: true,
        current_content: region.content,
        current_hash: region.hash,
        region_still_exists: true,
      };
    }
    const at = where === "end" ? region.content_range_end : region.content_range_start;
    const new_source = splice(this.#source, at, at, content);
    this.#parse(new_source);
    const updated = this.#regions.get(id);
    return { hash: updated ? updated.hash : this.#root.hash };
  }

  insert_region(opts: {
    parent_id?: string;
    after_child_id?: string;
    content: string;
    expected_hash: string;
    stable_id?: string;
  }): InsertResult {
    const parent_id = opts.parent_id ?? "";

    // Resolve parent: root or a section (tables/code have no children).
    let parent_depth: number;
    let parent_hash: string;
    let parent_content: string;
    let parent_content_start: number;
    let parent_content_end: number;
    if (parent_id === "") {
      parent_depth = 0;
      parent_hash = this.#root.hash;
      parent_content = this.#root.content;
      parent_content_start = 0;
      parent_content_end = this.#source.length;
    } else {
      const p = this.#regions.get(parent_id);
      if (!p) {
        return { error: `parent not found: ${parent_id}` };
      }
      if (p.type !== "section") {
        return { error: `parent is not a section: ${parent_id}` };
      }
      parent_depth = p.ast_node.depth ?? 1;
      parent_hash = p.hash;
      parent_content = p.content;
      parent_content_start = p.content_range_start;
      parent_content_end = p.content_range_end;
    }

    if (parent_hash !== opts.expected_hash) {
      return {
        conflict: true,
        current_content: parent_content,
        current_hash: parent_hash,
        region_still_exists: true,
      };
    }

    // Validate stable_id if provided.
    if (opts.stable_id !== undefined) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.stable_id)) {
        return { error: `invalid stable_id format: ${opts.stable_id}` };
      }
      if (this.#regions.has(opts.stable_id)) {
        return { error: `stable_id already in use: ${opts.stable_id}` };
      }
    }

    // Parse the content and check shape: exactly one top-level region,
    // starting with a heading / table / code fence.
    const content_ast = processor.parse(opts.content);
    const top_level = content_ast.children ?? [];
    const region_like = top_level.filter((n: AstNode) =>
      n.type === "heading" || n.type === "table" || n.type === "code"
    );
    if (region_like.length === 0) {
      return { error: "content must begin with a heading, table, or code fence" };
    }
    // Find the first non-html/whitespace node; must be a region-like kind.
    const first_substantive = top_level.find((n: AstNode) => n.type !== "html");
    if (
      !first_substantive ||
      (first_substantive.type !== "heading" &&
        first_substantive.type !== "table" &&
        first_substantive.type !== "code")
    ) {
      return { error: "content must begin with a heading, table, or code fence" };
    }
    // Count top-level regions: for headings, only those at the shallowest
    // depth count as top-level sections; tables/code blocks each count as one.
    const heading_depths: number[] = top_level
      .filter((n: AstNode) => n.type === "heading")
      .map((n: AstNode) => n.depth as number);
    const min_depth = heading_depths.length > 0 ? Math.min(...heading_depths) : Infinity;
    const top_section_count = heading_depths.filter((d) => d === min_depth).length;
    const top_table_or_code = top_level.filter(
      (n: AstNode) => n.type === "table" || n.type === "code",
    ).length;
    const total_top = top_section_count + top_table_or_code;
    if (total_top > 1) {
      return { error: "content contains more than one top-level region" };
    }

    // Heading level normalization for section content.
    let normalized = opts.content;
    const first_type = first_substantive.type as "heading" | "table" | "code";
    if (first_type === "heading") {
      // deno-lint-ignore no-explicit-any
      const leading_depth = (first_substantive as any).depth as number;
      const target = parent_depth + 1;
      const delta = target - leading_depth;
      if (delta !== 0) {
        normalized = shift_heading_levels(normalized, delta);
      }
    }

    // Inject stable_id anchor.
    if (opts.stable_id !== undefined) {
      normalized = inject_anchor(normalized, opts.stable_id, first_type);
    }

    // Ensure trailing newline for clean splicing.
    if (!normalized.endsWith("\n")) normalized += "\n";

    // Compute insertion offset.
    let insert_at: number;
    if (opts.after_child_id !== undefined) {
      const sibling = this.#regions.get(opts.after_child_id);
      if (!sibling) {
        return { error: `after_child_id not found: ${opts.after_child_id}` };
      }
      if (
        sibling.range_start < parent_content_start ||
        sibling.range_end > parent_content_end
      ) {
        return { error: `after_child_id is not a child of parent: ${opts.after_child_id}` };
      }
      insert_at = sibling.range_end;
    } else {
      insert_at = parent_content_start;
    }

    // Snapshot existing IDs so we can find the newly-inserted one.
    const ids_before = new Set(this.#regions.keys());

    const new_source = splice(this.#source, insert_at, insert_at, normalized);
    this.#parse(new_source);

    // Find the new region.
    if (opts.stable_id !== undefined) {
      const r = this.#regions.get(opts.stable_id);
      if (r) return { id: r.id, hash: r.hash };
    }
    // Fallback: find the first newly-appeared region ID.
    for (const [id, r] of this.#regions) {
      if (!ids_before.has(id)) {
        return { id: r.id, hash: r.hash };
      }
    }
    // Nothing new detected — shouldn't happen in valid inserts.
    return { error: "insert succeeded but new region could not be located" };
  }

  set_title(opts: {
    id: string;
    title: string;
    expected_hash: string;
  }): InsertOkResult | ConflictResult | ErrorResult {
    if (opts.id === "") {
      return { error: "root has no title" };
    }
    const region = this.#regions.get(opts.id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(opts.id)}`);
    }
    if (region.type === "table") {
      return { error: "tables have no title" };
    }
    if (region.hash !== opts.expected_hash) {
      return {
        conflict: true,
        current_content: region.content,
        current_hash: region.hash,
        region_still_exists: true,
      };
    }
    // Build a replacement for the heading/opener line and splice it in, leaving
    // the body untouched.
    let new_line: string;
    let line_start: number;
    let line_end: number;
    if (region.type === "section") {
      const depth = region.ast_node.depth as number;
      const anchor = region.stable_id !== undefined ? ` <!-- mdr:id=${region.stable_id} -->` : "";
      new_line = `${"#".repeat(depth)} ${opts.title}${anchor}`;
      line_start = region.ast_node.position?.start.offset ?? region.range_start;
      line_end = region.ast_node.position?.end.offset ?? region.content_range_start;
    } else {
      // code block: replace the fence opener line's language portion only.
      const node_start = region.ast_node.position?.start.offset ?? region.range_start;
      const opener_nl = this.#source.indexOf("\n", node_start);
      const opener_end = opener_nl === -1 ? this.#source.length : opener_nl;
      const opener = this.#source.slice(node_start, opener_end);
      const fence_match = opener.match(/^([`~]+)/);
      if (!fence_match) {
        return { error: "could not locate code fence" };
      }
      const fence = fence_match[1];
      new_line = `${fence}${opts.title}`;
      line_start = node_start;
      line_end = opener_end;
    }
    const new_source = splice(this.#source, line_start, line_end, new_line);
    // Track whether we can still resolve the region after re-parse (slug for a
    // section can change; stable_id or code's '#code-N' stays put).
    const preferred_id = region.stable_id ?? opts.id;
    this.#parse(new_source);
    const updated = this.#regions.get(preferred_id) ??
      (opts.id !== preferred_id ? this.#regions.get(opts.id) : undefined);
    if (updated) return { id: updated.id, hash: updated.hash };
    // Section rename without a stable_id: slug changed. Find the new region by
    // locating the heading line we just wrote.
    if (region.type === "section") {
      const new_slug = slugify(opts.title);
      // Scan for the slug-derived ID somewhere in the tree (prefix-agnostic).
      for (const [id, r] of this.#regions) {
        if (id === new_slug || id.endsWith(`/${new_slug}`)) {
          if (r.hash !== region.hash) return { id: r.id, hash: r.hash };
        }
      }
    }
    return { error: "set_title succeeded but new region could not be located" };
  }

  stabilize_region(opts: {
    id: string;
    stable_id?: string;
    expected_hash: string;
  }): { stable_id: string; hash: string } | ConflictResult | ErrorResult {
    if (opts.id === "") {
      return { error: "root has no stable_id" };
    }
    const region = this.#regions.get(opts.id);
    if (!region) {
      throw new Error(`region not found: ${JSON.stringify(opts.id)}`);
    }
    if (region.hash !== opts.expected_hash) {
      return {
        conflict: true,
        current_content: region.content,
        current_hash: region.hash,
        region_still_exists: true,
      };
    }
    // Default stable_id: the region's slug leaf (last path segment after / or #).
    const slug_leaf = opts.id.split(/[/#]/).pop() ?? opts.id;
    const target = opts.stable_id ?? slug_leaf;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(target)) {
      return { error: `invalid stable_id format: ${target}` };
    }
    // No-op when already stamped with the requested value.
    if (region.stable_id === target) {
      return { stable_id: target, hash: region.hash };
    }
    // Uniqueness: another region must not already claim this stable_id.
    const existing = this.#regions.get(target);
    if (existing && existing !== region) {
      return { error: `stable_id already in use: ${target}` };
    }
    // Compute new source: rewrite the region's anchor.
    let new_source: string;
    if (region.type === "section") {
      // Rebuild the heading line with (new) anchor.
      const depth = region.ast_node.depth as number;
      const title = region.title ?? "";
      const new_line = `${"#".repeat(depth)} ${title} <!-- mdr:id=${target} -->`;
      const line_start = region.ast_node.position?.start.offset ?? region.range_start;
      const line_end = region.ast_node.position?.end.offset ?? region.content_range_start;
      new_source = splice(this.#source, line_start, line_end, new_line);
    } else {
      // Table or code: either add an anchor line or replace the existing one.
      const node_start = region.ast_node.position?.start.offset ?? region.range_start;
      if (region.stable_id !== undefined) {
        // Replace existing anchor line (which extends region.range_start .. node_start).
        const anchor_start = region.range_start;
        const anchor_end = node_start; // end of the anchor line, including its \n
        new_source = splice(
          this.#source,
          anchor_start,
          anchor_end,
          `<!-- mdr:id=${target} -->\n`,
        );
      } else {
        // Insert a new anchor line immediately before the region.
        new_source = splice(
          this.#source,
          node_start,
          node_start,
          `<!-- mdr:id=${target} -->\n`,
        );
      }
    }
    this.#parse(new_source);
    const updated = this.#regions.get(target);
    if (!updated) {
      return { error: "stabilize succeeded but new region could not be located" };
    }
    return { stable_id: target, hash: updated.hash };
  }

  #edit_root(opts: {
    find?: string;
    replacement: string;
    expected_hash: string;
  }): EditResult {
    if (this.#root.hash !== opts.expected_hash) {
      return {
        conflict: true,
        current_content: this.#root.content,
        current_hash: this.#root.hash,
        region_still_exists: true,
      };
    }
    const new_content_or_err = resolve_new_content(this.#root.content, opts);
    if ("error" in new_content_or_err) {
      return {
        ...new_content_or_err,
        current_content: this.#root.content,
        current_hash: this.#root.hash,
      };
    }
    this.#parse(new_content_or_err.new_content);
    return { hash: this.#root.hash };
  }
}

function compute_hash(canonical: string): string {
  const digest = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(digest).slice(0, 16);
}

function splice(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}

// Apply find/replace or whole-body substitution, surfacing FindError cases.
// Returns the new content on success, or { error, match_count? } on failure —
// the caller adds current_content/current_hash from the region.
function resolve_new_content(
  content: string,
  opts: { find?: string; replacement: string },
):
  | { new_content: string }
  | { error: "find_not_found" | "find_ambiguous"; match_count?: number } {
  if (opts.find === undefined) {
    return { new_content: opts.replacement };
  }
  const count = count_occurrences(content, opts.find);
  if (count === 0) return { error: "find_not_found" };
  if (count > 1) return { error: "find_ambiguous", match_count: count };
  const idx = content.indexOf(opts.find);
  return {
    new_content: content.slice(0, idx) + opts.replacement + content.slice(idx + opts.find.length),
  };
}

function count_occurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

// Shift the depth of every ATX heading in `content` by `delta`. Applied at
// line start with a trailing space or line end (so a bare '#tag' inline isn't
// touched). Depth is clamped to [1, 6].
function shift_heading_levels(content: string, delta: number): string {
  return content.replace(/^(#{1,6})(?=[ \t]|$)/gm, (_m, hashes: string) => {
    const new_depth = Math.max(1, Math.min(6, hashes.length + delta));
    return "#".repeat(new_depth);
  });
}

// Inject an anchor comment. For section content, append to the first heading
// line. For tables and code blocks, prepend on its own line.
function inject_anchor(
  content: string,
  stable_id: string,
  kind: "heading" | "table" | "code",
): string {
  const anchor = `<!-- mdr:id=${stable_id} -->`;
  if (kind === "heading") {
    const nl = content.indexOf("\n");
    const first_line = nl === -1 ? content : content.slice(0, nl);
    const rest = nl === -1 ? "" : content.slice(nl);
    return `${first_line.replace(/\s*$/, "")} ${anchor}${rest}`;
  }
  return `${anchor}\n${content}`;
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
        content_range_start: content_start,
        content_range_end: content_end,
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

      // Content range: full canonical for tables; for code, locate node.value
      // inside the fenced block so edits splice the body without disturbing the
      // fence.
      let content_range_start: number;
      let content_range_end: number;
      if (is_table) {
        content_range_start = start;
        content_range_end = end;
      } else {
        const node_start = node.position?.start.offset ?? start;
        const node_end = node.position?.end.offset ?? end;
        const idx = source.indexOf(content, node_start);
        if (idx !== -1 && idx + content.length <= node_end) {
          content_range_start = idx;
          content_range_end = idx + content.length;
        } else {
          // Fallback: treat whole node as content (indented code, or parser quirk).
          content_range_start = node_start;
          content_range_end = node_end;
        }
      }

      const data: RegionData = {
        id,
        ...(stable_id ? { stable_id } : {}),
        type: is_table ? "table" : "code",
        title: is_table ? null : (node.lang ?? null),
        hash,
        content,
        range_start: start,
        range_end: end,
        content_range_start,
        content_range_end,
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
