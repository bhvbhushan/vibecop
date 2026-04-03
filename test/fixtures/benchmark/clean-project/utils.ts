/**
 * Utility functions for data transformation and validation.
 * Clean, well-typed, with proper error handling.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Paginate an array of items.
 */
export function paginate<T>(
  items: T[],
  params: PaginationParams,
): PaginatedResult<T> {
  const { page, pageSize } = params;

  if (page < 1) throw new ValidationError("page must be >= 1", "page");
  if (pageSize < 1 || pageSize > 100) {
    throw new ValidationError("pageSize must be between 1 and 100", "pageSize");
  }

  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    items: items.slice(start, end),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Safely parse a JSON string, returning null on failure.
 */
export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Clamp a number within an inclusive range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
