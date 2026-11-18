import { z } from 'zod';

export const uploadResumeBody = z.object({
  title: z.string().trim().max(100).optional(),
});
