# Parcel service: sample deployment runbook

This is fictional, public sample data for the DUO starter. Do not run these commands.

Deploy a reviewed build to staging with `parcelctl deploy --env staging`.
Check readiness at `/readyz`. The `/healthz` endpoint only checks that the process is alive.
If readiness fails after deployment, use `parcelctl rollback --previous`.
The rollback command restores the previous release; it does not delete customer records.

This runbook does not specify a production availability SLA.
