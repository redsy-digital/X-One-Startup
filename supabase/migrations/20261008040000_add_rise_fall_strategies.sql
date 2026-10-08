ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS rise_fall_symbol text NOT NULL DEFAULT 'R_10',
  ADD COLUMN IF NOT EXISTS rise_fall_duration_ticks integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS rise_fall_contract text NOT NULL DEFAULT 'CALL',
  ADD COLUMN IF NOT EXISTS rise_fall_sequence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rise_fall_sequence_length integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS rise_fall_block_density_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rise_fall_block_window integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS rise_fall_block_threshold numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS rise_fall_alternating_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rise_fall_alternating_length integer NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_contract_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_contract_check CHECK (rise_fall_contract IN ('CALL','PUT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_duration_ticks_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_duration_ticks_check CHECK (rise_fall_duration_ticks >= 1 AND rise_fall_duration_ticks <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_sequence_length_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_sequence_length_check CHECK (rise_fall_sequence_length >= 1 AND rise_fall_sequence_length <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_block_window_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_block_window_check CHECK (rise_fall_block_window >= 2 AND rise_fall_block_window <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_block_threshold_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_block_threshold_check CHECK (rise_fall_block_threshold >= 50 AND rise_fall_block_threshold <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_settings_rise_fall_alternating_length_check') THEN
    ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_rise_fall_alternating_length_check CHECK (rise_fall_alternating_length >= 2 AND rise_fall_alternating_length <= 20);
  END IF;
END $$;
