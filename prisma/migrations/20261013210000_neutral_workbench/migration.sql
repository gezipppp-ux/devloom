BEGIN;
ALTER TABLE project_issues ADD COLUMN due_date TEXT, ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE project_issues ADD CONSTRAINT project_issues_due_date CHECK (due_date IS NULL OR due_date ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE issue_deliverables
  ADD COLUMN title TEXT NOT NULL DEFAULT '',
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'returned')),
  ADD COLUMN checklist TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN checked_items INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN review_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN reviewed_by_id TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ(3),
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE INDEX issue_deliverables_project_status ON issue_deliverables(project_id, status, created_at DESC);
COMMIT;
