function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function isoToLocalDateTime(iso?: string): string {
  if (!iso) return '';
  const instant = new Date(iso);
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

export function localDateTimeToIso(localValue: string): string | undefined {
  return localValue ? new Date(localValue).toISOString() : undefined;
}
