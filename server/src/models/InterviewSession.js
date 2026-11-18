import mongoose from 'mongoose';

const { Schema } = mongoose;

export const QUESTION_KINDS = ['project', 'technical', 'behavioral', 'scenario'];
export const DIFFICULTIES = ['junior', 'mid', 'senior'];

const sourceSchema = new Schema(
  {
    chunkId: { type: Schema.Types.ObjectId },
    section: { type: String, maxlength: 40 },
    snippet: { type: String, maxlength: 400 },
  },
  { _id: false },
);

const evaluationSchema = new Schema(
  {
    score: { type: Number, min: 0, max: 10, required: true },
    rubric: {
      relevance: { type: Number, min: 0, max: 10 },
      technicalAccuracy: { type: Number, min: 0, max: 10 },
      depth: { type: Number, min: 0, max: 10 },
      communication: { type: Number, min: 0, max: 10 },
    },
    strengths: { type: [String], default: [] },
    gaps: { type: [String], default: [] },
    feedback: { type: String, maxlength: 2000 },
    improvedAnswer: { type: String, maxlength: 4000 },
  },
  { _id: false },
);

const questionSchema = new Schema({
  text: { type: String, required: true, maxlength: 1000 },
  topic: { type: String, required: true, maxlength: 60 },
  kind: { type: String, enum: QUESTION_KINDS, required: true },
  focus: { type: String, maxlength: 200 },
  // The resume passages the question was grounded in (shown to the user as "based on your resume").
  sources: { type: [sourceSchema], default: [] },
  answer: { type: String, maxlength: 4000 },
  answeredAt: { type: Date },
  evaluation: { type: evaluationSchema },
});

const summarySchema = new Schema(
  {
    overall: { type: String, maxlength: 2000 },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    nextSteps: { type: [String], default: [] },
  },
  { _id: false },
);

const interviewSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resume: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
    // Snapshot so history still reads well after the resume is deleted.
    resumeTitle: { type: String, maxlength: 100 },
    jobTitle: { type: String, required: true, trim: true, maxlength: 120 },
    company: { type: String, trim: true, maxlength: 120 },
    jobDescription: { type: String, required: true, maxlength: 8000 },
    requirements: { type: [String], default: [] },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'mid' },
    totalQuestions: { type: Number, required: true, min: 1, max: 15 },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    questions: { type: [questionSchema], default: [] },
    averageScore: { type: Number, min: 0, max: 10 },
    summary: { type: summarySchema },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

interviewSessionSchema.index({ user: 1, createdAt: -1 });
interviewSessionSchema.index({ user: 1, status: 1 });
interviewSessionSchema.index({ resume: 1, status: 1 });

export const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);
