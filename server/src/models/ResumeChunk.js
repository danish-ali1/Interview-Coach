import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A retrievable piece of a resume plus its embedding vector (L2-normalised).
 * `embedding` is excluded from normal queries; the vector store asks for it explicitly.
 */
const resumeChunkSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    resume: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
    index: { type: Number, required: true },
    section: { type: String, required: true, maxlength: 40 },
    text: { type: String, required: true, maxlength: 4000 },
    embedding: { type: [Number], required: true, select: false },
  },
  { timestamps: false },
);

resumeChunkSchema.index({ resume: 1, index: 1 }, { unique: true });

export const ResumeChunk = mongoose.model('ResumeChunk', resumeChunkSchema);
