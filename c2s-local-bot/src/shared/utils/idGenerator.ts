export function newId(prefix = 'id'): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}

export function newCorrelationId(): string {
  return newId('corr');
}

export function shortId(value: string, size = 8): string {
  return value.length <= size ? value : value.slice(0, size);
}
