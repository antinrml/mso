#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const repo = process.cwd();
const skillsRoot = path.resolve(repo, argValue("--root", "claude-skills"));
const templatePath = path.resolve(repo, argValue("--template", "templates/mso-skill-flow/SKILL.md.template"));
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const errors = [];
const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
};

const template = await fs.readFile(templatePath, "utf8").catch(() => "");
const templateTokens = [
  "{{NAME}}", "{{DESCRIPTION_YAML}}", "{{RISK}}", "{{POLICY}}", "{{TITLE}}",
  "{{USE_WHEN}}", "{{DO_NOT_USE}}", "{{REQUIRED_CONTEXT}}", "{{EXPECTED_STATE}}",
  "{{TARGETED_CHECKS}}", "{{RUNTIME_PROOF}}", "{{VISUAL_PROOF}}", "{{DIFF_BOUNDARY}}",
];
for (const token of templateTokens)
  if (!template.includes(token)) errors.push(`template is missing ${token}`);
for (const heading of ["## Trigger and boundaries", "## Fast route", "## Tool routing", "## Execution flow", "## Verification contract", "## Failure and rollback", "## Recipe memory"])
  if (!template.includes(heading)) errors.push(`template is missing heading: ${heading}`);

const entries = (await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
let checked = 0;
for (const entry of entries) {
  const file = path.join(skillsRoot, entry.name, "SKILL.md");
  const source = await fs.readFile(file, "utf8").catch(() => "");
  if (!source) continue;
  checked += 1;
  const parsed = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(source);
  if (!parsed) { errors.push(`${entry.name}: invalid or missing YAML frontmatter`); continue; }
  const [, frontmatter, body] = parsed;
  const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1];
  const nested = (name) => frontmatter.match(new RegExp(`^\\s{4}${name}:\\s*(.+)$`, "m"))?.[1];
  const name = field("name")?.trim();
  const description = field("description");
  const risk = nested("risk")?.trim();
  const policy = nested("policy")?.trim();
  if (name !== entry.name || !slug.test(name ?? "")) errors.push(`${entry.name}: frontmatter name must equal the kebab-case directory`);
  const plainDescription = description ? unquote(description) : "";
  if (plainDescription.length < 20 || plainDescription.length > 280) errors.push(`${entry.name}: description must be 20–280 characters`);
  if (!["low", "medium", "high"].includes(risk ?? "")) errors.push(`${entry.name}: metadata.mso.risk must be low, medium, or high`);
  if (!slug.test(policy ?? "")) errors.push(`${entry.name}: metadata.mso.policy must be kebab-case`);
  if (!body.includes(`# /${entry.name}`)) errors.push(`${entry.name}: H1 must begin with # /${entry.name}`);
  if (/{{[A-Z_]+}}/.test(source)) errors.push(`${entry.name}: unresolved template placeholder`);
  if (source.split("\n").length > 200) errors.push(`${entry.name}: exceeds the 200-line skill limit`);
}

if (!checked) errors.push(`no SKILL.md files found under ${skillsRoot}`);
if (errors.length) {
  console.error(errors.map((error) => `skill-flows: ${error}`).join("\n"));
  process.exit(1);
}
console.log(`skill-flows: ${checked} official skills valid; template ready`);
