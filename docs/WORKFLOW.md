# AI-Assisted Development Workflow

This document describes the methodology for working with AI agents on this project.

## Documentation Structure

### AGENTS.md
- **Purpose**: Project context for AI agents
- **Content**: Tech stack, code conventions, build/test/run commands
- **Auto-generated**: Run `/init` to create
- **When updated**: When project structure or conventions change

### PLAN.md
- **Purpose**: Current feature being implemented
- **Content**: Feature overview, task checklist, module tracking
- **Updated by**: Agent suggests updates, human reviews and approves
- **When updated**: At feature boundaries, task completions

### docs/module-plans/*.md
- **Purpose**: Detailed plans for each module (server-daemon, cli, web-ui)
- **Content**: Module overview, structure, interfaces, features list
- **Created by**: Agent creates template, fills in during development
- **When archived**: When module is complete → moved to `docs/archive/`

### docs/archive/*.md
- **Purpose**: Completed module plans for reference
- **Content**: Summary of implemented module, key features, decisions
- **Named**: `module-[name].md` (no dates)
- **When created**: When module is completed

### docs/archive/phase-plans/*.md
- **Purpose**: Completed phase plans for reference
- **Content**: Phase-specific implementation details, task lists, decisions
- **When created**: When each phase is completed

## Agent Mode Usage

### Plan Mode (Tab key)
- **Purpose**: Analyze and create plans without making changes
- **When to use**: Starting new features, major changes
- **Output**: Suggested updates to PLAN.md, task breakdowns
- **Constraint**: Read-only, asks before running bash commands

### Build Mode (Tab key)
- **Purpose**: Full development work with all tools enabled
- **When to use**: Implementing approved plans, making changes
- **Output**: Code implementation, file updates, tests
- **Permissions**: Full access to file edits, bash commands

## Feature Development Workflow

### Step 1: Plan a Feature
1. Human requests: "Plan out [feature name]"
2. Agent (Plan Mode):
   - Suggests which module this belongs to
   - Human agrees or clarifies
   - Agent references module plan: `@docs/module-plans/[module].md`
   - Agent generates task breakdown in PLAN.md
3. Human reviews and approves
4. Switch to Build Mode

### Step 2: Implement Feature
1. Agent works through tasks in PLAN.md sequentially
2. Each task completion: Update checkbox status in PLAN.md
3. Feature complete: Move to next feature, update PLAN.md
4. At end of feature, document decisions in module plan

### Step 3: Complete Module
1. All features in module complete
2. Agent suggests: Archive module plan to `docs/archive/module-[name].md`
3. Human reviews and approves
4. Agent archives file, updates PLAN.md with next module

## Phase Planning

### Phase Plan Files
- **Location**: `docs/phase-plans/[phase-name].md`
- **Purpose**: Detailed task breakdown for individual phases within a feature
- **Content**:
  - Phase-specific architecture decisions
  - Detailed task list with checkboxes
  - Implementation order
  - Files to create/modify
  - Dependencies between tasks
- **Lifecycle**: Created before phase implementation, archived when phase complete
- **Commit**: Commit archived file along with phase implementation
- **Archive location**: Move completed phase plans to `docs/archive/phase-plans/[phase-name].md`

### Feature Phase Tracking
- Each feature plan should include "Current Phase" section with:
  - Link to active phase plan file: `@docs/phase-plans/[phase-name].md`
  - Phase status (pending, in_progress, completed)
- Update phase status as work progresses
- Remove phase link after completion

## File References

- `@AGENTS.md` - Project context, tech stack, conventions
- `@docs/PLAN.md` - Current feature and task list
- `@docs/module-plans/[name].md` - Detailed module documentation
- `@docs/archive/module-[name].md` - Completed modules

# Agent Protocols

### Documentation Updates
- Agent suggests updates → Human reviews → Agent applies
- Commit after each feature completion
- Archive completed modules with summary

### Phase Completion Workflow
- **After every phase implementation**: All plan files must be checked and updated as needed
  - Update `docs/feature-plans/[feature-name].md` with phase status changes
  - Update `docs/PLAN.md` with current phase and completed phases
  - Add any new learnings, decisions, or architectural changes to relevant docs
  - Commit documentation updates along with phase implementation
- **Before starting next phase**: Verify all documentation is in sync with actual implementation
