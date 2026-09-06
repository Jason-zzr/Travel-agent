import type { Context, Plugin } from 'cordis'

const WRITE_KEYWORDS = [
  '下单',
  '支付',
  '预订确认',
  '锁价',
  '盯价',
  '取消',
  '退款',
  '导航',
  '打车',
  '唤起'
]

export class PolicyService {
  checkTool(toolName: string, description: string, allowlist: ReadonlySet<string>): true | string {
    if (!allowlist.has(toolName)) return 'NOT_IN_ALLOWLIST'
    const content = `${toolName} ${description}`
    return WRITE_KEYWORDS.some((keyword) => content.includes(keyword)) ? 'WRITE_KEYWORD_HIT' : true
  }
}

declare module 'cordis' {
  interface Context {
    policy: PolicyService
  }
}

export const policyPlugin: Plugin.Function<Context, undefined> = (ctx) => {
  ctx.set('policy', new PolicyService())
}
policyPlugin.inject = []
