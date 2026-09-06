export type AmapBusinessErrorCategory =
  | 'CREDENTIAL_INVALID'
  | 'CREDENTIAL_PLATFORM_MISMATCH'
  | 'CREDENTIAL_RESTRICTION'
  | 'PERMISSION_DENIED'
  | 'QUOTA_OR_RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'UPSTREAM_UNAVAILABLE'
  | 'OTHER'

interface AmapErrorRule {
  category: AmapBusinessErrorCategory
  identifiers: readonly string[]
  codes: readonly string[]
}

const AMAP_ERROR_RULES: readonly AmapErrorRule[] = [
  {
    category: 'CREDENTIAL_PLATFORM_MISMATCH',
    identifiers: ['USERKEY_PLAT_NOMATCH'],
    codes: ['10009']
  },
  {
    category: 'CREDENTIAL_INVALID',
    identifiers: ['INVALID_USER_KEY', 'USER_KEY_RECYCLED', 'KEY_NOT_FOUND', 'KEY_AND_ID_NOT_MATCH'],
    codes: ['10001', '10013', '32000', '32004']
  },
  {
    category: 'CREDENTIAL_RESTRICTION',
    identifiers: [
      'INVALID_USER_IP',
      'INVALID_USER_DOMAIN',
      'INVALID_USER_SIGNATURE',
      'INVALID_USER_SCODE',
      'INVALID_USER_AGENT',
      'INVALID_USER_ILLEGAL'
    ],
    codes: ['10005', '10006', '10007', '10008', '10022', '10026']
  },
  {
    category: 'PERMISSION_DENIED',
    identifiers: [
      'SERVICE_NOT_AVAILABLE',
      'INSUFFICIENT_PRIVILEGES',
      'INSUFFICIENT_ABROAD_PRIVILEGES',
      'NO_EFFECTIVE_INTERFACE',
      'SERVICE_MISSING',
      'SERVICE_NOT_EXIST'
    ],
    codes: ['10002', '10012', '10023', '20011', '32030', '32031']
  },
  {
    category: 'QUOTA_OR_RATE_LIMIT',
    identifiers: [
      'DAILY_QUERY_OVER_LIMIT',
      'ACCESS_TOO_FREQUENT',
      'IP_QUERY_OVER_LIMIT',
      'QPS_HAS_EXCEEDED_THE_LIMIT',
      'CQPS_HAS_EXCEEDED_THE_LIMIT',
      'CKQPS_HAS_EXCEEDED_THE_LIMIT',
      'CUQPS_HAS_EXCEEDED_THE_LIMIT',
      'ABROAD_DAILY_QUERY_OVER_LIMIT',
      'USER_DAILY_QUERY_OVER_LIMIT',
      'QUOTA_PLAN_RUN_OUT',
      'QUOTA_MISSING',
      'SERVICE_EXPIRED'
    ],
    codes: [
      '10003',
      '10004',
      '10010',
      '10014',
      '10019',
      '10020',
      '10021',
      '10029',
      '10044',
      '30002',
      '40000',
      '40002'
    ]
  },
  {
    category: 'INVALID_REQUEST',
    identifiers: [
      'INVALID_PARAMS',
      'MISSING_REQUIRED_PARAMS',
      'ILLEGAL_REQUEST',
      'ILLEGAL_CONTENT'
    ],
    codes: ['20000', '20001', '20002', '20012']
  },
  {
    category: 'UPSTREAM_UNAVAILABLE',
    identifiers: [
      'GATEWAY_TIMEOUT',
      'SERVER_IS_BUSY',
      'RESOURCE_UNAVAILABLE',
      'ROUTING_FAILURE',
      'ENGINE_RESPONSE_DATA_ERROR',
      'SERVER_MAINTENANCE',
      'DISPATCH_ERROR'
    ],
    codes: ['10015', '10016', '10017', '30000', '30001', '30003', '32016', '32034']
  }
]

export function classifyAmapBusinessError(text: string): AmapBusinessErrorCategory {
  const normalized = text.toUpperCase()
  for (const rule of AMAP_ERROR_RULES) {
    if (
      rule.identifiers.some((identifier) => containsIdentifier(normalized, identifier)) ||
      rule.codes.some((code) => containsNumericCode(normalized, code))
    ) {
      return rule.category
    }
  }
  return 'OTHER'
}

function containsIdentifier(text: string, identifier: string): boolean {
  return containsBoundedToken(text, identifier, isIdentifierCharacter)
}

function containsNumericCode(text: string, code: string): boolean {
  return containsBoundedToken(text, code, isDigit)
}

function containsBoundedToken(
  text: string,
  token: string,
  isBoundaryCharacter: (value: string | undefined) => boolean
): boolean {
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(token, offset)
    if (start < 0) return false
    if (!isBoundaryCharacter(text[start - 1]) && !isBoundaryCharacter(text[start + token.length])) {
      return true
    }
    offset = start + 1
  }
  return false
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Z0-9_]/.test(value)
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9'
}
