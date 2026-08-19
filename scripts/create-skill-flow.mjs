#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag) => args.includes(flag);
const fail = (message) => { console.error(`skill:new: ${message}`); process.exit(1); };
const usage = () => console.log(`Usage:
  bun run skill:new -- --name <slug> --description <text> [options]

Options:
  --title <heading>       Human title; defaults from the slug
  --risk low|medium|high  Default: medium
  --policy <slug>         Default: inspect-execute-verify
  --root <directory>      Default: claude-skills
`);

if (has("--help") || has("-h")) { usage(); process.exit(0); }
const name = value("--name")?.trim();
const description = value("--description")?.trim();
const risk = value("--risk")?.trim() ?? "medium";
const policy = value("--policy")?.trim() ?? "inspect-execute-verify";
const root = value("--root")?.trim() ?? "claude-skills";
const title = value("--title")?.trim() ?? name?.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");

if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail("--name must be a lowercase kebab-case slug");
if (!description || description.length < 20 || description.length > 280 || /[\r\n]/.test(description))
  fail("--description must be one line and 20–280 characters");
if (!["low", "medium", "high"].includes(risk)) fail("--risk must be low, medium, or high");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy)) fail("--policy must be a lowercase kebab-case slug");
if (!title || /[\r\n]/.test(title)) fail("--title must be one line");

const repo = process.cwd();
const templatePath = path.join(repo, "templates/mso-skill-flow/SKILL.md.template");
const targetDir = path.resolve(repo, root, name);
const target = path.join(targetDir, "SKILL.md");
const template = await fs.readFile(templatePath, "utf8").catch(() => fail(`missing template: ${templatePath}`));
const content = template
  .replaceAll("{{NAME}}", name)
  .replaceAll("{{DESCRIPTION_YAML}}", JSON.stringify(description))
  .replaceAll("{{RISK}}", risk)
  .replaceAll("{{POLICY}}", policy)
  .replaceAll("{{TITLE}}", title);

await fs.mkdir(targetDir, { recursive: true });
await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch((error) => {
  if (error?.code === "EEXIST") fail(`${target} already exists; edit it intentionally instead of regenerating`);
  throw error;
});
console.log(`skill:new: created ${path.relative(repo, target)}`);
console.log("next: replace every {{GUIDANCE_PLACEHOLDER}}; skill:check intentionally fails until the workflow is specific");
console.log("then run `bun run skill:check`, targeted tests, and project verification");
