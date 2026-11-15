import { model, Schema } from 'mongoose';

export type AppMode = 'order' | 'dapper';
export type AuthProvider = 'local' | 'chess';
export const DAP_SERVICES = [
  'UberDap',
  'UberDap Plus',
  'UberDap Deluxe',
] as const;
export type DapService = (typeof DAP_SERVICES)[number];

type UserDocument = {
  username: string;
  password?: string;
  authProvider: AuthProvider;
  chessId?: string | null;
  chessUsername?: string | null;
  chessAvatar?: string | null;
  activeMode: AppMode;
  offeredServices: DapService[];
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
      minlength: 2,
      maxlength: 40,
      match: /^[a-z0-9_-]+$/,
    },
    password: {
      type: String,
      required: false,
      select: false,
    },
    authProvider: {
      type: String,
      enum: ['local', 'chess'],
      default: 'local',
      required: true,
    },
    chessId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    chessUsername: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    chessAvatar: {
      type: String,
      trim: true,
      default: null,
    },
    activeMode: {
      type: String,
      enum: ['order', 'dapper'],
      default: 'order',
      required: true,
    },
    offeredServices: {
      type: [{ type: String, enum: DAP_SERVICES }],
      default: [],
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
