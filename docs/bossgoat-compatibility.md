# BossGoat compatibility checks

Run `bin/check-bossgoat` after merging upstream changes. The **BossGoat compatibility** workflow runs the same check on every pull request and push to `main`, including upstream merges.

It exercises Cursor startup and delayed conversation discovery, prompt-wrapper parsing, HolyCow skill routing and missing-skill failures, Assistant-to-task permissions, task launch previews, BossGoat settings, and update recovery. It also checks that generated shared modules match their sources. The normal **Check** workflow remains the full build and test suite.

Wait for both workflows to pass before treating an upstream update as verified. This workflow reports failures; making it a required merge check is a separate repository-rule setting.

## Task launch preview

Open a task that has not started in **Tasks → Chat**. The preview shows its current skill, agent, model and permissions, including the live Assistant's inherited permissions. Missing worker or reviewer skills appear before launch. A scheduled task’s **Review and start** menu opens this preview too. **Check again** refreshes the preview; **Start task** uses the normal task queue and validates the skill again. Scheduled and Assistant-started tasks continue to start automatically. The same read-only preview is available as `herdr-task preview <id> --json` on the task's machine.

## Update status

**Settings → Updates** shows installed and repository versions and revisions. A pull only changes the checkout: **Apply downloaded changes** runs the installer when its files differ. Local edits are shown and must be committed or stashed before updating. Files deliberately preserved by the installer are reported as customizations; an unchanged `.new` copy does not trigger the same update repeatedly. Older installation records without a revision say so until the next installation. Reopen BossGoat after installation to load updated panels.
