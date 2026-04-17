// markdown-regions — structured read/write access to markdown for agent collaboration.
// See spec.md for the API surface and usage.md for worked examples.

export { Document } from "./document.ts";
export type {
  ConflictResult,
  EditResult,
  ErrorResult,
  FindErrorResult,
  InsertOkResult,
  InsertResult,
  OkResult,
  ReadRegionResult,
  ReadTableResult,
  RegionNode,
  TableConflictResult,
  TableWriteResult,
} from "./document.ts";
export { FileDocument, open_document } from "./file.ts";
