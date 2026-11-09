# Tempo

Tempo is a privacy-first daily execution cockpit. It turns an overloaded backlog into three realistic outcomes, keeps a focused work session visible, and closes the loop with a lightweight daily review.

## Why

Knowledge workers often have tasks scattered across notes and tools, then spend more time reprioritizing than executing. Existing project managers optimize for teams and reporting. Tempo optimizes for one person's next useful action.

### Users

- **Independent builders** capture work quickly, select today's outcomes, and focus without maintaining a complex board.
- **Students** turn assignments into a realistic day and use timed focus blocks.
- **Busy professionals** separate an unbounded backlog from a deliberately small daily commitment.

### Value proposition

Tempo makes the constraint visible: only three tasks can become today's outcomes. Its unfair advantage is an immediate, private, zero-account workflow that works from the first page load.

### KPIs

1. A first-time user creates and plans a task in under 60 seconds and at most three interactions.
2. Largest Contentful Paint remains under 2.5 seconds on a mid-tier mobile connection.
3. At least 60% of planned outcomes are completed or consciously rescheduled within 24 hours.

## Scope

| Area | Must have | Should have | Could have | Won't have in MVP |
|---|---|---|---|---|
| Core | Task capture, three-outcome plan, status transitions, focus timer, review stats | Recurring tasks, import/export | Energy-based suggestions | Team projects, dependencies |
| UX | Responsive dashboard, keyboard shortcuts, empty states, accessible dialogs | Themes, richer charts | Drag-and-drop | Native mobile apps |
| Security | Local-only data, CSP, input limits, safe DOM rendering | Encrypted export | App lock | OAuth, billing |
| Integrations | JSON backup | Calendar export | Browser notifications | Calendar write access, Slack |

The v1.1 features were cut because recurrence and integrations introduce scheduling edge cases and permission surfaces, while the MVP's highest-risk assumption is whether the three-outcome constraint improves follow-through. Drag-and-drop and charts are polish with lower impact than reliable keyboard and mobile flows.

## Architecture

Tempo is a **modular local-first monolith** delivered as a Cloudflare-compatible ES module Worker. The Worker serves the application shell and operational API endpoints; the browser owns task records in `localStorage`, so no account or remote database is required. Client modules are separated by responsibility: repository, domain rules, renderer, timer, and event controller.

- Frontend: semantic HTML, modern CSS, dependency-free JavaScript.
- Backend: Cloudflare Worker-compatible Fetch API.
- Storage: browser `localStorage` for MVP; `docs/schema.sql` is the planned multi-device upgrade path.
- Cache/queue: not required for the synchronous device-local MVP.
- Security: strict CSP/security headers, no third-party scripts, bounded inputs, safe DOM rendering.

### Domain model

- `Task`: id, title, notes, priority, estimate, status, planned date, timestamps.
- `FocusSession`: id, task id, planned/actual minutes, completion state, timestamps.
- `DailyReview`: date, mood, note, completed count.
- Value objects: `TaskTitle`, `Minutes`, `Priority`, `LocalDate`.
- Events: `TaskCaptured`, `TaskPlanned`, `TaskCompleted`, `FocusSessionFinished`, `DailyReviewSaved`.
- Task state machine: `backlog -> planned -> in_progress -> completed`; planned/in-progress tasks can return to backlog.

## Critical journey

1. Capture a task from the command bar.
2. Open the backlog and add up to three tasks to Today.
3. Start a focus block from an outcome.
4. Pause/resume or finish the session, then complete the task.
5. Review today's completion rate and save a short reflection.

## HTTP contract

| Method | Route | Success | Errors |
|---|---|---|---|
| GET | `/` | `200 text/html` | `500` problem JSON |
| GET | `/api/health` | `200 { status, service, version, timestamp }` | `500` problem JSON |
| GET | `/api/meta` | `200 { product, limits, storage }` | `500` problem JSON |
| Any | unknown `/api/*` | — | `404` problem JSON |

Errors use problem details: `{ type, title, status, detail, instance, traceId }`. State changes are client-side domain commands in this local-first release. A future synced release maps them to `POST /api/tasks`, `PATCH /api/tasks/:id`, and `POST /api/focus-sessions` without changing the domain.

## UI hierarchy and state

`AppShell` contains `Sidebar`, `CommandBar`, `TodayOutcomes`, `ProgressCard`, `Backlog`, `FocusDock`, and modal forms. The shell is server-rendered by the Worker; the client hydrates once, loads a versioned local snapshot, and rerenders bounded dashboard regions after domain commands.

## Run and verify

```bash
npm test
npm run build
npm run validate
```

No environment variables are required.

## Delivery status

- Sprint 1: repository, hosting manifest, schema, storage adapter — complete.
- Sprint 2: domain rules, validation, error format, operational APIs — complete.
- Sprint 3: responsive dashboard, state flow, forms, timer, accessibility — complete.
- Sprint 4: CSP/security headers, tests, deterministic build — complete.
