import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";
import { parseAgentContent as parseAgentFile } from "../core/agent-format.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type {
  AgentCreationInput,
  AgentDefinition,
  AgentDiscoveryDiagnostic,
  ResolvedPaths,
  SubagentsConfig,
} from "../shared/types.js";

type MenuChoice<T> = { label: string; value: T };

type MenuRow<T> = {
  label: string;
  detail?: string;
  value: T;
  kind?: "normal" | "back";
};

type SettingsKey =
  | "maxConcurrency"
  | "maxRecursiveLevel"
  | "defaultMaxTurns"
  | "graceTurns"
  | "defaultJoinMode";

type SettingsMenuItem = {
  key: SettingsKey;
  label: string;
  promptTitle: string;
  formatValue: (config: SubagentsConfig) => string;
  parse: (raw: string) => number | string | undefined;
  apply?: (value: number | string, deps: RuntimeDeps) => void;
};

export const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
  {
    key: "maxConcurrency",
    label: "Max Concurrency",
    promptTitle: "Max Concurrency",
    formatValue: (config) => String(config.maxConcurrency),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    },
    apply: (value, deps) => {
      deps.manager.setMaxConcurrent(value as number);
    },
  },
  {
    key: "maxRecursiveLevel",
    label: "Max Recursive Level",
    promptTitle: "Max Recursive Level",
    formatValue: (config) => String(config.maxRecursiveLevel),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? value : undefined;
    },
  },
  {
    key: "defaultMaxTurns",
    label: "Default Max Turns",
    promptTitle: "Default Max Turns (0 = unlimited)",
    formatValue: (config) =>
      config.defaultMaxTurns === 0
        ? "0 (unlimited)"
        : String(config.defaultMaxTurns),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
  },
  {
    key: "graceTurns",
    label: "Grace Turns",
    promptTitle: "Grace Turns (extra turns after soft limit)",
    formatValue: (config) => String(config.graceTurns),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    },
  },
  {
    key: "defaultJoinMode",
    label: "Default Join Mode",
    promptTitle: "Default Join Mode (async, group, smart)",
    formatValue: (config) => config.defaultJoinMode,
    parse: (raw) => {
      const trimmed = raw.trim();
      return trimmed === "async" || trimmed === "group" || trimmed === "smart"
        ? trimmed
        : undefined;
    },
    apply: (value, deps) => {
      if (deps.defaultJoinMode !== undefined) {
        deps.defaultJoinMode = value as "async" | "group" | "smart";
      }
    },
  },
];

type AgentMenuEntry = {
  name: string;
  state: "bundled" | "override" | "disabled";
  bundled?: AgentDefinition;
  override?: AgentDefinition;
  diagnostic?: AgentDiscoveryDiagnostic;
};

function parseCommaSeparatedList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function renderRow(theme: Theme, label: string, selected: boolean): string {
  if (selected) {
    const arrow = theme.fg("accent", "▸");
    const text = theme.fg("accent", theme.bold(label));
    return `${arrow} ${text}`;
  }
  return `  ${theme.fg("dim", label)}`;
}

export function buildAlignedRows<T>(rows: Array<MenuRow<T>>): string[] {
  const labelWidth = rows.reduce((max, row) => {
    if (row.kind === "back" || !row.detail) {
      return max;
    }
    return Math.max(max, row.label.length);
  }, 0);

  return rows.map((row) => {
    if (!row.detail) {
      return row.label;
    }
    return `${row.label.padEnd(labelWidth)}  ${row.detail}`;
  });
}

function buildSelectLabels<T>(rows: Array<MenuRow<T>>): string[] {
  return buildAlignedRows(rows);
}

