/**
 * API client for the user service.
 * Clean, typed, with proper error handling and timeouts.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface CreateUserRequest {
  email: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE_URL = process.env.API_URL ?? "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getUser(id: string): Promise<User> {
  return request<User>(`/users/${encodeURIComponent(id)}`);
}

export async function createUser(data: CreateUserRequest): Promise<User> {
  return request<User>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listUsers(): Promise<User[]> {
  return request<User[]>("/users?limit=100");
}
