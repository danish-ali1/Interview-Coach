import { z } from 'zod';
import { AppError } from '../utils/AppError.js';
import { extractJson } from '../utils/json.js';
import { clamp, round1, sanitizeForPrompt, truncate } from '../utils/text.js';
import * as prompts from './prompts.js';

const score = z.coerce.number().min(0).max(10);
const shortText = (max) => z.string().trim().min(1).max(max);

const requirementsSchema = z.object({
  requirements: z.array(shortText(200)).min(3).max(12),
});

const questionSchema = z.object({
  question: z.string().trim().min(10).max(800),
  topic: shortText(60),
});

const evaluationSchema = z.object({
  rubric: z.object({
    relevance: score,
    technicalAccuracy: score,
    depth: score,
    communication: score,
  }),
  strengths: z.array(shortText(300)).max(5).default([]),
  gaps: z.array(shortText(300)).max(5).default([]),
  feedback: shortText(1500),
  improvedAnswer: shortText(3000),
});

const summarySchema = z.object({
  overall: shortText(1500),
  strengths: z.array(shortText(300)).min(1).max(5),
  improvements: z.array(shortText(300)).min(1).max(5),
  nextSteps: z.array(shortText(300)).min(1).max(5),
});

/**
 * The final score is computed here from the rubric instead of trusting a single number from the
 * model: it is reproducible, explainable ("technical accuracy counts 35%") and harder to game.
 */
export const RUBRIC_WEIGHTS = { relevance: 0.25, technicalAccuracy: 0.35, depth: 0.25, communication: 0.15 };

export function computeScore(rubric) {
  const total = Object.entries(RUBRIC_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + clamp(Number(rubric[key]) || 0, 0, 10) * weight,
    0,
  );
  return round1(total);
}

const toTitle = (topic) => topic.replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * Retrieval-Augmented Generation for the interview coach.
 *
 *   index:    resume chunks  -> embeddings (RETRIEVAL_DOCUMENT) -> vector store
 *   retrieve: question text  -> embedding  (RETRIEVAL_QUERY)    -> top-k similar chunks
 *   generate: retrieved chunks + job requirements go into the prompt, so questions and
 *             evaluations are grounded in what the candidate actually wrote.
 *
 * `gemini` and `vectorStore` are injected, so the whole pipeline is testable with fakes.
 */
export function createRagService({ gemini, vectorStore, logger }) {
  /** Calls the model, parses JSON, validates against a schema, and retries once with the error fed back. */
  async function callValidated({ schema, system, prompt, temperature }) {
    let lastIssue = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await gemini.generate({
        system,
        temperature,
        prompt: attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous reply was rejected: ${lastIssue}\nReturn ONLY valid JSON that matches the requested shape.`,
      });
      try {
        return schema.parse(extractJson(text));
      } catch (err) {
        lastIssue =
          err instanceof z.ZodError
            ? err.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')
            : err.message;
        logger?.warn({ attempt, issue: lastIssue }, 'model output failed validation');
      }
    }
    throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI returned an unexpected answer. Please try again.');
  }

  async function retrieve({ userId, resumeId, query, k = 4 }) {
    const [vector] = await gemini.embed([sanitizeForPrompt(query, 1000)], 'RETRIEVAL_QUERY');
    return vectorStore.search({ userId, resumeId, vector, k });
  }

  return {
    async indexResume({ userId, resumeId, chunks }) {
      // The section name is part of the embedded text: "projects: Built a REST API..." matches
      // project questions better than the bare sentence would.
      const vectors = await gemini.embed(
        chunks.map((c) => `${c.section}: ${c.text}`),
        'RETRIEVAL_DOCUMENT',
      );
      await vectorStore.insertMany(
        chunks.map((c, i) => ({
          user: userId,
          resume: resumeId,
          index: c.index,
          section: c.section,
          text: c.text,
          embedding: vectors[i],
        })),
      );
    },

    retrieve,

    async extractRequirements({ jobTitle, jobDescription }) {
      const result = await callValidated({
        schema: requirementsSchema,
        system: prompts.SYSTEM.requirements,
        prompt: prompts.buildRequirementsPrompt({ jobTitle, jobDescription }),
        temperature: 0.2,
      });
      return result.requirements;
    },

    async generateQuestion({ userId, resumeId, jobTitle, company, difficulty, kind, focus, asked }) {
      const chunks = await retrieve({
        userId,
        resumeId,
        query: `${focus} ${prompts.KIND_QUERY_HINT[kind] ?? ''}`,
        k: 4,
      });
      const result = await callValidated({
        schema: questionSchema,
        system: prompts.SYSTEM.question,
        prompt: prompts.buildQuestionPrompt({ jobTitle, company, difficulty, kind, focus, chunks, asked }),
        temperature: 0.8,
      });
      return {
        text: result.question,
        topic: toTitle(result.topic),
        kind,
        focus,
        sources: chunks.map((c) => ({ chunkId: c.id, section: c.section, snippet: truncate(c.text, 300) })),
      };
    },

    async evaluateAnswer({ userId, resumeId, jobTitle, difficulty, requirements, question, answer }) {
      const chunks = await retrieve({ userId, resumeId, query: question, k: 4 });
      const result = await callValidated({
        schema: evaluationSchema,
        system: prompts.SYSTEM.evaluation,
        prompt: prompts.buildEvaluationPrompt({ jobTitle, difficulty, requirements, question, answer, chunks }),
        temperature: 0.2,
      });
      return {
        score: computeScore(result.rubric),
        rubric: {
          relevance: round1(result.rubric.relevance),
          technicalAccuracy: round1(result.rubric.technicalAccuracy),
          depth: round1(result.rubric.depth),
          communication: round1(result.rubric.communication),
        },
        strengths: result.strengths,
        gaps: result.gaps,
        feedback: result.feedback,
        improvedAnswer: result.improvedAnswer,
      };
    },

    async summarizeSession({ jobTitle, company, results }) {
      return callValidated({
        schema: summarySchema,
        system: prompts.SYSTEM.summary,
        prompt: prompts.buildSummaryPrompt({ jobTitle, company, results }),
        temperature: 0.4,
      });
    },
  };
}
