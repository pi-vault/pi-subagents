---
name: implement
description: Scout the codebase, plan the implementation, then execute
---

## scout

phase: Context
label: Explore the codebase
as: context
output: context.md

Analyze the codebase relevant to {task}. Map key files, patterns, and dependencies.

## planner

phase: Planning
label: Create implementation plan
as: plan
reads: context.md
progress: true

Based on {outputs.context}, create a detailed step-by-step implementation plan for {task}.

## worker

phase: Implementation
label: Execute the plan
reads: context.md
progress: true

Implement the following plan:

{outputs.plan}
