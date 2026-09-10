-- Accumulators V1: allow ACCU contracts in shared trade history and persist
-- Accumulators' own risk/growth-rate/tick-count configuration in a dedicated
-- table (kept separate from bot_settings so Digits/Forex settings are never
-- touched by this feature).

ALTER TABLE public.trade_history DROP CONSTRAINT IF EXISTS trade_history_type_check;
ALTER TABLE public.trade_history ADD CONSTRAINT trade_history_type_check CHECK (
  type = ANY (ARRAY[
    'CALL'::text,
    'PUT'::text,
    'DIGITUNDER'::text,
    'DIGITOVER'::text,
    'DIGITMATCH'::text,
    'DIGITDIFF'::text,
    'DIGITEVEN'::text,
    'DIGITODD'::text,
    'ACCU'::text
  ])
);

CREATE TABLE IF NOT EXISTS public.accumulators_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  growth_rate numeric NOT NULL DEFAULT 0.01,
  tick_count integer NOT NULL DEFAULT 5,
  stake numeric NOT NULL DEFAULT 0.35,
  target_profit numeric NOT NULL DEFAULT 3.5,
  stop_loss numeric NOT NULL DEFAULT 6.0,
  use_martingale boolean NOT NULL DEFAULT true,
  martingale_multiplier numeric NOT NULL DEFAULT 2.1,
  max_martingale_steps integer NOT NULL DEFAULT 3,
  max_consecutive_losses integer NOT NULL DEFAULT 5,
  cooldown_after_loss integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accumulators_settings
  DROP CONSTRAINT IF EXISTS accumulators_settings_growth_rate_check;
ALTER TABLE public.accumulators_settings
  ADD CONSTRAINT accumulators_settings_growth_rate_check
  CHECK (growth_rate = ANY (ARRAY[0.01, 0.02, 0.03, 0.04, 0.05]::numeric[]));

ALTER TABLE public.accumulators_settings
  DROP CONSTRAINT IF EXISTS accumulators_settings_tick_count_check;
ALTER TABLE public.accumulators_settings
  ADD CONSTRAINT accumulators_settings_tick_count_check
  CHECK (tick_count >= 1 AND tick_count <= 500);

ALTER TABLE public.accumulators_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own accumulators settings" ON public.accumulators_settings;
CREATE POLICY "Users manage their own accumulators settings"
  ON public.accumulators_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Mantém updated_at coerente em cada upsert, tal como seria de esperar de
-- uma tabela de configurações por utilizador.
CREATE OR REPLACE FUNCTION public.set_accumulators_settings_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accumulators_settings_set_updated_at ON public.accumulators_settings;
CREATE TRIGGER accumulators_settings_set_updated_at
  BEFORE UPDATE ON public.accumulators_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_accumulators_settings_updated_at();
