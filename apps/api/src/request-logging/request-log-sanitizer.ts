const MASKED = "[masked]";
const CIRCULAR = "[circular]";
const MAX_DEPTH = "[max-depth]";
const TRUNCATED = "[truncated]";
const UNAVAILABLE = "[unavailable]";
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LENGTH = 1_024;

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|set-cookie|password|token|secret|hash|session|jwt|admin[-_ ]?session|api[-_ ]?key|credential|csrf|xsrf|init[-_ ]?data|auth[-_ ]?proof|signature|email|e[-_ ]?mail|phone|name|username|user[-_ ]?name|client[-_ ]?name|telegram[-_ ]?id|note/i;

const URL_KEY_PATTERN = /(?:^|[-_ ])url$|url$/i;

const SELECTED_HEADER_NAMES = [
  "content-type",
  "user-agent",
  "origin",
  "x-request-id",
  "x-forwarded-for",
  "x-telegram-id",
  "x-client-telegram-id",
  "x-client-telegram-photo-url",
  "authorization",
  "cookie",
  "set-cookie"
] as const;

export function sanitizeForRequestLog(value: unknown): unknown {
  try {
    return sanitizeValue(value, new WeakSet<object>(), 0);
  } catch {
    return UNAVAILABLE;
  }
}

export function sanitizeSelectedHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, unknown> {
  try {
    const sanitized: Record<string, unknown> = {};
    for (const name of SELECTED_HEADER_NAMES) {
      const value = findHeader(headers, name);
      if (value !== undefined) {
        sanitized[name] = isSensitiveKey(name) ? MASKED : sanitizeForRequestLog(value);
      }
    }
    return sanitized;
  } catch {
    return { headers: UNAVAILABLE };
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return UNAVAILABLE;
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }
  if (depth >= 6) {
    return MAX_DEPTH;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, seen, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(TRUNCATED);
    }
    return items;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const sanitized: Record<string, unknown> = {};
  let count = 0;
  for (const [key, nested] of Object.entries(value)) {
    if (count >= MAX_OBJECT_KEYS) {
      sanitized[TRUNCATED] = TRUNCATED;
      break;
    }
    sanitized[key] = isSensitiveKey(key) ? MASKED : sanitizeValue(nested, seen, depth + 1);
    count += 1;
  }
  return sanitized;
}

function findHeader(
  headers: Record<string, string | string[] | undefined>,
  wanted: string
): string | string[] | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || URL_KEY_PATTERN.test(key);
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
}
