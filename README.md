# Codezilla workflow core

Codezilla tracks an AI-assisted software change from intake through specification, review, and verification. This TypeScript module contains the workflow state machine, approval rules, and in-memory store from the original pilot.

The workflow service hashes a frozen specification and records approvals against that hash. A later revision needs its own approval. Each transition checks the workflow version so that two runners cannot both claim the same item. The tests exercise these rules with synthetic work items and a fixed clock.

## Run the examples

Use Node.js 22 or newer and npm. Run these commands from the repository root.

```sh
npm ci
npm run verify
```

Start with [the workflow service tests](tests/unit/workflow-service.test.ts) for intake deduplication, stale approvals, and competing runners. See [the state machine](src/domain/state-machine.ts) for all legal transitions and [the policy tests](tests/unit/policy.test.ts) for approval revocation and independent review.

The examples run in memory. They require no service accounts or API keys. The historical commits retain the original module changes and their dates. The standalone package and its test instructions were added for this release.
