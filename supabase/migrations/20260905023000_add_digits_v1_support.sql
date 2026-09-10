-- Digits V1: allow Digits contracts in shared trade history and persist
-- the fixed contract/target configuration. Existing Forex CALL/PUT rows remain valid.

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
    'DIGITODD'::text
  ])
);

ALTER TABLE public.trade_history ADD COLUMN IF NOT EXISTS market text;
ALTER TABLE public.trade_history ADD COLUMN IF NOT EXISTS target_digit integer;

ALTER TABLE public.trade_history DROP CONSTRAINT IF EXISTS trade_history_market_check;
ALTER TABLE public.trade_history ADD CONSTRAINT trade_history_market_check CHECK (
  market IS NULL OR market = ANY (ARRAY['synthetic'::text, 'forex'::text])
);

ALTER TABLE public.trade_history DROP CONSTRAINT IF EXISTS trade_history_target_digit_check;
ALTER TABLE public.trade_history ADD CONSTRAINT trade_history_target_digit_check CHECK (
  target_digit IS NULL OR (target_digit >= 0 AND target_digit <= 9)
);

ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS digits_contract text NOT NULL DEFAULT 'DIGITUNDER';
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS digits_target_digit integer NOT NULL DEFAULT 9;

ALTER TABLE public.bot_settings DROP CONSTRAINT IF EXISTS bot_settings_digits_contract_check;
ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_digits_contract_check CHECK (
  digits_contract = ANY (ARRAY[
    'DIGITUNDER'::text,
    'DIGITOVER'::text,
    'DIGITMATCH'::text,
    'DIGITDIFF'::text,
    'DIGITEVEN'::text,
    'DIGITODD'::text
  ])
);

ALTER TABLE public.bot_settings DROP CONSTRAINT IF EXISTS bot_settings_digits_target_digit_check;
ALTER TABLE public.bot_settings ADD CONSTRAINT bot_settings_digits_target_digit_check CHECK (
  digits_target_digit >= 0 AND digits_target_digit <= 9
);
