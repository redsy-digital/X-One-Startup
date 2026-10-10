ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS rise_fall_percent_channel_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rise_fall_percent_channel_window integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS rise_fall_percent_channel_threshold numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS rise_fall_momentum_filter_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rise_fall_trend_protection_enabled boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_percent_channel_window_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_percent_channel_window_check CHECK (rise_fall_percent_channel_window BETWEEN 5 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_percent_channel_threshold_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_percent_channel_threshold_check CHECK (rise_fall_percent_channel_threshold BETWEEN 1 AND 99);
  END IF;
END $$;
