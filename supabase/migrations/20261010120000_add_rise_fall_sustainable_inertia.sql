ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS rise_fall_sustainable_inertia_enabled boolean NOT NULL DEFAULT false;
