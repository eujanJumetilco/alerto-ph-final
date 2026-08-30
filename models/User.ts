// models/User.ts
import { Schema, model, models, Document } from 'mongoose'

// 2. Main User Interface
export interface IUser extends Document {
  mobileNumber: string
  firstName: string
  lastName: string
  suffix?: string
  email: string
  address?: string
  createdAt: Date
  updatedAt: Date
}

// 3. User Schema definition
const UserSchema = new Schema<IUser>(
  {
    mobileNumber: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    suffix: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    address: {
        type: String,
        trim: true,
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  }
)

// 4. Export safely for Next.js hot-reloading / serverless
export default models.User || model<IUser>('User', UserSchema)