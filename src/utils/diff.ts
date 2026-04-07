export interface FieldDiff {
  oldValues: Record<string, any>;
  newValues: Record<string, any>;
}

const ALWAYS_EXCLUDED = ["id", "createdAt", "updatedAt", "created_at", "updated_at"];

export function computeDiff(
  oldEntity: Record<string, any>,
  newEntity: Record<string, any>,
  options?: { only?: string[]; except?: string[]; globalExcept?: string[] },
): FieldDiff | null {
  let fields: string[];

  if (options?.only && options.only.length > 0) {
    fields = options.only;
  } else {
    const allKeys = new Set([...Object.keys(oldEntity), ...Object.keys(newEntity)]);
    fields = Array.from(allKeys);
  }

  const except = new Set([
    ...ALWAYS_EXCLUDED,
    ...(options?.except ?? []),
    ...(options?.globalExcept ?? []),
  ]);

  fields = fields.filter((f) => !except.has(f));

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  for (const field of fields) {
    const oldVal = oldEntity[field];
    const newVal = newEntity[field];

    if (!isEqual(oldVal, newVal)) {
      oldValues[field] = oldVal;
      newValues[field] = newVal;
    }
  }

  if (Object.keys(oldValues).length === 0) {
    return null;
  }

  return { oldValues, newValues };
}

function isEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;

  if (typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  return false;
}
