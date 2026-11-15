import { model, Schema } from 'mongoose';

type OAuthSessionDocument = {
  state: string;
  provider: 'strava';
  pollToken: string;
  redirectUri: string;
  returnTo: string | null;
  status: 'pending' | 'completed' | 'error' | 'cancelled';
  inFlight: boolean;
  exchangeCode?: string | null;
  errorMessage?: string | null;
  expiresAt: Date;
};

const oauthSessionSchema = new Schema<OAuthSessionDocument>({
  state: {
    type: String,
    required: true,
    unique: true,
  },
  provider: {
    type: String,
    enum: ['strava'],
    required: true,
  },
  pollToken: {
    type: String,
    required: true,
  },
  redirectUri: {
    type: String,
    required: true,
  },
  returnTo: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'error', 'cancelled'],
    default: 'pending',
    required: true,
  },
  inFlight: {
    type: Boolean,
    default: false,
    required: true,
  },
  exchangeCode: {
    type: String,
    default: null,
  },
  errorMessage: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

type OAuthExchangeDocument = {
  code: string;
  token: string;
  user: unknown;
  expiresAt: Date;
};

const oauthExchangeSchema = new Schema<OAuthExchangeDocument>({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  token: {
    type: String,
    required: true,
  },
  user: {
    type: Schema.Types.Mixed,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

export const OAuthSession = model('OAuthSession', oauthSessionSchema);
export const OAuthExchange = model('OAuthExchange', oauthExchangeSchema);
