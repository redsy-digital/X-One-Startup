-- Digits: optional Sequência Par/Ímpar strategy configuration.
alter table public.bot_settings
  add column if not exists digits_sequence_strategy_enabled boolean not null default false,
  add column if not exists digits_sequence_strategy_mode text not null default 'fixed',
  add column if not exists digits_sequence_length integer not null default 6;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_sequence_strategy_mode_check;

alter table public.bot_settings
  add constraint bot_settings_digits_sequence_strategy_mode_check
  check (digits_sequence_strategy_mode in ('fixed', 'multiple'));

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_sequence_length_check;

alter table public.bot_settings
  add constraint bot_settings_digits_sequence_length_check
  check (digits_sequence_length between 1 and 100);

alter table public.bot_settings
  alter column digits_sequence_length set default 6;

-- Normalize any accidental/legacy values outside the strategy range.
update public.bot_settings
set digits_sequence_length = 6
where digits_sequence_length < 1 or digits_sequence_length > 100;

update public.bot_settings
set digits_sequence_strategy_mode = 'fixed'
where digits_sequence_strategy_mode not in ('fixed', 'multiple');
