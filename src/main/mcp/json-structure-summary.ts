import type {
  JsonStructureEntry,
  JsonStructureSummary,
  JsonStructureType
} from '../../shared/schema/mcp/json-structure-summary'

export type {
  JsonStructureEntry,
  JsonStructureSummary,
  JsonStructureType
} from '../../shared/schema/mcp/json-structure-summary'

const MAX_ENTRIES = 256
const MAX_DEPTH = 16
const MAX_ARRAY_ITEMS = 64

export function summarizeJsonText(text: string): JsonStructureSummary {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { payloadKind: 'NON_JSON_TEXT', entries: [], truncated: false }
  }

  const entries = new Map<string, JsonStructureEntry>()
  let truncated = false

  const visit = (current: unknown, path: string, depth: number): void => {
    const type = jsonType(current)
    const entry: JsonStructureEntry =
      type === 'array' ? { path, type, arrayLength: (current as unknown[]).length } : { path, type }
    const identity = `${entry.path}\u0000${entry.type}\u0000${entry.arrayLength ?? ''}`
    if (!entries.has(identity)) {
      if (entries.size >= MAX_ENTRIES) {
        truncated = true
        return
      }
      entries.set(identity, entry)
    }

    if (depth >= MAX_DEPTH) {
      if (
        (Array.isArray(current) && current.length > 0) ||
        (isJsonObject(current) && Object.keys(current).length > 0)
      ) {
        truncated = true
      }
      return
    }

    if (Array.isArray(current)) {
      if (current.length > MAX_ARRAY_ITEMS) truncated = true
      const sampled = current.slice(0, MAX_ARRAY_ITEMS)
      for (const [index, item] of sampled.entries()) {
        visit(item, `${path}/*`, depth + 1)
        if (entries.size >= MAX_ENTRIES && index < sampled.length - 1) {
          truncated = true
          break
        }
      }
      return
    }

    if (isJsonObject(current)) {
      const properties = Object.entries(current)
      for (const [index, [key, item]] of properties.entries()) {
        visit(item, `${path}/${escapeJsonPointerSegment(key)}`, depth + 1)
        if (entries.size >= MAX_ENTRIES && index < properties.length - 1) {
          truncated = true
          break
        }
      }
    }
  }

  visit(value, '$', 0)
  return {
    payloadKind: 'JSON',
    entries: [...entries.values()].sort(compareEntries),
    truncated
  }
}

function jsonType(value: unknown): JsonStructureType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    default:
      return 'object'
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function compareEntries(left: JsonStructureEntry, right: JsonStructureEntry): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1
  if (left.type !== right.type) return left.type < right.type ? -1 : 1
  return (left.arrayLength ?? -1) - (right.arrayLength ?? -1)
}