async function showRowsMenu<T>(
  ctx: ExtensionCommandContext,
  title: string,
  rows: Array<MenuRow<T>>,
  footer?: string,
): Promise<T | undefined> {
  const renderedRows = buildAlignedRows(rows);

  if (!ctx.ui.custom) {
    if (ctx.ui.select) {
      const selectLabels = buildSelectLabels(rows);
      const selectedLabel = await ctx.ui.select(title, selectLabels);
      if (selectedLabel === undefined) {
        return undefined;
      }
      const index = selectLabels.indexOf(selectedLabel);
      return index >= 0 ? rows[index]?.value : undefined;
    }
    if (footer) {
      ctx.ui.notify(footer, "info");
    }
    return undefined;
  }

  let selectedIndex = 0;
  let selectedValue: T | undefined;

  await ctx.ui.custom((tui, theme, _kb, done) => ({
    render(width: number) {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
      container.addChild(new Text("", 0, 0));
      for (const [index, row] of renderedRows.entries()) {
        container.addChild(
          new Text(renderRow(theme, row, index === selectedIndex), 0, 0),
        );
      }
      if (footer) {
        container.addChild(new Text("", 0, 0));
        container.addChild(new Text(theme.fg("dim", footer), 0, 0));
      }
      return container.render(width);
    },
    invalidate() {},
    handleInput(data: string) {
      if (matchesKey(data, "up")) {
        selectedIndex = Math.max(0, selectedIndex - 1);
        tui.requestRender();
        return;
      }
      if (matchesKey(data, "down")) {
        selectedIndex = Math.min(rows.length - 1, selectedIndex + 1);
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        selectedValue = rows[selectedIndex]?.value;
        done(undefined);
        return;
      }
      if (matchesKey(data, Key.escape)) {
        done(undefined);
      }
    },
  }));

  return selectedValue;
}

function readAgentFiles(directory: string): {
  agents: AgentDefinition[];
  diagnostics: AgentDiscoveryDiagnostic[];
} {
  if (!existsSync(directory)) {
    return { agents: [], diagnostics: [] };
  }

  const agents: AgentDefinition[] = [];
  const diagnostics: AgentDiscoveryDiagnostic[] = [];
  const fileNames = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fileNames) {
    const filePath = join(directory, fileName);
    const parsed = parseAgentFile(filePath, readFileSync(filePath, "utf8"));
    if (parsed.ok) {
      agents.push(parsed.agent);
    } else {
      diagnostics.push(parsed.diagnostic);
    }
  }

  return { agents, diagnostics };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function buildAgentMenuEntries(paths: ResolvedPaths): AgentMenuEntry[] {
  const bundled = readAgentFiles(paths.bundledAgentsDir);
  const user = readAgentFiles(paths.userAgentsDir);
  const bundledByName = new Map(
    bundled.agents.map((agent) => [normalizeName(agent.name), agent]),
  );
  const userByName = new Map(
    user.agents.map((agent) => [normalizeName(agent.name), agent]),
  );

  const names = new Set<string>([
    ...bundledByName.keys(),
    ...userByName.keys(),
  ]);

  return [...names]
    .sort((left, right) => left.localeCompare(right))
    .map((normalizedName) => {
      const bundledAgent = bundledByName.get(normalizedName);
      const overrideAgent = userByName.get(normalizedName);
      if (overrideAgent?.enabled === false) {
        return {
          name: overrideAgent.name,
          state: "disabled",
          bundled: bundledAgent,
          override: overrideAgent,
        };
      }
      if (overrideAgent) {
        return {
          name: overrideAgent.name,
          state: "override",
          bundled: bundledAgent,
          override: overrideAgent,
        };
      }
      return {
        name: bundledAgent?.name ?? normalizedName,
        state: "bundled",
        bundled: bundledAgent,
      };
    });
}

function statusLabelForEntry(entry: AgentMenuEntry): string {
  if (entry.state === "bundled") {
    return "[bundled]";
  }
  if (entry.state === "override") {
    return "[global override]";
  }
  return "[disabled override]";
}

export function describeAgentEntry(
  entry: AgentMenuEntry,
): Pick<MenuRow<AgentMenuEntry>, "label" | "detail"> {
  return {
    label: entry.name,
    detail: statusLabelForEntry(entry),
  };
}

async function promptForAgentName(
  ctx: ExtensionCommandContext,
  title: string,
): Promise<string | undefined> {
  return ctx.ui.input(title, "Scout");
}

function buildSettingsRows(
  config: SubagentsConfig,
): Array<MenuRow<SettingsKey | "back">> {
  return [
    ...SETTINGS_MENU_ITEMS.map((item) => ({
      label: item.label,
      detail: item.formatValue(config),
      value: item.key,
    })),
    { label: "Back", value: "back", kind: "back" },
  ];
}

