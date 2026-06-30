# Rule: git

- Branch before feature work: `feature/<slug>` or `fix/<slug>`. Never commit features directly to
  `main`.
- Inspect `git status` / `git diff` before staging. Stage only files for the approved change; leave
  unrelated user changes untouched.
- Never stage `.env`, secrets, `.idea/`, `.turbo/`, `dist/`, coverage, or other local artifacts (see
  `.gitignore`).
- Commit the generated Drizzle migration together with the schema change that produced it.
- Commit/push only when the user asks. Don't open a PR unless explicitly requested.
- Write focused commit messages describing the behavior change, not the file list.
