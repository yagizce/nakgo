# Trusted browser contract update

PR42 fixed the byte-equality gate; its workflow still executes the base browser
fixture, which expects the retired Message button. This package keeps workflow and accepted ledger unchanged; the guard additionally
excludes the new dispatcher/fixtures from candidate-file approval. The base runner selects a **base-owned**
legacy or Ara/WhatsApp fixture by the already reviewed tools/project.js hash.
Both fixture hashes must match the existing accepted ledger. Candidate browser
code/ledger, environment flags and unknown contracts cannot select arbitrary code.

Local acceptance: both original and new application passed 198 independent
checks/11 scenarios. Six negative/selection tests passed. No runtime, database,
DNS, secret or subscription changes. Main adoption needs separate user approval;
the prior one-time PR42 exception is not reused. Synchronize all trusted fixture
files verbatim to the application branch only after adoption and rerun real CI.
