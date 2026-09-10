ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS digits_random boolean NOT NULL DEFAULT false;
