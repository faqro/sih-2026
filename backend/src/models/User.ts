import { model, Schema } from 'mongoose';

export type AppMode = 'order' | 'dapper';

type UserDocument = {
  username: string;
  password: string;
  activeMode: AppMode;
  hasCompletedOnboarding: boolean;
  onboardingCompletedAt: Date | null;
};

const userSchema = new Schema<UserDocument>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    activeMode: {
      type: String,
      enum: ['order', 'dapper'],
      default: 'order',
      required: true,
    },
    hasCompletedOnboarding: {
      type: Boolean,
      default: false,
      required: true,
    },
    onboardingCompletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
