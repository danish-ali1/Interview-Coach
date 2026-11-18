import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Resume metadata only. The raw file and full text are deliberately NOT stored:
 * the content lives as embedded chunks (see ResumeChunk), which keeps personal data
 * to the minimum the app needs and makes deletion simple.
 */
const resumeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    originalName: { type: String, trim: true, maxlength: 200 },
    mimeType: { type: String, maxlength: 100 },
    sizeBytes: { type: Number, min: 0 },
    charCount: { type: Number, min: 0, default: 0 },
    chunkCount: { type: Number, min: 0, default: 0 },
    sections: { type: [String], default: [] },
  },
  { timestamps: true },
);

resumeSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.user;
    return ret;
  },
});

export const Resume = mongoose.model('Resume', resumeSchema);
