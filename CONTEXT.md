# Pi Subagents Context

This context names the concepts used by the Pi subagents extension.

## Language

**Agent**:
A configured delegated worker with a prompt, tool policy, and execution record.
_Avoid_: worker when referring to the domain concept

**Chain**:
A declared sequence or parallel group of Agent invocations whose outputs can feed later steps.
_Avoid_: pipeline when referring to the domain concept

**Watchdog**:
An optional review Agent that inspects an ended Agent's changes or conversation and may request fixes.
_Avoid_: reviewer when referring to the domain concept
