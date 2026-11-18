import mongoose from 'mongoose';
import { InterviewSession } from '../models/InterviewSession.js';
import { round1 } from '../utils/text.js';

/** Aggregates evaluated answers into the numbers behind the dashboard charts. */
export function createProgressService() {
  return {
    async getProgress(userId) {
      const uid = new mongoose.Types.ObjectId(String(userId));

      const [facets] = await InterviewSession.aggregate([
        { $match: { user: uid } },
        { $unwind: '$questions' },
        { $match: { 'questions.evaluation.score': { $exists: true } } },
        {
          $facet: {
            overall: [
              {
                $group: {
                  _id: null,
                  answers: { $sum: 1 },
                  averageScore: { $avg: '$questions.evaluation.score' },
                  bestScore: { $max: '$questions.evaluation.score' },
                },
              },
            ],
            byTopic: [
              {
                $group: {
                  _id: { $toLower: '$questions.topic' },
                  topic: { $first: '$questions.topic' },
                  averageScore: { $avg: '$questions.evaluation.score' },
                  answers: { $sum: 1 },
                },
              },
              { $sort: { averageScore: 1, answers: -1 } },
              { $limit: 12 },
            ],
            byKind: [
              {
                $group: {
                  _id: '$questions.kind',
                  averageScore: { $avg: '$questions.evaluation.score' },
                  answers: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]);

      const [sessions, completedSessions, recent] = await Promise.all([
        InterviewSession.countDocuments({ user: uid }),
        InterviewSession.countDocuments({ user: uid, status: 'completed' }),
        InterviewSession.find({ user: uid, status: 'completed' })
          .sort({ completedAt: -1 })
          .limit(20)
          .select('jobTitle company averageScore completedAt')
          .lean(),
      ]);

      const overall = facets?.overall?.[0];
      const byTopic = (facets?.byTopic ?? []).map((t) => ({
        topic: t.topic,
        averageScore: round1(t.averageScore),
        answers: t.answers,
      }));

      return {
        totals: {
          sessions,
          completedSessions,
          answers: overall?.answers ?? 0,
          averageScore: overall ? round1(overall.averageScore) : null,
          bestScore: overall ? round1(overall.bestScore) : null,
        },
        byTopic, // weakest first
        weakestTopics: byTopic.slice(0, 3),
        byKind: (facets?.byKind ?? []).map((k) => ({
          kind: k._id,
          averageScore: round1(k.averageScore),
          answers: k.answers,
        })),
        trend: recent.reverse().map((s) => ({
          sessionId: String(s._id),
          jobTitle: s.jobTitle,
          company: s.company ?? null,
          averageScore: s.averageScore,
          completedAt: s.completedAt,
        })),
      };
    },
  };
}
