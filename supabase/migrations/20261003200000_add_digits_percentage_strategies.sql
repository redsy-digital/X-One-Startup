alter table public.bot_settings
  add column if not exists digits_percentage_saturation_strategy_enabled boolean not null default false,
  add column if not exists digits_percentage_saturation_threshold numeric not null default 18,
  add column if not exists digits_percentage_absence_strategy_enabled boolean not null default false,
  add column if not exists digits_percentage_absence_streak integer not null default 30;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_percentage_saturation_threshold_check;
alter table public.bot_settings
  add constraint bot_settings_digits_percentage_saturation_threshold_check
  check (digits_percentage_saturation_threshold > 10 and digits_percentage_saturation_threshold <= 100);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_percentage_absence_streak_check;
alter table public.bot_settings
  add constraint bot_settings_digits_percentage_absence_streak_check
  check (digits_percentage_absence_streak between 1 and 10000);
