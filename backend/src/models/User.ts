import { model, Schema } from 'mongoose';

export type AccountType = 'user' | 'dapper';

type UserDocument = {
  username: string;
  password: string;
  accountType: AccountType;
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
    accountType: {
      type: String,
      enum: ['user', 'dapper'],
      default: 'user',
      required: true,
    },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
