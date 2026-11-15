# Backend

Node.js and Express API.

## Commands

- `npm run dev` starts the API with automatic reloads.
- `npm start` starts the API.
- `npm run build` type-checks and compiles the API to `dist`.

The health endpoint is available at `GET /health`. Set `PORT` to change the default port of `3000`.

## Authentication and MongoDB

The API stores username-password accounts in MongoDB through Mongoose. Passwords
are hashed before storage; the API never returns a password hash.

Copy `.env.example` to `.env` and set:

```dotenv
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/sih2026?retryWrites=true&w=majority
JWT_SECRET=replace-with-a-long-random-secret
FRONTEND_ORIGIN=http://localhost:8081
PORT=3000
```

- `MONGODB_URI` is the MongoDB Atlas (or local MongoDB) connection string.
- `JWT_SECRET` must be a long, unique random value.
- `FRONTEND_ORIGIN` is the URL allowed to call the API. Set it to the deployed
  Cloudflare Pages URL in production.

The available endpoints are `POST /auth/signup` and `POST /auth/login`. Both
accept JSON with `username` and `password`, and return a user object and
seven-day JSON Web Token on success. Accounts have an `activeMode` of `order`
or `dapper`. New accounts start in order mode and complete onboarding before
choosing a mode. Dapper onboarding requires at least one service in
`offeredServices`; `PATCH /auth/preferences` updates that list and also requires
at least one of `UberDap`, `UberDap Plus`, or `UberDap Deluxe`.
`DELETE /auth/account` deletes the account belonging to a valid bearer token;
it requires the `Authorization: Bearer <token>` header and returns `204` on
success.

### Strava sign-in

Create a Strava API application at [strava.com/settings/api](https://www.strava.com/settings/api)
and set its **Authorization Callback Domain** to the backend host (for example,
`localhost` for local development or `your-app.fly.dev` in production). Strava
expects a domain here, not a URL or path. The app's callback URL is
`http://localhost:3000/auth/strava/callback` locally and
`https://your-app.fly.dev/auth/strava/callback` in production. Keep
`STRAVA_REDIRECT_URI` identical to the callback URL and ensure the dashboard's
callback domain matches its hostname. Strava may allow only one callback domain
per API app, so update it when switching between local and production testing.

Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_REDIRECT_URI` in the
backend environment. For Fly.io, configure these as Fly secrets (not frontend
or GitHub Actions secrets), for example:

```sh
fly secrets set STRAVA_CLIENT_ID=YOUR_CLIENT_ID STRAVA_CLIENT_SECRET=YOUR_CLIENT_SECRET STRAVA_REDIRECT_URI=https://your-app.fly.dev/auth/strava/callback
```

The backend requests only Strava's `read` scope and does not retain Strava
access or refresh tokens; it uses the athlete profile returned during OAuth to
create the UberDaps account. New Strava API apps start in single-player mode;
only the app owner can authorize during that stage. Upgrade access in the Strava
API dashboard when ready to allow other athletes, and submit the app for review
if you need capacity beyond the default limit.

The WebSocket endpoint `/ws/dapper-location` accepts an initial JSON message
`{"type":"authenticate","token":"<jwt>"}`. Dappers send
`{"type":"location","latitude":...,"longitude":...}` while online. Order-mode
users send `{"type":"request","service":"UberDap","latitude":...,"longitude":...}`
to begin matching, then location updates while their request is pending. The
backend offers each request to the nearest available online dapper within
75 km, one at a time; unanswered offers expire after 30 seconds and matching
continues for up to 10 minutes. Dappers respond with `accept` or `decline`
messages and finish an accepted request with `delivered`. Locations and request
state are kept in process memory, not MongoDB; disconnecting or changing modes
stops the relevant location stream.

## Fly.io deployment

The GitHub Actions workflow deploys the backend when a commit is pushed to `main`.

1. Install and authenticate the Fly CLI:
   ```sh
   fly auth login
   ```
2. From this directory, provision the application without deploying:
   ```sh
   fly launch --no-deploy
   ```
   Choose a globally unique application name and a preferred region. This updates `fly.toml`; ensure its `app` value is no longer the placeholder.
3. Create a deploy token and copy it:
   ```sh
   fly tokens create deploy -x 999999h
   ```
4. In GitHub, open **Settings** > **Secrets and variables** > **Actions**, create a repository secret named `FLY_API_TOKEN`, and paste the token.
5. Commit and push the Fly configuration and workflow to `main`. Every later push to `main` deploys the backend.

To deploy manually from this directory, run:
```sh
fly deploy
```
