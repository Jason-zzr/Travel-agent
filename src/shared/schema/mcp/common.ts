import { z } from 'zod'

export const McpTextContentSchema = z.object({ type: z.literal('text'), text: z.string() })
export const McpTextToolResultSchema = z.object({
  content: z.array(McpTextContentSchema).min(1),
  isError: z.boolean().optional()
})
export type McpTextToolResult = z.infer<typeof McpTextToolResultSchema>

export function firstMcpText(result: McpTextToolResult): string {
  return result.content[0]!.text
}
