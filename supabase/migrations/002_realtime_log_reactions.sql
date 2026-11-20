-- Enable Supabase Realtime for partner emoji reactions & optimize owner timeline reads
CREATE INDEX IF NOT EXISTS idx_log_reactions_owner_created
  ON public.log_reactions (log_owner_id, created_at DESC);

ALTER TABLE public.log_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'log_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.log_reactions;
  END IF;
END $$;
