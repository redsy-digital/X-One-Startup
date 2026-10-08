alter table public.bot_settings
  add column if not exists digits_match_twin_enabled boolean not null default false,
  add column if not exists digits_match_twin_rest_ticks integer not null default 3,
  add column if not exists digits_match_mirror_enabled boolean not null default false,
  add column if not exists digits_match_mirror_window integer not null default 15,
  add column if not exists digits_match_mirror_dominance numeric not null default 80;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_match_twin_rest_ticks_check;
alter table public.bot_settings
  add constraint bot_settings_digits_match_twin_rest_ticks_check
  check (digits_match_twin_rest_ticks between 0 and 20);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_match_mirror_window_check;
alter table public.bot_settings
  add constraint bot_settings_digits_match_mirror_window_check
  check (digits_match_mirror_window between 4 and 100);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_match_mirror_dominance_check;
alter table public.bot_settings
  add constraint bot_settings_digits_match_mirror_dominance_check
  check (digits_match_mirror_dominance between 50 and 100);
