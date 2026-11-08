# Trusted browser contract update

CI loads the browser dispatcher and the selected fixture from the trusted base.
The dispatcher accepts the trusted application manifest and the known variant
that differs only by the retired inbox entry. It verifies the selected legacy
or Ara/WhatsApp fixture against the trusted commit before execution. Candidate
browser code, ledger entries, environment flags and unknown manifests cannot
select arbitrary code.

Previous local acceptance: both original and new application passed 198 independent
checks/11 scenarios. Six negative/selection tests passed. No runtime, database,
DNS, secret or subscription changes. Main adoption needs separate user approval;
the prior one-time PR42 exception is not reused. Synchronize all trusted fixture
files verbatim to the application branch only after adoption and rerun real CI.
