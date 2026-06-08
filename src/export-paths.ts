import * as path from "path";

const SAFE_EXPORT_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/;
const RESERVED_WINDOWS_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const MAX_EXPORT_FILENAME_CHARS = 180;

export class ExportPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportPathError";
  }
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);

  if (process.platform === "win32") {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }

  return resolvedLeft === resolvedRight;
}

export function toExportSlug(threadId: string): string {
  const normalized = threadId
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);

  const slug = normalized.length > 0 ? normalized : "thread";
  return RESERVED_WINDOWS_BASENAMES.has(slug.toUpperCase()) ? `thread-${slug}` : slug;
}

export function createExportFilename(threadId: string, exportedAt = new Date()): string {
  const timestamp = exportedAt.toISOString().replace(/\D/g, "").slice(0, 17);
  return `loom-${toExportSlug(threadId)}-${timestamp}.jsonl`;
}

export function validateExportFilename(filename: string): string {
  if (filename.length === 0) {
    throw new ExportPathError("Export filename is required.");
  }

  if (filename !== filename.trim()) {
    throw new ExportPathError("Export filename cannot start or end with whitespace.");
  }

  if (filename.includes("\0")) {
    throw new ExportPathError("Export filename cannot contain null bytes.");
  }

  if (filename.includes(":")) {
    throw new ExportPathError("Export filename cannot contain ':' characters.");
  }

  if (hasPathSeparator(filename) || filename.includes("..")) {
    throw new ExportPathError("Export filename must be a plain .jsonl filename, not a path.");
  }

  if (filename.length > MAX_EXPORT_FILENAME_CHARS) {
    throw new ExportPathError(
      `Export filename is too long. Maximum length is ${MAX_EXPORT_FILENAME_CHARS} characters.`
    );
  }

  if (!SAFE_EXPORT_FILENAME.test(filename)) {
    throw new ExportPathError(
      "Export filename may contain only letters, numbers, '.', '_', '-', and must end with .jsonl."
    );
  }

  const stem = filename.slice(0, -".jsonl".length);
  if (stem.endsWith(".")) {
    throw new ExportPathError("Export filename stem cannot end with '.'.");
  }

  if (RESERVED_WINDOWS_BASENAMES.has(stem.toUpperCase())) {
    throw new ExportPathError("Export filename uses a reserved Windows device name.");
  }

  return filename;
}

export function resolveExportPath(exportFile: string, exportsDir: string): string {
  if (exportFile.length === 0 || exportFile.trim().length === 0) {
    throw new ExportPathError("Export filename is required.");
  }

  if (exportFile.includes("\0")) {
    throw new ExportPathError("Export path cannot contain null bytes.");
  }

  const basePath = path.resolve(exportsDir);
  const requestedPath = path.isAbsolute(exportFile)
    ? path.resolve(exportFile)
    : path.resolve(basePath, validateExportFilename(exportFile));

  const filename = validateExportFilename(path.basename(requestedPath));
  const parent = path.dirname(requestedPath);

  if (!samePath(parent, basePath)) {
    throw new ExportPathError("Export path must point to a file directly inside the Loom exports directory.");
  }

  return path.join(basePath, filename);
}
