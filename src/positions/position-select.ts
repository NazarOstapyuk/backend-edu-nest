export const positionSelect = {
  select: {
    id: true,
    name: true,
    teaching: true,
    permissions: { select: { area: true, level: true } },
  },
} as const;

export const positionRef = (
  p: { id: string; name: string; teaching: boolean } | null,
): { id: string; name: string; teaching: boolean } | null =>
  p ? { id: p.id, name: p.name, teaching: p.teaching } : null;
