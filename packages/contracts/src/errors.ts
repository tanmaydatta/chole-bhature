import { z } from './zod.js';

export const ApiFieldErrorSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1).optional(),
  message: z.string().min(1),
}).strict();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    retryable: z.boolean(),
    fields: z.array(ApiFieldErrorSchema).optional(),
  }).strict(),
}).strict();

export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
