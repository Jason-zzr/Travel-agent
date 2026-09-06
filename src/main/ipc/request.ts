import { z } from 'zod'
import { AppError } from '../../shared/errors'

export function parseRequest<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('INPUT_INVALID', '请求参数无效。', {
      cause: parsed.error,
      userHint: '提交内容不完整或格式错误，请检查后重试。'
    })
  }
  return parsed.data
}
