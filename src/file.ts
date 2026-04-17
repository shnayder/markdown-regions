import { Document } from "./document.ts";
import type {
  ConflictResult,
  EditResult,
  ErrorResult,
  InsertResult,
  OkResult,
  ReadRegionResult,
  ReadTableResult,
  RegionNode,
  TableWriteResult,
} from "./document.ts";

export async function open_document(path: string): Promise<FileDocument> {
  const source = await Deno.readTextFile(path);
  return new FileDocument(path, Document.from_string(source));
}

// Thin wrapper over Document that auto-persists to disk after each mutating
// op. Pure reads don't touch the filesystem.
export class FileDocument {
  readonly #path: string;
  readonly #doc: Document;

  constructor(path: string, doc: Document) {
    this.#path = path;
    this.#doc = doc;
  }

  to_string(): string {
    return this.#doc.to_string();
  }

  list_regions(opts?: { root?: string; depth?: number }): RegionNode {
    return this.#doc.list_regions(opts);
  }

  read_region(id: string): ReadRegionResult {
    return this.#doc.read_region(id);
  }

  read_table(id: string): ReadTableResult {
    return this.#doc.read_table(id);
  }

  edit_region(opts: {
    id: string;
    find?: string;
    replacement: string;
    expected_hash: string;
  }): Promise<EditResult> {
    return this.#mutate(() => this.#doc.edit_region(opts));
  }

  append_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): Promise<OkResult | ConflictResult> {
    return this.#mutate(() => this.#doc.append_region(opts));
  }

  prepend_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): Promise<OkResult | ConflictResult> {
    return this.#mutate(() => this.#doc.prepend_region(opts));
  }

  insert_region(opts: {
    parent_id?: string;
    after_child_id?: string;
    content: string;
    expected_hash: string;
    stable_id?: string;
  }): Promise<InsertResult> {
    return this.#mutate(() => this.#doc.insert_region(opts));
  }

  set_title(opts: {
    id: string;
    title: string;
    expected_hash: string;
  }): Promise<{ id: string; hash: string } | ConflictResult | ErrorResult> {
    return this.#mutate(() => this.#doc.set_title(opts));
  }

  stabilize_region(opts: {
    id: string;
    stable_id?: string;
    expected_hash: string;
  }): Promise<{ stable_id: string; hash: string } | ConflictResult | ErrorResult> {
    return this.#mutate(() => this.#doc.stabilize_region(opts));
  }

  update_cells(opts: {
    id: string;
    edits: { row: number; col: number; value: string }[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.update_cells(opts));
  }

  update_headers(opts: {
    id: string;
    edits: { col: number; value: string }[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.update_headers(opts));
  }

  insert_rows(opts: {
    id: string;
    after_row: number;
    rows: string[][];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.insert_rows(opts));
  }

  delete_rows(opts: {
    id: string;
    row_indices: number[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.delete_rows(opts));
  }

  insert_columns(opts: {
    id: string;
    after_col: number;
    headers: string[];
    cells?: string[][];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.insert_columns(opts));
  }

  delete_columns(opts: {
    id: string;
    col_indices: number[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.delete_columns(opts));
  }

  async #mutate<T>(fn: () => T): Promise<T> {
    const before = this.#doc.to_string();
    const result = fn();
    const after = this.#doc.to_string();
    if (after !== before) {
      await Deno.writeTextFile(this.#path, after);
    }
    return result;
  }
}
