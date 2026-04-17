import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

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

export class Document {
  #source: string;
  #ast: AstNode;

  private constructor(source: string) {
    this.#source = source;
    this.#ast = processor.parse(source);
  }

  static from_string(source: string): Document {
    return new Document(source);
  }

  to_string(): string {
    return this.#source;
  }

  list_regions(_opts?: { root?: string; depth?: number }): RegionNode {
    const children = build_sections(this.#ast.children, 0, [], this.#source);
    return {
      id: "",
      type: "section",
      title: null,
      hash: "",
      char_length: codepoint_length(this.#source),
      child_count: children.length,
      children,
    };
  }
}

function build_sections(
  nodes: AstNode[],
  parent_depth: number,
  parent_path: string[],
  source: string,
): RegionNode[] {
  const result: RegionNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (node.type === "heading" && node.depth > parent_depth) {
      const section_depth: number = node.depth;
      const title = heading_text(node);

      // Find end of this section's body: up to the next heading of equal/lesser depth.
      let j = i + 1;
      while (j < nodes.length) {
        const n = nodes[j];
        if (n.type === "heading" && n.depth <= section_depth) break;
        j++;
      }

      const body = nodes.slice(i + 1, j);
      const path = [...parent_path, slugify(title)];
      const children = build_sections(body, section_depth, path, source);

      // Content is everything after the heading line, up to end of body.
      const content_start = node.position?.end.offset ?? 0;
      const content_end = body.length > 0
        ? body[body.length - 1].position?.end.offset ?? content_start
        : content_start;
      const content = source.slice(content_start, content_end);

      result.push({
        id: path.join("/"),
        type: "section",
        title,
        hash: "",
        char_length: codepoint_length(content),
        child_count: children.length,
        children,
      });

      i = j;
    } else {
      i++;
    }
  }
  return result;
}

function heading_text(node: AstNode): string {
  return (node.children ?? []).map(extract_text).join("");
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

function codepoint_length(s: string): number {
  return Array.from(s).length;
}
