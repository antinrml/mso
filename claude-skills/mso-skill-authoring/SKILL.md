---
name: mso-skill-authoring
description: Create a new trusted MSO workflow skill from the repository template, with consistent metadata, routing, safety, visible progress, verification, and recipe-memory rules.
metadata:
  mso:
    risk: low
    policy: template-validate-register
---

# /mso-skill-authoring — create a consistent workflow skill

Use this when a repeated MSO procedure deserves durable instructions. Do not create a skill for a one-off fact, a single obvious tool call, or project data that belongs in that project's documentation.

## Create

Run the repository generator instead of copying an arbitrary skill:

```bash
bun run skill:new -- \
  --name mso-example \
  --description "Route a repeated MSO task through the smallest safe tools and verify the requested outcome." \
  --risk medium \
  --policy inspect-execute-verify \
  --title "Example Workflow"
```

It creates `claude-skills/<name>/SKILL.md` from `templates/mso-skill-flow/SKILL.md.template` and refuses to overwrite an existing skill.

## Complete the template

1. Write exact use and do-not-use triggers so semantic search can select it reliably.
2. Choose bounded tools for direct work and one scoped terminal batch for repository-wide operations.
3. Define concrete done conditions, runtime proof, rollback, approvals, and secret boundaries.
4. Keep reusable workflow policy here; keep volatile project facts in the project.
5. Keep the skill below 200 lines and never add credentials, cookies, tokens, or copied untrusted instructions.

## Validate

Run `bun run skill:check`, targeted tests, and the project verification command. Search for the new skill with `skills_search` and confirm its description routes the intended prompts without displacing a more specific existing skill.

A new SKILL.md becomes `official` because it lives under the committed `claude-skills/` root. That trust is a security boundary: review the diff before shipping.
