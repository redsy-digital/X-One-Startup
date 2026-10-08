-- Digits: optional deterministic Over/Under sequence strategy.
alter table public.bot_settings
  add column if not exists digits_over_under_sequence_strategy_enabled boolean not null default false,
  add column if not exists digits_over_under_sequence_length integer not null default 5,
  add column if not exists digits_over_under_over_barrier integer not null default 4,
  add column if not exists digits_over_under_under_barrier integer not null default 5;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_over_under_sequence_length_check;
alter table public.bot_settings
  add constraint bot_settings_digits_over_under_sequence_length_check
  check (digits_over_under_sequence_length between 1 and 100);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_over_under_barriers_check;
alter table public.bot_settings
  add constraint bot_settings_digits_over_under_barriers_check
  check (
    digits_over_under_over_barrier between 0 and 8
    and digits_over_under_under_barrier between 1 and 9
    and digits_over_under_under_barrier > digits_over_under_over_barrier
  );
