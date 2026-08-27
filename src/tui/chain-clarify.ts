import {
  type Component,
  type Focusable,
  Input,
  isKeyRelease,
  Key,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import type { ChainStep, SequentialStep } from "../shared/types.js";
import type { Theme } from "./agent-widget.js";

export interface ChainClarifyResult {
  action: "run" | "cancel" | "bg";
  steps: ChainStep[];
}

type EditMode = "list" | "edit-task" | "edit-model";

/**
 * ChainClarifyComponent — shows a preview of chain steps and lets the user
 * edit them before execution.
 *
 * Key bindings (list mode):
 *   j / Down  — move selection down
 *   k / Up    — move selection up
 *   Enter     — run chain (action: "run")
 *   b         — run in background (action: "bg")
 *   Esc / q   — cancel (action: "cancel")
 *   e         — enter edit-task mode for selected step
 *   m         — enter edit-model mode for selected step
 *
 * Key bindings (edit modes):
 *   Enter     — confirm edit
 *   Esc       — cancel edit, return to list
 */
export class ChainClarifyComponent implements Component, Focusable {
  private input = new Input();
  private _focused = false;
  private selectedIndex = 0;
  private mode: EditMode = "list";
  private modelOverrides = new Map<number, string>();
  private taskOverrides = new Map<number, string>();

  constructor(
    private tui: TUI,
    private theme: Theme,
    private steps: ChainStep[],
    private done: (result: ChainClarifyResult) => void,
  ) {}

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (this.mode === "edit-task" || this.mode === "edit-model") {
      this.input.handleInput(data);
      if (this.mode === "edit-task" || this.mode === "edit-model") {
        this.tui.requestRender();
      }
      return;
    }
    this.handleListInput(data);
  }

  invalidate(): void {
    /* no cached state to clear */
  }

  dispose(): void {
    this.input.focused = false;
    this.input.onSubmit = undefined;
    this.input.onEscape = undefined;
  }

  render(width: number): string[] {
    if (this.mode === "edit-task" || this.mode === "edit-model") {
      return this.renderEditMode(width);
    }
    return this.renderListMode(width);
  }

  // ---------------------------------------------------------------------------
  // List mode
  // ---------------------------------------------------------------------------

  private handleListInput(data: string): void {
    const { steps } = this;
    if (matchesKey(data, Key.enter)) {
      this.done({ action: "run", steps: this.applyOverrides() });
    } else if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      this.done({ action: "cancel", steps: this.steps });
    } else if (matchesKey(data, "b")) {
      this.done({ action: "bg", steps: this.applyOverrides() });
    } else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.selectedIndex = Math.min(this.selectedIndex + 1, steps.length - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.tui.requestRender();
    } else if (matchesKey(data, "e")) {
      this.enterEditMode("edit-task");
    } else if (matchesKey(data, "m")) {
      this.enterEditMode("edit-model");
    }
  }

  private renderListMode(width: number): string[] {
    const th = this.theme;
    const lines: string[] = [];
    const header = `Chain Preview (${this.steps.length} step${this.steps.length === 1 ? "" : "s"})`;
    const hint = "[Enter] Run  [b] Background  [Esc] Cancel";
    lines.push(`${th.fg("accent", header)}  ${th.fg("dim", hint)}`);
    lines.push(th.fg("dim", "─".repeat(Math.min(width, 60))));

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      const cursor = i === this.selectedIndex ? ">" : " ";
      const isSeq = !("parallel" in step);

      if (isSeq) {
        const seq = step as SequentialStep;
        const taskText = this.taskOverrides.get(i) ?? seq.task ?? "(no task)";
        const modelText = this.modelOverrides.get(i) ?? seq.model ?? "(inherit)";
        const taskMarker = this.taskOverrides.has(i) ? "* " : "";
        const modelMarker = this.modelOverrides.has(i) ? "* " : "";
        lines.push(
          `  ${cursor} [${i + 1}] ${th.fg("accent", seq.agent ?? "?")}`,
        );
        lines.push(`        Task: ${taskMarker}${taskText}`);
        lines.push(`        Model: ${modelMarker}${modelText}`);
      } else {
        lines.push(`  ${cursor} [${i + 1}] ${th.fg("dim", "(parallel step)")}`);
      }
    }

    lines.push(th.fg("dim", "─".repeat(Math.min(width, 60))));
    lines.push(th.fg("dim", "[e] Edit task  [m] Model  [j/k] Navigate"));
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Edit mode
  // ---------------------------------------------------------------------------

  private enterEditMode(mode: "edit-task" | "edit-model"): void {
    const step = this.steps[this.selectedIndex];
    if (!step || "parallel" in step) return; // only for sequential steps
    const seq = step as SequentialStep;
    this.input.setValue(
      mode === "edit-task"
        ? (this.taskOverrides.get(this.selectedIndex) ?? seq.task ?? "")
        : (this.modelOverrides.get(this.selectedIndex) ?? seq.model ?? ""),
    );
    this.input.handleInput("\x1b[F");
    this.input.onSubmit = (value) => {
      if (this.mode === "edit-task") {
        this.taskOverrides.set(this.selectedIndex, value);
      } else {
        this.modelOverrides.set(this.selectedIndex, value);
      }
      this.mode = "list";
      this.tui.requestRender();
    };
    this.input.onEscape = () => {
      this.mode = "list";
      this.tui.requestRender();
    };
    this.mode = mode;
    this.tui.requestRender();
  }

  private renderEditMode(width: number): string[] {
    const th = this.theme;
    const label = this.mode === "edit-task" ? "Task" : "Model";
    return [
      `${th.fg("accent", `Edit ${label}`)}  ${th.fg("dim", "[Enter] Confirm  [Esc] Cancel")}`,
      ...this.input.render(width),
    ];
  }

  // ---------------------------------------------------------------------------
  // Apply overrides before returning steps
  // ---------------------------------------------------------------------------

  private applyOverrides(): ChainStep[] {
    return this.steps.map((step, i) => {
      if ("parallel" in step) return step;
      const seq = step as SequentialStep;
      const taskOverride = this.taskOverrides.get(i);
      const modelOverride = this.modelOverrides.get(i);
      if (taskOverride === undefined && modelOverride === undefined) return step;
      return {
        ...seq,
        ...(taskOverride !== undefined ? { task: taskOverride } : {}),
        ...(modelOverride !== undefined ? { model: modelOverride } : {}),
      };
    });
  }
}
