/** Parsed diff for a single file in the PR */
export interface FileDiff {
  filename: string;
  /** Map from new-file line number to diff position (1-indexed from start of file diff) */
  lineToPosition: Map<number, number>;
  /** Set of line numbers that are additions ('+' lines) */
  addedLines: Set<number>;
}

/**
 * Parse a unified diff string into a map keyed by filename.
 *
 * Walks through lines produced by `git diff`, tracking file headers,
 * hunk headers, and individual change lines to build a mapping from
 * new-file line numbers to their 1-indexed diff positions.
 */
export function parseDiff(diffText: string): Map<string, FileDiff> {
  const result = new Map<string, FileDiff>();
  const lines = diffText.split("\n");

  let currentFile: FileDiff | null = null;
  let position = 0;
  let newLineNumber = 0;
  let isBinary = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file diff header: diff --git a/... b/...
    if (line.startsWith("diff --git ")) {
      // Extract filename from the b/... part
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      if (match) {
        const filename = match[1];
        currentFile = {
          filename,
          lineToPosition: new Map(),
          addedLines: new Set(),
        };
        result.set(filename, currentFile);
        position = 0;
        isBinary = false;
      } else {
        // Deleted file or unrecognizable header — reset
        currentFile = null;
        isBinary = false;
      }
      continue;
    }

    // Handle rename to — update the filename key
    if (line.startsWith("rename to ") && currentFile) {
      const newName = line.slice("rename to ".length);
      result.delete(currentFile.filename);
      currentFile.filename = newName;
      result.set(newName, currentFile);
      continue;
    }

    // Skip binary files — remove the entry we already added
    if (line.startsWith("Binary files ")) {
      isBinary = true;
      if (currentFile) {
        result.delete(currentFile.filename);
      }
      currentFile = null;
      continue;
    }

    if (!currentFile || isBinary) continue;

    // Hunk header: @@ -old_start,old_count +new_start,new_count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLineNumber = parseInt(hunkMatch[1], 10);
      position++;
      continue;
    }

    // Skip metadata lines before the first hunk (e.g., --- a/file, +++ b/file, index, mode)
    if (position === 0) continue;

    // Addition line
    if (line.startsWith("+")) {
      currentFile.lineToPosition.set(newLineNumber, position);
      currentFile.addedLines.add(newLineNumber);
      newLineNumber++;
      position++;
      continue;
    }

    // Deletion line
    if (line.startsWith("-")) {
      position++;
      continue;
    }

    // Context line (starts with space)
    if (line.startsWith(" ")) {
      currentFile.lineToPosition.set(newLineNumber, position);
      newLineNumber++;
      position++;
      continue;
    }

    // No-newline-at-end-of-file marker
    if (line.startsWith("\\")) {
      position++;
      continue;
    }
  }

  return result;
}

/**
 * Look up the diff position for a given file and line number.
 * Returns null if the file or line is not part of the diff.
 */
export function findDiffPosition(
  fileDiffs: Map<string, FileDiff>,
  filename: string,
  line: number,
): number | null {
  const fileDiff = fileDiffs.get(filename);
  if (!fileDiff) return null;
  return fileDiff.lineToPosition.get(line) ?? null;
}

/**
 * Check if a line was added or modified in the diff.
 */
export function isLineChanged(
  fileDiffs: Map<string, FileDiff>,
  filename: string,
  line: number,
): boolean {
  const fileDiff = fileDiffs.get(filename);
  if (!fileDiff) return false;
  return fileDiff.addedLines.has(line);
}
