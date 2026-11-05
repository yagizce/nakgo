# Exact control baseline proposal

This branch changes no application, database, DNS or Vercel configuration.
The ledger proposes the 17 original product-contract file changes plus the strict SDK flow-id fixture correction from the
Cloudflare branch. It becomes authoritative only after independent review
and adoption into protected main; this branch cannot approve itself in CI.

CI must continue running the **base checkout's** guard. Only its adjacent
ledger is read; candidate files, flags, environment variables and PR labels
cannot supply approval. Both old and new normalized SHA-256 must match.
Guard, workflow, runner, security-static and approval-ledger changes are never
eligible. Missing/symlink files still fail. Auto-merge rules remain unchanged.

After adoption, synchronize guard/control-test/ledger verbatim from main to
the application branch. A further edit to any approved test needs new review.
This proposal itself requires a trusted-controls transition; do not bypass
branch protection. A main merge also triggers Vercel's existing deployment,
so adoption needs the user's separate approval before that action.