async function runCreateAgentFlow(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  const paths = deps.resolvePaths();
  const discovery = deps.discoverAgents(paths);
  const toolNames = deps.discoverToolNames();

  const name = await ctx.ui.input("Agent name (optional)", "planner");
  if (name === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  let filenameSlug: string | undefined;
  if (!name.trim()) {
    filenameSlug = await ctx.ui.input("Filename slug", "planner");
    if (filenameSlug === undefined) {
      ctx.ui.notify("Agent creation cancelled", "info");
      return;
    }
  }

  const description = await ctx.ui.input(
    "Description",
    "Brief agent description",
  );
  if (description === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const tools = await ctx.ui.input(
    `Tools (comma-separated) [${toolNames.join(", ")}]`,
    "read, bash",
  );
  if (tools === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const model = await ctx.ui.input("Model (optional)", "provider/model");
  if (model === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const thinking = await ctx.ui.input(
    "Thinking (optional)",
    "low | medium | high",
  );
  if (thinking === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const subagentAgents = await ctx.ui.input(
    `Child allowlist (optional) [${
      discovery.agents.map((agent) => agent.name).join(", ") || "none"
    }]`,
    "worker, researcher",
  );
  if (subagentAgents === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const timeoutInput = await ctx.ui.input("Timeout ms (optional)", "180000");
  if (timeoutInput === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const systemPrompt = await ctx.ui.editor("Agent markdown body", "");
  if (systemPrompt === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const input: AgentCreationInput = {
    name,
    filenameSlug,
    description,
    tools: parseCommaSeparatedList(tools),
    model,
    thinking,
    subagentAgents: parseCommaSeparatedList(subagentAgents),
    timeoutMs: timeoutInput.trim() ? Number(timeoutInput) : undefined,
    systemPrompt,
  };

  try {
    const agent = deps.createAgentFile(paths, input, discovery, toolNames);
    ctx.ui.notify(`Created agent "${agent.name}" at ${agent.sourcePath}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not create agent: ${message}`, "error");
  }
}

async function editOverrideAgent(
  ctx: ExtensionCommandContext,
  entry: AgentMenuEntry,
): Promise<void> {
  const sourcePath = entry.override?.sourcePath;
  if (!sourcePath) {
    ctx.ui.notify(`No global override found for "${entry.name}"`, "warning");
    return;
  }

  const current = readFileSync(sourcePath, "utf8");
  const edited = await ctx.ui.editor(`Edit ${entry.name}`, current);
  if (edited === undefined || edited === current) {
    return;
  }

  const parsed = parseAgentFile(sourcePath, edited);
  if (!parsed.ok) {
    ctx.ui.notify(`Could not save agent: ${parsed.diagnostic.reason}`, "error");
    return;
  }

  writeFileSync(sourcePath, edited, "utf8");
  ctx.ui.notify(`Updated "${entry.name}" at ${sourcePath}`, "info");
}

export async function runAgentsMenuSettingsFlow(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  const paths = deps.resolvePaths();

  while (true) {
    const { config } = deps.loadConfig(paths);
    const selected = await showRowsMenu(
      ctx,
      "Settings",
      buildSettingsRows(config),
      "Select a setting to edit",
    );

    if (!selected || selected === "back") {
      return;
    }

    const item = SETTINGS_MENU_ITEMS.find((entry) => entry.key === selected);
    if (!item) {
      return;
    }

    const raw = await ctx.ui.input(item.promptTitle, item.formatValue(config));
    if (raw === undefined) {
      continue;
    }

    const parsed = item.parse(raw);
    if (parsed === undefined) {
      ctx.ui.notify(
        "Settings not saved: all values must be positive numbers.",
        "error",
      );
      continue;
    }

    deps.saveConfig(paths, {
      ...config,
      [item.key]: parsed,
    } as SubagentsConfig);
    item.apply?.(parsed, deps);
    ctx.ui.notify("Updated subagents settings", "info");
  }
}

export async function runAgentsMenuAction(
  action:
    | { kind: "create-agent" }
    | { kind: "export-agent"; agentName?: string }
    | { kind: "disable-agent"; agentName?: string }
    | { kind: "delete-override"; agentName?: string }
    | { kind: "open-settings" },
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  const paths = deps.resolvePaths();

  if (action.kind === "create-agent") {
    await runCreateAgentFlow(ctx, deps);
    return;
  }

  if (action.kind === "open-settings") {
    await runAgentsMenuSettingsFlow(ctx, deps);
    return;
  }

  if (action.kind === "delete-override") {
    const agentName =
      action.agentName ??
      (await promptForAgentName(ctx, "Delete override for agent"));
    if (!agentName) {
      return;
    }
    try {
      deps.deleteUserAgentOverride(paths, agentName);
      ctx.ui.notify(`Deleted global override for "${agentName}"`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not delete override: ${message}`, "error");
    }
    return;
  }

  const discovery = deps.discoverAgents(paths);
  const agentName =
    action.agentName ??
    (await promptForAgentName(
      ctx,
      action.kind === "export-agent"
        ? "Export bundled agent"
        : "Disable agent",
    ));
  if (!agentName) {
    return;
  }

  if (action.kind === "export-agent") {
    try {
      const agent = deps.exportAgentToUserScope(paths, discovery, agentName);
      ctx.ui.notify(`Exported "${agent.name}" to ${agent.sourcePath}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not export agent: ${message}`, "error");
    }
    return;
  }

  try {
    const agent = deps.disableAgentInUserScope(paths, discovery, agentName);
    ctx.ui.notify(`Disabled "${agent.name}" via global override`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not disable agent: ${message}`, "error");
  }
}

async function showAgentActions(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
  entry: AgentMenuEntry,
): Promise<void> {
  const items: Array<MenuChoice<string>> =
    entry.state === "bundled"
      ? [
          { label: "Export to global", value: "export" },
          { label: "Disable", value: "disable" },
          { label: "Back", value: "back" },
        ]
      : entry.state === "override"
        ? [
            { label: "Edit", value: "edit" },
            { label: "Disable", value: "disable" },
            { label: "Delete override", value: "delete" },
            { label: "Back", value: "back" },
          ]
        : [
            { label: "Delete override", value: "delete" },
            { label: "Back", value: "back" },
          ];

  const choice = await showRowsMenu(
    ctx,
    entry.name,
    items,
    entry.override?.sourcePath ?? entry.bundled?.sourcePath,
  );

  if (!choice || choice === "back") {
    return;
  }

  if (choice === "edit") {
    await editOverrideAgent(ctx, entry);
    return;
  }
  if (choice === "export") {
    await runAgentsMenuAction(
      { kind: "export-agent", agentName: entry.name },
      ctx,
      deps,
    );
    return;
  }
  if (choice === "disable") {
    await runAgentsMenuAction(
      { kind: "disable-agent", agentName: entry.name },
      ctx,
      deps,
    );
    return;
  }
  if (choice === "delete") {
    await runAgentsMenuAction(
      { kind: "delete-override", agentName: entry.name },
      ctx,
      deps,
    );
  }
}

async function showAgentsBrowser(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  while (true) {
    const entries = buildAgentMenuEntries(deps.resolvePaths());
    const diagnostics = readAgentFiles(deps.resolvePaths().userAgentsDir).diagnostics;
    const choice = await showRowsMenu(
      ctx,
      "Agents",
      [
        ...entries.map((entry) => ({
          ...describeAgentEntry(entry),
          value: entry,
        })),
        { label: "Back", value: undefined, kind: "back" },
      ],
      diagnostics.length > 0
        ? `${diagnostics.length} invalid user agent file(s) skipped`
        : "↑/↓ move • Enter select • Esc close",
    );

    if (!choice) {
      return;
    }

    await showAgentActions(ctx, deps, choice);
  }
}

export async function showAgentsMenu(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  while (true) {
    const entries = buildAgentMenuEntries(deps.resolvePaths());
    const choice = await showRowsMenu(
      ctx,
      "pi-subagents agents",
      [
        { label: `Agents (${entries.length})`, value: "agents" },
        { label: "Create new agent", value: "create" },
        { label: "Settings", value: "settings" },
      ],
      `${entries.length} visible agent(s) • ${deps.resolvePaths().userAgentsDir}`,
    );

    if (!choice) {
      return;
    }

    if (choice === "agents") {
      await showAgentsBrowser(ctx, deps);
      continue;
    }
    if (choice === "create") {
      await runAgentsMenuAction({ kind: "create-agent" }, ctx, deps);
      continue;
    }
    if (choice === "settings") {
      await runAgentsMenuAction({ kind: "open-settings" }, ctx, deps);
    }
  }
}
