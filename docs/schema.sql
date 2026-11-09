-- Planned relational schema for Tempo's multi-device sync release.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  estimate_minutes INTEGER NOT NULL CHECK (estimate_minutes BETWEEN 5 AND 480),
  status TEXT NOT NULL CHECK (status IN ('backlog', 'planned', 'in_progress', 'completed')),
  planned_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_planned_date ON tasks(user_id, planned_date);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes BETWEEN 5 AND 180),
  actual_seconds INTEGER NOT NULL DEFAULT 0 CHECK (actual_seconds >= 0),
  state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'finished', 'cancelled')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX idx_focus_sessions_user_started ON focus_sessions(user_id, started_at DESC);

CREATE TABLE daily_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL,
  mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, review_date)
);
