export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
  modelled404?: true;
}

export function modelledNotFound(body: unknown): Reply {
  return { ...json(body, 404), modelled404: true };
}

export function json(body: unknown, status = 200): Reply {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function text(body: string, status = 200): Reply {
  return { status, headers: { 'content-type': 'text/plain' }, body };
}

export function notFound(message: string): Reply {
  return json({ message }, 404);
}

export function parseJson(body: string): unknown {
  try {
    const value: unknown = JSON.parse(body);
    return value;
  } catch {
    return undefined;
  }
}

export function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const read: unknown = Reflect.get(value, key);
  return read;
}

export function stringField(value: unknown, key: string): string | undefined {
  const read = field(value, key);
  return typeof read === 'string' ? read : undefined;
}

export function numberField(value: unknown, key: string): number | undefined {
  const read = field(value, key);
  return typeof read === 'number' ? read : undefined;
}
