alter table public.bot_settings
  add column if not exists digits_percentage_window integer not null default 100,
  add column if not exists digits_parity_block_density_enabled boolean not null default false,
  add column if not exists digits_parity_block_window integer not null default 10,
  add column if not exists digits_parity_block_threshold numeric not null default 80,
  add column if not exists digits_parity_alternating_enabled boolean not null default false,
  add column if not exists digits_parity_alternating_length integer not null default 4,
  add column if not exists digits_parity_anchor_enabled boolean not null default false;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_percentage_window_check;
alter table public.bot_settings
  add constraint bot_settings_digits_percentage_window_check
  check (digits_percentage_window between 20 and 1000);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_parity_block_window_check;
alter table public.bot_settings
  add constraint bot_settings_digits_parity_block_window_check
  check (digits_parity_block_window between 2 and 100);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_parity_block_threshold_check;
alter table public.bot_settings
  add constraint bot_settings_digits_parity_block_threshold_check
  check (digits_parity_block_threshold between 50 and 100);

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_parity_alternating_length_check;
alter table public.bot_settings
  add constraint bot_settings_digits_parity_alternating_length_check
  check (digits_parity_alternating_length between 2 and 20);
