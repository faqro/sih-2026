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
seven-day JSON Web Token on success. `DELETE /auth/account` deletes the account
belonging to a valid bearer token; it requires the `Authorization: Bearer <token>`
header and returns `204` on success.

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
