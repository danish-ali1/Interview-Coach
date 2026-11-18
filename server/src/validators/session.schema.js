import { z } from 'zod';
import { objectId } from './common.js';
import { DIFFICULTIES } from '../models/InterviewSession.js';

export const createSessionBody = z.object({
  resumeId: objectId,
  jobTitle: z.string().trim().min(2, 'Job title is required').max(120),
  company: z.string().trim().max(120).optional(),
  jobDescription: z
    .string()
    .trim()
    .min(40, 'Paste a longer job description (at least 40 characters)')
    .max(8000, 'Job description is too long (max 8000 characters)'),
  numQuestions: z.coerce.number().int().min(3).max(10).default(5),
  difficulty: z.enum(DIFFICULTIES).default('mid'),
});

export const answerBody = z.object({
  questionId: objectId,
  answer: z
    .string()
    .trim()
    .min(10, 'Please write a fuller answer (at least 10 characters)')
    .max(4000, 'Answer is too long (max 4000 characters)'),
});

export const listSessionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(['active', 'completed']).optional(),
});
