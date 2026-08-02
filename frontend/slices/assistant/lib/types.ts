// Shared types for the Alfa assistant slice. Agents own skills; an agent's
// effective tools are the union of its skills' tools (or every tool when it is
// a generalist). Automations are ordered tool steps run as one click.
// Only groups that have EXECUTABLE tools behind them. rendering/media/editor/
// browser/settings/video were removed with the 44 descriptors that described
// capabilities the model could never call.
export type ToolGroup = "files" | "apps" | "system" | "terminal" | "agent";

export type Tool = {
  id: string;
  group: ToolGroup;
  name: string;
  desc: string;
  params: string[];
};

export type Skill = {
  id: string;
  builtin?: boolean;
  name: string;
  glyph: string;
  color: string;
  instructions: string;
  tools: string[];
  starters: string[];
};

export type Agent = {
  id: string;
  builtin?: boolean;
  name: string;
  glyph: string;
  color: string;
  persona: string;
  allTools: boolean;
  skills: string[];
};

export type AutomationStep = { tool: string; argText: string; id?: string };

export type Automation = {
  id: string;
  builtin?: boolean;
  name: string;
  glyph: string;
  color: string;
  agentId: string;
  steps: AutomationStep[];
};
