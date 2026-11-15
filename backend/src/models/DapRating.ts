import { model, Schema } from 'mongoose';

import { DAP_SERVICES, type DapService } from './User.js';

type DapRatingDocument = {
  requestId: string;
  userId: string;
  dapperId: string;
  service?: DapService | null;
  raterUsername?: string | null;
  rating: number | null;
  comment?: string | null;
  ratedAt?: Date | null;
};

const dapRatingSchema = new Schema<DapRatingDocument>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    dapperId: {
      type: String,
      required: true,
      index: true,
    },
    service: {
      type: String,
      enum: DAP_SERVICES,
      default: null,
    },
    raterUsername: {
      type: String,
      trim: true,
      default: null,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
    },
    ratedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

dapRatingSchema.index({ dapperId: 1, ratedAt: -1, updatedAt: -1 });

export const DapRating = model('DapRating', dapRatingSchema);
