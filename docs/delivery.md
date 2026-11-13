# Delivery evidence and task handoffs

Use this when a task includes a release, migration or delivery across sessions.
BossGoat coordinates work; the project's CI and release tooling establish whether
the requested result was verified. Ordinary edits need no additional release process.

## Read the actual task settings

Inspect the task's brief and Settings block. Skill assignment checks that a known
skill has readable instructions; it does not establish that the agent followed them.
An updated global setting does not rewrite a running worker's brief. Preserve the
user's accepted scope, permissions and exclusions when resuming or handing off work.

| Signal | What it establishes | What still needs evidence |
| --- | --- | --- |
| Skill assigned | The launch can find the requested skill | Relevant guidance was applied to the task |
| Review recorded | A review round was recorded for the applicable work | Required findings were resolved or explicitly accepted under project policy |
| Proof linked | The task points to an artifact | The artifact supports the claim for the exact candidate |
| Ready / accepted | A task lifecycle transition | Required external validation and delivery outcomes |
| PR merged | Git integration completed | The registered artifact was deployed and live acceptance passed |

Current `ready` handling can warn that requested proof is missing after finalizing
the task. A recorded review can contain findings; it is not an independent clean
verdict. Treat these as coordination signals. Keep mechanically enforceable release
requirements in the project's native checks and verify the evidence before reporting
completion. This guide does not change Proof, Review or Merge settings or their code.

## Keep one current handoff

Use the existing task summary/details and proof artifact as an index, not another
copy of the whole release history. Link the project's canonical release record and
include only the information needed to continue:

- Accepted outcome, exclusions, owner and next action.
- Exact repository/base/target revisions and artifact identity where applicable.
- Native check/operation links, their outcomes, and the candidate they verified.
- Completed or uncertain external effects and the remaining acceptance boundary.

Before continuing, reconcile the record with actual source and native operations.
A receiving checkout may be older than the requested PR. A timeout after submission
does not mean an operation failed: inspect its native ID and resulting state before
retrying. A runtime failure must not replay an already-completed data migration.

Use the configured review owner and rounds. Keep findings and their dispositions
with the handoff; starting a replacement worker does not reset unresolved findings.
If the task includes deployment, verify the live result before describing that
outcome as complete, even when its PR is already merged and its board row is Done.
Do not create a second task or change lifecycle state solely to restate existing work.

## Shared method and validation

HolyCow owns the reusable engineering method. Its
[Build verification](https://github.com/NeuralHerd/holycow/blob/main/skills/hc-build/references/verification.md),
[production guidance](https://github.com/NeuralHerd/holycow/blob/main/skills/hc-build/references/production.md),
and [review coordination](https://github.com/NeuralHerd/holycow/blob/main/skills/hc-review/references/coordination.md)
apply when the corresponding skill is used. Keep repository-specific commands and
authority in that repository; do not copy every release rule into role templates.

The expanded delivery reference and evaluation cases are proposed in
[HolyCow PR #5](https://github.com/NeuralHerd/holycow/pull/5). That proposal is not
an installed dependency or evidence that the shared guidance has been accepted.

When evaluating these handoffs, use isolated fixtures without production access:
an older checkout beside a current PR, a review with an unresolved required finding,
a missing proof artifact, and an interrupted operation with completed or unknown
native status. Inspect actual commands and artifacts. Source/unit checks and reading
these instructions do not demonstrate live agent adherence or deployment success.

The method follows [DORA deployment automation](https://dora.dev/capabilities/deployment-automation/)
and [OpenAI skill evaluation](https://developers.openai.com/blog/eval-skills): reuse
native execution and verify observed outcomes. This documentation adds no runtime
gate, scheduler, credential, installation step or release authorization.
