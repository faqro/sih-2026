import { model, Schema } from 'mongoose';

export type AppMode = 'order' | 'dapper';
export type AuthProvider = 'local' | 'steam';
export const DAP_SERVICES = [
  'UberDap',
  'UberDap Plus',
  'UberDap Deluxe',
] as const;
export type DapService = (typeof DAP_SERVICES)[number];

type UserDocument = {
  username: string;
  name?: string | null;
  password?: string;
  authProvider: AuthProvider;
  steamId?: string | null;
  steamUsername?: string | null;
  steamAvatar?: string | null;
  activeMode: AppMode;
  offeredServices: DapService[];
  crispinessRatingTotal: number;
  crispinessRatingCount: number;
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
    name: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },
    password: {
      type: String,
      required: false,
      select: false,
    },
    authProvider: {
      type: String,
      enum: ['local', 'steam'],
      default: 'local',
      required: true,
    },
    steamId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    steamUsername: {
      type: String,
      trim: true,
      default: null,
    },
    steamAvatar: {
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
    crispinessRatingTotal: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    crispinessRatingCount: {
      type: Number,
      default: 0,
      min: 0,
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
