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

/** Read a markdown file from disk and return a `FileDocument` bound to it. */
export async function open_document(path: string): Promise<FileDocument> {
  const source = await Deno.readTextFile(path);
  return new FileDocument(path, Document.from_string(source));
}

/**
 * Persists a Document to a file on disk. Pure reads (`list_regions`,
 * `read_region`, `read_table`, `to_string`) delegate synchronously. Mutating
 * ops delegate to the inner Document and, if the source actually changed,
 * write the new contents back to the file. Conflict and Error responses
 * don't change the source, so they don't touch the filesystem.
 */
export class FileDocument {
  readonly #path: string;
  readonly #doc: Document;

  constructor(path: string, doc: Document) {
    this.#path = path;
    this.#doc = doc;
  }

  /** Current canonicalized source (same as the last value written to disk). */
  to_string(): string {
    return this.#doc.to_string();
  }

  /** See `Document.list_regions`. */
  list_regions(opts?: { root?: string; depth?: number }): RegionNode {
    return this.#doc.list_regions(opts);
  }

  /** See `Document.read_region`. */
  read_region(id: string): ReadRegionResult {
    return this.#doc.read_region(id);
  }

  /** See `Document.read_table`. */
  read_table(id: string): ReadTableResult {
    return this.#doc.read_table(id);
  }

  /** See `Document.edit_region`. Persists to disk on success. */
  edit_region(opts: {
    id: string;
    find?: string;
    replacement: string;
    expected_hash: string;
  }): Promise<EditResult> {
    return this.#mutate(() => this.#doc.edit_region(opts));
  }

  /** See `Document.append_region`. Persists to disk on success. */
  append_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): Promise<OkResult | ConflictResult> {
    return this.#mutate(() => this.#doc.append_region(opts));
  }

  /** See `Document.prepend_region`. Persists to disk on success. */
  prepend_region(opts: {
    id: string;
    content: string;
    expected_hash: string;
  }): Promise<OkResult | ConflictResult> {
    return this.#mutate(() => this.#doc.prepend_region(opts));
  }

  /** See `Document.insert_region`. Persists to disk on success. */
  insert_region(opts: {
    parent_id?: string;
    after_child_id?: string;
    content: string;
    expected_hash: string;
    stable_id?: string;
  }): Promise<InsertResult> {
    return this.#mutate(() => this.#doc.insert_region(opts));
  }

  /** See `Document.set_title`. Persists to disk on success. */
  set_title(opts: {
    id: string;
    title: string;
    expected_hash: string;
  }): Promise<{ id: string; hash: string } | ConflictResult | ErrorResult> {
    return this.#mutate(() => this.#doc.set_title(opts));
  }

  /** See `Document.stabilize_region`. Persists to disk on success. */
  stabilize_region(opts: {
    id: string;
    stable_id?: string;
    expected_hash: string;
  }): Promise<{ stable_id: string; hash: string } | ConflictResult | ErrorResult> {
    return this.#mutate(() => this.#doc.stabilize_region(opts));
  }

  /** See `Document.update_cells`. Persists to disk on success. */
  update_cells(opts: {
    id: string;
    edits: { row: number; col: number; value: string }[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.update_cells(opts));
  }

  /** See `Document.update_headers`. Persists to disk on success. */
  update_headers(opts: {
    id: string;
    edits: { col: number; value: string }[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.update_headers(opts));
  }

  /** See `Document.insert_rows`. Persists to disk on success. */
  insert_rows(opts: {
    id: string;
    after_row: number;
    rows: string[][];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.insert_rows(opts));
  }

  /** See `Document.delete_rows`. Persists to disk on success. */
  delete_rows(opts: {
    id: string;
    row_indices: number[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.delete_rows(opts));
  }

  /** See `Document.insert_columns`. Persists to disk on success. */
  insert_columns(opts: {
    id: string;
    after_col: number;
    headers: string[];
    cells?: string[][];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.insert_columns(opts));
  }

  /** See `Document.delete_columns`. Persists to disk on success. */
  delete_columns(opts: {
    id: string;
    col_indices: number[];
    expected_hash: string;
  }): Promise<TableWriteResult> {
    return this.#mutate(() => this.#doc.delete_columns(opts));
  }

  /**
   * Run a mutating op on the inner Document, then write the new source back
   * to disk if it changed. Skips the write on Conflict/Error (source unchanged)
   * so file mtime only moves on real edits.
   */
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
