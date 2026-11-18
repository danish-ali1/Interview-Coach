import mongoose from 'mongoose';
import { InterviewSession } from '../models/InterviewSession.js';
import { Resume } from '../models/Resume.js';
import { AppError } from '../utils/AppError.js';
import { round1 } from '../utils/text.js';

const KIND_ROTATION = ['project', 'technical', 'behavioral', 'scenario'];
const MAX_ACTIVE_SESSIONS = 3;

/** Decides what the next question should be about: rotates question types and job requirements. */
export function pickNextPlan(session) {
  const index = session.questions.length;
  const requirements = session.requirements?.length ? session.requirements : [session.jobTitle];
  return {
    index,
    kind: KIND_ROTATION[index % KIND_ROTATION.length],
    focus: requirements[index % requirements.length],
  };
}

const evaluationDto = (e) =>
  e && {
    score: e.score,
    rubric: e.rubric,
    strengths: e.strengths ?? [],
    gaps: e.gaps ?? [],
    feedback: e.feedback,
    improvedAnswer: e.improvedAnswer,
  };

export const toQuestionDto = (q) => ({
  id: String(q._id),
  text: q.text,
  topic: q.topic,
  kind: q.kind,
  sources: (q.sources ?? []).map((s) => ({ section: s.section, snippet: s.snippet })),
  answer: q.answer ?? null,
  answeredAt: q.answeredAt ?? null,
  evaluation: evaluationDto(q.evaluation) ?? null,
});

export function toSessionDto(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id),
    resumeId: String(o.resume),
    resumeTitle: o.resumeTitle ?? null,
    jobTitle: o.jobTitle,
    company: o.company ?? null,
    difficulty: o.difficulty,
    requirements: o.requirements ?? [],
    totalQuestions: o.totalQuestions,
    status: o.status,
    averageScore: o.averageScore ?? null,
    summary: o.summary?.overall ? o.summary : null,
    completedAt: o.completedAt ?? null,
    createdAt: o.createdAt,
    answeredCount: (o.questions ?? []).filter((q) => q.answer).length,
    questions: (o.questions ?? []).map(toQuestionDto),
  };
}

/** Used when the AI cannot produce a summary: the user still gets a useful, deterministic debrief. */
export function buildFallbackSummary(answered) {
  const sorted = [...answered].sort((a, b) => b.evaluation.score - a.evaluation.score);
  const average = round1(answered.reduce((s, q) => s + q.evaluation.score, 0) / answered.length);
  const best = sorted.slice(0, 2).map((q) => q.topic);
  const weakest = sorted.slice(-2).reverse().map((q) => q.topic);
  return {
    overall: `You answered ${answered.length} question${answered.length === 1 ? '' : 's'} with an average score of ${average}/10.`,
    strengths: best.map((t) => `Good performance on ${t}`),
    improvements: weakest.map((t) => `Your ${t} answers had the most room to improve`),
    nextSteps: weakest.map((t) => `Practise another ${t} question and review the suggested answer`),
  };
}

