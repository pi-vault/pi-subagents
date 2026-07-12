import type { Component, TUI } from "@earendil-works/pi-tui";
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
export class ChainClarifyComponent implements Component {
  private selectedIndex = 0;
  private mode: EditMode = "list";
  private editBuffer = "";
  private modelOverrides = new Map<number, string>();
  private taskOverrides = new Map<number, string>();

  constructor(
    private tui: TUI,
    private theme: Theme,
    private steps: ChainStep[],
    private done: (result: ChainClarifyResult) => void,
  ) {}

  handleInput(data: string): void {
    if (this.mode === "edit-task" || this.mode === "edit-model") {
      this.handleEditInput(data);
      return;
    }
    this.handleListInput(data);
  }

  invalidate(): void {
    /* no cached state to clear */
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
    switch (data) {
      case "\r":
      case "\n":
        this.done({ action: "run", steps: this.applyOverrides() });
        break;
      case "\x1b":
      case "q":
        this.done({ action: "cancel", steps: this.steps });
        break;
      case "b":
        this.done({ action: "bg", steps: this.applyOverrides() });
        break;
      case "j":
      case "\x1b[B": // Down arrow
        this.selectedIndex = Math.min(this.selectedIndex + 1, steps.length - 1);
        this.tui.requestRender();
        break;
      case "k":
      case "\x1b[A": // Up arrow
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.tui.requestRender();
        break;
      case "e":
        this.enterEditMode("edit-task");
        break;
      case "m":
        this.enterEditMode("edit-model");
        break;
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
    if (mode === "edit-task") {
      this.editBuffer = this.taskOverrides.get(this.selectedIndex) ?? seq.task ?? "";
    } else {
      this.editBuffer = this.modelOverrides.get(this.selectedIndex) ?? seq.model ?? "";
    }
    this.mode = mode;
    this.tui.requestRender();
  }

  private handleEditInput(data: string): void {
    switch (data) {
      case "\r":
      case "\n":
        if (this.mode === "edit-task") {
          this.taskOverrides.set(this.selectedIndex, this.editBuffer);
        } else {
          this.modelOverrides.set(this.selectedIndex, this.editBuffer);
        }
        this.mode = "list";
        this.tui.requestRender();
        break;
      case "\x1b":
        this.mode = "list";
        this.tui.requestRender();
        break;
      case "\x7f": // Backspace
      case "\b":
        this.editBuffer = this.editBuffer.slice(0, -1);
        this.tui.requestRender();
        break;
      default:
        if (data.length === 1 && data >= " ") {
          this.editBuffer += data;
          this.tui.requestRender();
        }
    }
  }

  private renderEditMode(width: number): string[] {
    const th = this.theme;
    const label = this.mode === "edit-task" ? "Task" : "Model";
    const maxBuf = Math.max(width - 4, 10);
    const display =
      this.editBuffer.length > maxBuf
        ? `…${this.editBuffer.slice(-(maxBuf - 1))}`
        : this.editBuffer;
    return [
      `${th.fg("accent", `Edit ${label}`)}  ${th.fg("dim", "[Enter] Confirm  [Esc] Cancel")}`,
      `> ${display}_`,
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
