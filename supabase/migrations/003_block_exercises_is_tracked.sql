-- Non-destructive: per-exercise tracking toggle (pause/resume a lift without losing logs or targets).
ALTER TABLE public.block_exercises
  ADD COLUMN IF NOT EXISTS is_tracked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