export function createInterviewService({ rag, logger }) {
  const buildQuestion = (session) => {
    const { kind, focus } = pickNextPlan(session);
    return rag.generateQuestion({
      userId: String(session.user),
      resumeId: String(session.resume),
      jobTitle: session.jobTitle,
      company: session.company,
      difficulty: session.difficulty,
      kind,
      focus,
      asked: session.questions.map((q) => q.text),
    });
  };

  const findOwned = async (userId, id) => {
    const session = await InterviewSession.findOne({ _id: id, user: userId });
    if (!session) throw AppError.notFound('Interview not found', 'SESSION_NOT_FOUND');
    return session;
  };

  async function finalize(userId, sessionId) {
    const session = await findOwned(userId, sessionId);
    if (session.status === 'completed') return session;

    const answered = session.questions.filter((q) => q.evaluation?.score != null);
    if (answered.length === 0) {
      throw AppError.badRequest('Answer at least one question before finishing the interview.', 'NO_ANSWERS');
    }
    const averageScore = round1(answered.reduce((s, q) => s + q.evaluation.score, 0) / answered.length);

    let summary;
    try {
      summary = await rag.summarizeSession({
        jobTitle: session.jobTitle,
        company: session.company,
        results: answered.map((q) => ({
          kind: q.kind,
          topic: q.topic,
          score: q.evaluation.score,
          gaps: q.evaluation.gaps ?? [],
        })),
      });
    } catch (err) {
      // The scores are already saved; a failed summary must not lose the interview.
      logger.warn({ err, sessionId }, 'summary generation failed, using fallback');
      summary = buildFallbackSummary(answered);
    }

    const updated = await InterviewSession.findOneAndUpdate(
      { _id: session._id, user: userId, status: 'active' },
      { $set: { status: 'completed', averageScore, summary, completedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return updated ?? findOwned(userId, sessionId); // lost a race with another completion: return the winner
  }

  return {
    async create(userId, input) {
      const resume = await Resume.findOne({ _id: input.resumeId, user: userId }).select('title');
      if (!resume) throw AppError.notFound('Resume not found', 'RESUME_NOT_FOUND');

      if ((await InterviewSession.countDocuments({ user: userId, status: 'active' })) >= MAX_ACTIVE_SESSIONS) {
        throw AppError.conflict(
          `You already have ${MAX_ACTIVE_SESSIONS} interviews in progress. Finish or delete one first.`,
          'TOO_MANY_ACTIVE_SESSIONS',
        );
      }

      const requirements = await rag.extractRequirements({
        jobTitle: input.jobTitle,
        jobDescription: input.jobDescription,
      });

      const session = new InterviewSession({
        user: userId,
        resume: resume._id,
        resumeTitle: resume.title,
        jobTitle: input.jobTitle,
        company: input.company || undefined,
        jobDescription: input.jobDescription,
        requirements,
        difficulty: input.difficulty,
        totalQuestions: input.numQuestions,
        questions: [],
      });
      session.questions.push(await buildQuestion(session));
      await session.save();
      return toSessionDto(session);
    },

    async list(userId, { page, limit, status }) {
      const filter = { user: userId, ...(status ? { status } : {}) };
      const [items, total] = await Promise.all([
        InterviewSession.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select(
            'resumeTitle jobTitle company difficulty status totalQuestions averageScore createdAt completedAt resume questions.answer questions.topic',
          )
          .lean(),
        InterviewSession.countDocuments(filter),
      ]);
      return {
        items: items.map((s) => {
          const dto = toSessionDto(s);
          delete dto.questions; // the list view only needs counts
          return dto;
        }),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    },

    async get(userId, id) {
      return toSessionDto(await findOwned(userId, id));
    },

    async answer(userId, sessionId, { questionId, answer }) {
      const session = await findOwned(userId, sessionId);
      if (session.status !== 'active') {
        throw AppError.conflict('This interview is already finished.', 'SESSION_COMPLETED');
      }
      const question = session.questions.id(questionId);
      if (!question) throw AppError.notFound('Question not found', 'QUESTION_NOT_FOUND');
      if (question.answer) throw AppError.conflict('This question was already answered.', 'ALREADY_ANSWERED');

      const questionIndex = session.questions.findIndex((q) => String(q._id) === questionId);
      const nextIndex = session.questions.length;
      const isLast = nextIndex >= session.totalQuestions;
      const qid = new mongoose.Types.ObjectId(questionId);

      // Atomic claim: if the user double-clicks or retries, only one request may evaluate this question.
      const claim = await InterviewSession.updateOne(
        {
          _id: session._id,
          user: userId,
          status: 'active',
          questions: { $elemMatch: { _id: qid, answer: { $exists: false } } },
        },
        { $set: { 'questions.$.answer': answer, 'questions.$.answeredAt': new Date() } },
      );
      if (claim.modifiedCount !== 1) {
        throw AppError.conflict('This question was already answered.', 'ALREADY_ANSWERED');
      }

      try {
        // Evaluating this answer and writing the next question do not depend on each other, so run both at once.
        const [evaluation, nextQuestion] = await Promise.all([
          rag.evaluateAnswer({
            userId: String(session.user),
            resumeId: String(session.resume),
            jobTitle: session.jobTitle,
            difficulty: session.difficulty,
            requirements: session.requirements,
            question: question.text,
            answer,
          }),
          isLast ? Promise.resolve(null) : buildQuestion(session),
        ]);

        // Both writes require status 'active', so nothing can be written into an interview that was
        // finished in another tab while the AI was working.
        const saved = await InterviewSession.updateOne(
          {
            _id: session._id,
            user: userId,
            status: 'active',
            questions: { $elemMatch: { _id: qid, evaluation: { $exists: false } } },
          },
          { $set: { 'questions.$.evaluation': evaluation } },
        );
        if (saved.matchedCount !== 1) {
          throw AppError.conflict('The interview changed while your answer was being evaluated. Please reload.', 'SESSION_CONFLICT');
        }

        // `$size` makes the append idempotent: if the array already has the next question, nothing is added.
        // If the process dies between the two writes, the answer is still scored and the interview can
        // be finished from the UI; it never ends up half-written in a way that blocks the user.
        if (nextQuestion) {
          await InterviewSession.updateOne(
            { _id: session._id, user: userId, status: 'active', questions: { $size: nextIndex } },
            { $push: { questions: nextQuestion } },
          );
        }
      } catch (err) {
        // Release the claim so the user can simply press "Submit" again. Never touches an answer that
        // already has a saved evaluation.
        await InterviewSession.updateOne(
          {
            _id: session._id,
            user: userId,
            questions: { $elemMatch: { _id: qid, evaluation: { $exists: false } } },
          },
          { $unset: { 'questions.$.answer': '', 'questions.$.answeredAt': '' } },
        ).catch((releaseErr) => logger.error({ err: releaseErr }, 'failed to release answer claim'));
        throw err;
      }

      const fresh = isLast ? await finalize(userId, sessionId) : await findOwned(userId, sessionId);
      const dto = toSessionDto(fresh);
      return {
        evaluation: dto.questions[questionIndex].evaluation,
        nextQuestion: dto.questions[nextIndex] ?? null,
        session: dto,
      };
    },

    /** Ends the interview early; unanswered questions are simply skipped. */
    async complete(userId, id) {
      return toSessionDto(await finalize(userId, id));
    },

    async remove(userId, id) {
      const result = await InterviewSession.deleteOne({ _id: id, user: userId });
      if (result.deletedCount !== 1) throw AppError.notFound('Interview not found', 'SESSION_NOT_FOUND');
    },
  };
}
