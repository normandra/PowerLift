-- PairLift: Cloud Sync, Google Auth Profiles, 1:1 Partner Pairing & Emoji Reactions
-- Target project: qivjtpgbbvxawoghyjwq

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Lifter',
  avatar_color text NOT NULL DEFAULT '#FF6B57',
  companion text NOT NULL DEFAULT 'cat' CHECK (companion IN ('cat', 'dog', 'gorilla')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'linked' CHECK (status = 'linked'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_links_ordered CHECK (user_a < user_b),
  CONSTRAINT partner_links_user_a_unique UNIQUE (user_a),
  CONSTRAINT partner_links_user_b_unique UNIQUE (user_b)
);

CREATE TABLE IF NOT EXISTS public.partner_invites (
  code text PRIMARY KEY,
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blocks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  duration_days integer NOT NULL DEFAULT 98 CHECK (duration_days BETWEEN 7 AND 365),
  track_bodyweight boolean NOT NULL DEFAULT true,
  weekly_session_goal integer NOT NULL DEFAULT 3 CHECK (weekly_session_goal BETWEEN 1 AND 7),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.block_exercises (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  default_increment numeric(6,2) NOT NULL DEFAULT 2.5,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (block_id, slug)
);

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  plan_type text NOT NULL DEFAULT 'linear',
  plan_name text NOT NULL DEFAULT 'Linear Target Curve',
  bodyweight_start numeric(6,2),
  bodyweight_goal numeric(6,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.exercise_targets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  block_exercise_id uuid NOT NULL REFERENCES public.block_exercises(id) ON DELETE CASCADE,
  plan_type text NOT NULL DEFAULT 'linear',
  target_metric text NOT NULL DEFAULT 'working_weight' CHECK (target_metric IN ('working_weight', 'one_rm')),
  start_weight numeric(8,2) NOT NULL,
  goal_weight numeric(8,2) NOT NULL,
  increment numeric(6,2) NOT NULL DEFAULT 2.5,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (member_plan_id, block_exercise_id)
);

CREATE TABLE IF NOT EXISTS public.workout_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  block_exercise_id uuid NOT NULL REFERENCES public.block_exercises(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  working_weight numeric(8,2),
  one_rm numeric(8,2),
  estimated_1rm numeric(8,2),
  sets jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_volume numeric(10,2) NOT NULL DEFAULT 0,
  is_pr boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bodyweight_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  weight numeric(6,2) NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.log_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_log_id uuid NOT NULL REFERENCES public.workout_logs(id) ON DELETE CASCADE,
  log_owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reactor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('🔥', '💪', '👏', '🏆', '❤️')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workout_log_id, reactor_id, emoji)
);

-- 2. Indexes on Foreign Keys & RLS Filter Columns
CREATE INDEX IF NOT EXISTS idx_partner_invites_inviter_id ON public.partner_invites (inviter_id);
CREATE INDEX IF NOT EXISTS idx_blocks_user_status_date ON public.blocks (user_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_block_exercises_user_id ON public.block_exercises (user_id);
CREATE INDEX IF NOT EXISTS idx_block_exercises_block_sort ON public.block_exercises (block_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans (user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_targets_user_id ON public.exercise_targets (user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_targets_ex_id ON public.exercise_targets (block_exercise_id);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date ON public.workout_logs (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_workout_logs_block_date ON public.workout_logs (block_id, log_date);
CREATE INDEX IF NOT EXISTS idx_workout_logs_ex_id ON public.workout_logs (block_exercise_id);
CREATE INDEX IF NOT EXISTS idx_bodyweight_logs_user_date ON public.bodyweight_logs (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_bodyweight_logs_block_date ON public.bodyweight_logs (block_id, log_date);
CREATE INDEX IF NOT EXISTS idx_log_reactions_owner_id ON public.log_reactions (log_owner_id);
CREATE INDEX IF NOT EXISTS idx_log_reactions_reactor_id ON public.log_reactions (reactor_id);

-- 3. Explicit Grants for Authenticated Users
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.profiles,
  public.blocks,
  public.block_exercises,
  public.plans,
  public.exercise_targets,
  public.workout_logs,
  public.bodyweight_logs,
  public.log_reactions
TO authenticated;

GRANT SELECT, DELETE ON TABLE public.partner_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.partner_invites TO authenticated;

-- 4. Enable Row Level Security (default-denies anon)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.block_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bodyweight_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_reactions ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (single permissive policy per action, TO authenticated, wrapped auth.uid())

-- profiles
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = profiles.id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = profiles.id))
    )
  );

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (id = (SELECT auth.uid()));

-- partner_links
CREATE POLICY partner_links_select ON public.partner_links
  FOR SELECT TO authenticated
  USING (user_a = (SELECT auth.uid()) OR user_b = (SELECT auth.uid()));

CREATE POLICY partner_links_delete ON public.partner_links
  FOR DELETE TO authenticated
  USING (user_a = (SELECT auth.uid()) OR user_b = (SELECT auth.uid()));

-- partner_invites
CREATE POLICY partner_invites_select ON public.partner_invites
  FOR SELECT TO authenticated
  USING (inviter_id = (SELECT auth.uid()));

CREATE POLICY partner_invites_insert ON public.partner_invites
  FOR INSERT TO authenticated
  WITH CHECK (inviter_id = (SELECT auth.uid()));

CREATE POLICY partner_invites_update ON public.partner_invites
  FOR UPDATE TO authenticated
  USING (inviter_id = (SELECT auth.uid()))
  WITH CHECK (inviter_id = (SELECT auth.uid()));

CREATE POLICY partner_invites_delete ON public.partner_invites
  FOR DELETE TO authenticated
  USING (inviter_id = (SELECT auth.uid()));

-- blocks
CREATE POLICY blocks_select ON public.blocks
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = blocks.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = blocks.user_id))
    )
  );

