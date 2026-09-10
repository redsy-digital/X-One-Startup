-- Digits V1: Follow Up target mode.
-- The actual target digit remains numeric in digits_target_digit; this flag
-- selects the mode that follows the previous settled contract's exit digit.
alter table public.bot_settings
  add column if not exists digits_follow_up boolean not null default false;
