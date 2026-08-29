// models/Report.ts
import { Schema, model, models, Document, Types } from 'mongoose'

// 1. TypeScript Interface
export interface IReport extends Document {
  reporterId: Types.ObjectId
  caseNumber: string
  category: string
  handler?: string
  summary: string
  description: string
  timestamp: number // Stores Date.now() as a Unix timestamp in milliseconds
  location: string
  status: string
  images: string[]
  createdAt: Date
  updatedAt: Date
}

// 2. Mongoose Schema Definition
const ReportSchema = new Schema<IReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reporter ID is required'],
      index: true,
    },
    caseNumber: {
      type: String,
      required: [true, 'Case number is required'],
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    handler: {
      type: String,
      trim: true,
      default: 'Unassigned',
    },
    summary: {
      type: String,
      required: [true, 'Summary is required'],
      trim: true,
      maxlength: [200, 'Summary cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    timestamp: {
      type: Number,
      default: () => Date.now(),
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    status: {
      type: String,
      required: [true, 'Status is required'],
      default: 'Pending',
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

// 3. Export safely for Next.js hot-reloading
export default models.Report || model<IReport>('Report', ReportSchema)