CREATE POLICY blocks_insert ON public.blocks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY blocks_update ON public.blocks
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY blocks_delete ON public.blocks
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- block_exercises
CREATE POLICY block_exercises_select ON public.block_exercises
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = block_exercises.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = block_exercises.user_id))
    )
  );

CREATE POLICY block_exercises_insert ON public.block_exercises
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY block_exercises_update ON public.block_exercises
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY block_exercises_delete ON public.block_exercises
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- plans
CREATE POLICY plans_select ON public.plans
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = plans.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = plans.user_id))
    )
  );

CREATE POLICY plans_insert ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY plans_update ON public.plans
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY plans_delete ON public.plans
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- exercise_targets
CREATE POLICY exercise_targets_select ON public.exercise_targets
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = exercise_targets.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = exercise_targets.user_id))
    )
  );

CREATE POLICY exercise_targets_insert ON public.exercise_targets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY exercise_targets_update ON public.exercise_targets
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY exercise_targets_delete ON public.exercise_targets
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- workout_logs
CREATE POLICY workout_logs_select ON public.workout_logs
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = workout_logs.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = workout_logs.user_id))
    )
  );

CREATE POLICY workout_logs_insert ON public.workout_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY workout_logs_update ON public.workout_logs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY workout_logs_delete ON public.workout_logs
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- bodyweight_logs
CREATE POLICY bodyweight_logs_select ON public.bodyweight_logs
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = bodyweight_logs.user_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = bodyweight_logs.user_id))
    )
  );

CREATE POLICY bodyweight_logs_insert ON public.bodyweight_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY bodyweight_logs_update ON public.bodyweight_logs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY bodyweight_logs_delete ON public.bodyweight_logs
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- log_reactions
CREATE POLICY log_reactions_select ON public.log_reactions
  FOR SELECT TO authenticated
  USING (
    reactor_id = (SELECT auth.uid())
    OR log_owner_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.partner_links pl
      WHERE pl.status = 'linked'
        AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = log_reactions.log_owner_id)
          OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = log_reactions.log_owner_id))
    )
  );

CREATE POLICY log_reactions_insert ON public.log_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    reactor_id = (SELECT auth.uid())
    AND (
      log_owner_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.partner_links pl
        WHERE pl.status = 'linked'
          AND ((pl.user_a = (SELECT auth.uid()) AND pl.user_b = log_reactions.log_owner_id)
            OR (pl.user_b = (SELECT auth.uid()) AND pl.user_a = log_reactions.log_owner_id))
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.workout_logs wl
      WHERE wl.id = workout_log_id AND wl.user_id = log_owner_id
    )
  );

CREATE POLICY log_reactions_delete ON public.log_reactions
  FOR DELETE TO authenticated
  USING (reactor_id = (SELECT auth.uid()));

-- 6. Pairing RPC (1:1 invite code claim)
CREATE OR REPLACE FUNCTION public.claim_partner_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_inviter uuid;
  v_clean_code text;
  v_partner jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.profiles (id, display_name)
  VALUES (v_uid, 'Lifter')
  ON CONFLICT (id) DO NOTHING;

  v_clean_code := upper(trim(coalesce(p_code, '')));
  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'Invite code is required';
  END IF;

  SELECT inviter_id
  INTO v_inviter
  FROM public.partner_invites
  WHERE code = v_clean_code
    AND used_at IS NULL
    AND expires_at > now();

  IF v_inviter IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite code';
  END IF;

  IF v_inviter = v_uid THEN
    RAISE EXCEPTION 'You cannot link with your own invite code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partner_links
    WHERE user_a IN (v_uid, v_inviter) OR user_b IN (v_uid, v_inviter)
  ) THEN
    RAISE EXCEPTION 'One of the accounts is already linked to a partner. Unlink first.';
  END IF;

  INSERT INTO public.partner_links (user_a, user_b, status)
  VALUES (LEAST(v_uid, v_inviter), GREATEST(v_uid, v_inviter), 'linked');

  UPDATE public.partner_invites
  SET used_at = now()
  WHERE inviter_id IN (v_uid, v_inviter)
    AND used_at IS NULL;

  SELECT jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'avatar_color', p.avatar_color,
    'companion', p.companion
  )
  INTO v_partner
  FROM public.profiles p
  WHERE p.id = v_inviter;

  RETURN v_partner;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_partner_invite(text) TO authenticated;
