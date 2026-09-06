export const XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH = 2048

const MAX_DEPTH = 6
const MAX_NODES = 64
const MAX_KEYS_PER_OBJECT = 16
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/
const LIKELY_DYNAMIC_IDENTIFIER = /^(?:[A-Fa-f0-9]{16,}|(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_]{16,32})$/
const TRUNCATED = '!truncated'
const FAILED_FINGERPRINT = '$:unknown|!truncated'

type StructuralType =
  | 'array'
  | 'bigint'
  | 'boolean'
  | 'cycle'
  | 'function'
  | 'null'
  | 'number'
  | 'object'
  | 'string'
  | 'symbol'
  | 'undefined'
  | 'unknown'

export function fingerprintXhsToolResult(raw: unknown): string {
  try {
    return buildFingerprint(raw)
  } catch {
    // Diagnostics must never replace the SOURCE_DRIFT error they are describing.
    return FAILED_FINGERPRINT
  }
}

function buildFingerprint(raw: unknown): string {
  const entries = new Set<string>()
  const ancestors = new WeakSet<object>()
  let nodes = 0
  let truncated = false

  const add = (path: string, type: StructuralType): boolean => {
    if (nodes >= MAX_NODES) {
      truncated = true
      return false
    }
    nodes += 1
    entries.add(`${path}:${type}`)
    return true
  }

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      truncated = true
      return
    }

    const type = structuralType(value)
    if (typeof value === 'object' && value !== null) {
      const containerType = Array.isArray(value) ? 'array' : 'object'
      if (ancestors.has(value)) {
        add(path, 'cycle')
        return
      }
      if (!add(path, containerType)) return
      if (depth === MAX_DEPTH) {
        truncated = true
        return
      }

      ancestors.add(value)
      if (Array.isArray(value)) {
        if (value.length > 0) visit(value[0], `${path}[]`, depth + 1)
      } else {
        let keys: string[]
        try {
          keys = Object.keys(value).sort()
        } catch {
          add(`${path}.<key>`, 'unknown')
          ancestors.delete(value)
          return
        }
        if (keys.length > MAX_KEYS_PER_OBJECT) truncated = true
        for (const key of keys.slice(0, MAX_KEYS_PER_OBJECT)) {
          const safeKey = safeStructuralKey(key)
          let child: unknown
          try {
            child = Reflect.get(value, key)
          } catch {
            child = undefined
          }
          visit(child, `${path}.${safeKey}`, depth + 1)
        }
      }
      ancestors.delete(value)
      return
    }

    add(path, type)
  }

  visit(raw, '$', 0)

  const text = firstText(raw)
  if (text !== undefined) {
    try {
      visit(JSON.parse(text) as unknown, '$text', 0)
    } catch {
      add('$text', 'string')
    }
  }

  return boundedOutput([...entries], truncated)
}

function safeStructuralKey(key: string): string {
  return SAFE_KEY.test(key) && !LIKELY_DYNAMIC_IDENTIFIER.test(key) ? key : '<key>'
}

function firstText(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined
  const content = raw.content
  if (!Array.isArray(content) || !isRecord(content[0])) return undefined
  return typeof content[0].text === 'string' ? content[0].text : undefined
}

function structuralType(value: unknown): StructuralType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'bigint':
    case 'boolean':
    case 'function':
    case 'number':
    case 'string':
    case 'symbol':
    case 'undefined':
      return typeof value
    case 'object':
      return 'object'
    default:
      return 'unknown'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedOutput(entries: string[], wasTruncated: boolean): string {
  const kept: string[] = []
  let truncated = wasTruncated
  for (const entry of entries) {
    const suffixLength = truncated ? TRUNCATED.length + 1 : 0
    const nextLength = kept.join('|').length + (kept.length > 0 ? 1 : 0) + entry.length
    if (nextLength + suffixLength > XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH) {
      truncated = true
      break
    }
    kept.push(entry)
  }

  if (!truncated) return kept.join('|')
  while (
    kept.length > 0 &&
    kept.join('|').length + TRUNCATED.length + 1 > XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH
  ) {
    kept.pop()
  }
  return kept.length > 0 ? `${kept.join('|')}|${TRUNCATED}` : TRUNCATED
}
