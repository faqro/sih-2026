# Backend

Node.js and Express API.

## Commands

- `npm run dev` starts the API with automatic reloads.
- `npm start` starts the API.
- `npm run build` type-checks and compiles the API to `dist`.

The health endpoint is available at `GET /health`. Set `PORT` to change the default port of `3000`.

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
