import { model, Schema } from 'mongoose';

type DapRatingDocument = {
  requestId: string;
  userId: string;
  dapperId: string;
  rating: number | null;
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
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
  },
  { timestamps: true },
);

export const DapRating = model('DapRating', dapRatingSchema);
