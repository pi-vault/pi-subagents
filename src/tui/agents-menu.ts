import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";
import type { AgentCatalogEntry } from "../core/agents.js";
import type {
  EditableSettingKey,
  SettingsScope,
  SubagentsSettings,
} from "../core/settings.js";
import type { RuntimeDeps } from "../shared/runtime-deps.js";
import type { AgentCreationInput } from "../shared/types.js";

type MenuChoice<T> = { label: string; value: T };

type MenuRow<T> = {
  label: string;
  detail?: string;
  value: T;
  kind?: "normal" | "back";
};

type SettingsMenuItem = {
  key: EditableSettingKey;
  label: string;
  promptTitle: string;
  formatValue: (settings: SubagentsSettings) => string;
  parse: (raw: string) => number | string | boolean | undefined;
};

export const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
  {
    key: "maxConcurrent",
    label: "Max Concurrency",
    promptTitle: "Max Concurrency",
    formatValue: (settings) => String(settings.maxConcurrent),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 1 && value <= 1024
        ? value
        : undefined;
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
  },
  {
    key: "maxSpawnsPerSession",
    label: "Max Spawns Per Session",
    promptTitle: "Max Spawns Per Session (0 = block all)",
    formatValue: (config) => String(config.maxSpawnsPerSession),
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 && value <= 10_000
        ? value
        : undefined;
    },
  },
  {
    key: "widgetMode",
    label: "Widget Mode",
    promptTitle: "Widget Mode (all / background / off)",
    formatValue: (settings) => settings.widgetMode,
    parse: (raw) => {
      const t = raw.trim();
      return t === "all" || t === "background" || t === "off" ? t : undefined;
    },
  },
  {
    key: "fleetView",
    label: "Fleet View",
    promptTitle: "Fleet View (true / false)",
    formatValue: (settings) => String(settings.fleetView),
    parse: (raw) => {
      const t = raw.trim().toLowerCase();
      return t === "true" ? true : t === "false" ? false : undefined;
    },
  },
];

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

async function showRowsMenu<T>(
  ctx: ExtensionCommandContext,
  title: string,
  rows: Array<MenuRow<T>>,
  footer?: string,
): Promise<T | undefined> {
  const renderedRows = buildAlignedRows(rows);

  if (!ctx.ui.custom) {
    if (ctx.ui.select) {
      const selectLabels = buildAlignedRows(rows);
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

export function describeAgentEntry(
  entry: AgentCatalogEntry,
): Pick<MenuRow<AgentCatalogEntry>, "label" | "detail"> {
  return {
    label: entry.name,
    detail: entry.state === "bundled" ? "[bundled]" : entry.state === "override" ? "[global override]" : "[disabled override]",
  };
}

async function promptForAgentName(
  ctx: ExtensionCommandContext,
  title: string,
): Promise<string | undefined> {
  return ctx.ui.input(title, "Scout");
}

function buildSettingsRows(
  settings: SubagentsSettings,
): Array<MenuRow<EditableSettingKey | "back">> {
  return [
    ...SETTINGS_MENU_ITEMS.map((item) => ({
      label: item.label,
      detail: item.formatValue(settings),
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

  const systemPrompt = await ctx.ui.editor("Agent markdown body", "");
  if (systemPrompt === undefined) {
    ctx.ui.notify("Agent creation cancelled", "info");
    return;
  }

  const input: AgentCreationInput = {
    name,
    filenameSlug,
    description,
    tools: tools ? tools.split(",").map((e) => e.trim()).filter(Boolean) : [],
    model,
    thinking,
    subagentAgents: subagentAgents ? subagentAgents.split(",").map((e) => e.trim()).filter(Boolean) : [],
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
  deps: RuntimeDeps,
  entry: AgentCatalogEntry,
): Promise<void> {
  const sourcePath = entry.override?.sourcePath;
  if (!sourcePath) {
    ctx.ui.notify(`No global override found for "${entry.name}"`, "warning");
    return;
  }

  try {
    const paths = deps.resolvePaths();
    const current = deps.readUserAgentOverride(paths, sourcePath);
    const edited = await ctx.ui.editor(`Edit ${entry.name}`, current);
    if (edited === undefined || edited === current) {
      return;
    }

    deps.updateUserAgentOverride(paths, sourcePath, edited);
    ctx.ui.notify(`Updated "${entry.name}" at ${sourcePath}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not save agent: ${message}`, "error");
  }
}

async function selectSettingsScope(
  ctx: ExtensionCommandContext,
  projectTrusted: boolean,
): Promise<SettingsScope | undefined> {
  return showRowsMenu(
    ctx,
    "Settings scope",
    [
      ...(projectTrusted
        ? [{ label: "Project", value: "project" as const }]
        : []),
      { label: "Global", value: "global" as const },
      { label: "Back", value: undefined, kind: "back" as const },
    ],
    projectTrusted
      ? "Choose where settings are stored"
      : "Project settings require a trusted project",
  );
}

export async function runAgentsMenuSettingsFlow(
  ctx: ExtensionCommandContext,
  deps: RuntimeDeps,
): Promise<void> {
  const projectTrusted = ctx.isProjectTrusted();
  const scope = await selectSettingsScope(ctx, projectTrusted);
  if (!scope) return;

  while (true) {
    const settings = deps.loadSettings(ctx.cwd, scope);
    const selected = await showRowsMenu(
      ctx,
      "Settings",
      buildSettingsRows(settings),
      "Select a setting to edit",
    );
    if (!selected || selected === "back") return;

    const item = SETTINGS_MENU_ITEMS.find((entry) => entry.key === selected);
    if (!item) return;

    const raw = await ctx.ui.input(item.promptTitle, item.formatValue(settings));
    if (raw === undefined) continue;

    const parsed = item.parse(raw);
    if (parsed === undefined) {
      ctx.ui.notify(
        "Settings not saved: all values must be positive numbers.",
        "error",
      );
      continue;
    }

    const saved = await deps.saveSetting(ctx.cwd, scope, item.key, parsed);
    if (!saved) {
      ctx.ui.notify(
        "Settings not saved: could not write subagents settings.",
        "error",
      );
      continue;
    }

    deps.refreshSettings(ctx.cwd, ctx.isProjectTrusted());
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
  entry: AgentCatalogEntry,
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
    await editOverrideAgent(ctx, deps, entry);
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
    const paths = deps.resolvePaths();
    const catalog = deps.discoverAgentCatalog(paths);
    const choice = await showRowsMenu(
      ctx,
      "Agents",
      [
        ...catalog.entries.map((entry) => ({
          ...describeAgentEntry(entry),
          value: entry,
        })),
        { label: "Back", value: undefined, kind: "back" },
      ],
      catalog.userDiagnostics.length > 0
        ? `${catalog.userDiagnostics.length} invalid user agent file(s) skipped`
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
    const paths = deps.resolvePaths();
    const catalog = deps.discoverAgentCatalog(paths);
    const choice = await showRowsMenu(
      ctx,
      "pi-subagents agents",
      [
        { label: `Agents (${catalog.entries.length})`, value: "agents" },
        { label: "Create new agent", value: "create" },
        { label: "Settings", value: "settings" },
      ],
      `${catalog.entries.length} visible agent(s) • ${paths.userAgentsDir}`,
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
