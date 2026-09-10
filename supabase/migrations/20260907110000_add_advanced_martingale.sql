-- Digits V1: Advanced Martingale configuration
ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS use_advanced_martingale boolean NOT NULL DEFAULT false;

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS advanced_martingale_contract text NOT NULL DEFAULT 'DIGITOVER';

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS advanced_martingale_target_digit integer NOT NULL DEFAULT 2;

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS max_advanced_martingale_steps integer NOT NULL DEFAULT 2;

ALTER TABLE public.bot_settings
  DROP CONSTRAINT IF EXISTS bot_settings_advanced_martingale_contract_check;

ALTER TABLE public.bot_settings
  ADD CONSTRAINT bot_settings_advanced_martingale_contract_check
  CHECK (advanced_martingale_contract = ANY (ARRAY[
    'DIGITUNDER'::text,
    'DIGITOVER'::text,
    'DIGITMATCH'::text,
    'DIGITDIFF'::text,
    'DIGITEVEN'::text,
    'DIGITODD'::text
  ]));

ALTER TABLE public.bot_settings
  DROP CONSTRAINT IF EXISTS bot_settings_advanced_martingale_target_digit_check;

ALTER TABLE public.bot_settings
  ADD CONSTRAINT bot_settings_advanced_martingale_target_digit_check
  CHECK (advanced_martingale_target_digit >= 0 AND advanced_martingale_target_digit <= 9);

ALTER TABLE public.bot_settings
  DROP CONSTRAINT IF EXISTS bot_settings_max_advanced_martingale_steps_check;

ALTER TABLE public.bot_settings
  ADD CONSTRAINT bot_settings_max_advanced_martingale_steps_check
  CHECK (max_advanced_martingale_steps >= 1 AND max_advanced_martingale_steps <= 20);
