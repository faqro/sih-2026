# Frontend

Expo React Native application configured for web by default.

## Commands

- `npm start` starts Expo in the web browser.
- `npm run web` starts Expo in the web browser.
- `npm run export:web` generates a static web export in `dist`.
- `npm run android` or `npm run ios` starts the native targets.

## Cloudflare Pages deployment

The GitHub Actions workflow deploys a new static web export whenever a commit is
pushed to `main`.

1. Create a Cloudflare Pages project with the Direct Upload deployment method:
   ```sh
   npx wrangler pages project create YOUR-PROJECT-NAME --production-branch main
   ```
2. In Cloudflare, create an API token with **Account > Cloudflare Pages > Edit**
   permission for the account containing the project.
3. In GitHub, open **Settings** > **Secrets and variables** > **Actions** and add:
   - Repository secret `CLOUDFLARE_API_TOKEN`: the Cloudflare API token.
   - Repository variable `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
   - Repository variable `CLOUDFLARE_PAGES_PROJECT`: the Pages project name.
4. Commit and push the workflow to `main`. Every subsequent push to `main`
   rebuilds and deploys the frontend.
