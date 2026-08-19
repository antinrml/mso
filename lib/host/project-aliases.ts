const PROJECT_ALIASES = [
  { alias: "os-vps", target: "mso" },
  { alias: "manef shell os", target: "mso" },
  { alias: "manef-shell-os", target: "mso" },
  { alias: "mso vps", target: "mso" },
] as const;

export function normalizeProjectKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function projectAliasTarget(value: string): string | undefined {
  const key = normalizeProjectKey(value);
  return PROJECT_ALIASES.find((row) => normalizeProjectKey(row.alias) === key)?.target;
}

export function projectAliasesFor(target: string): string[] {
  const key = normalizeProjectKey(target);
  return PROJECT_ALIASES.filter((row) => normalizeProjectKey(row.target) === key).map((row) => row.alias);
}
