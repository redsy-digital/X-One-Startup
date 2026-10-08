-- Digits dashboard preferences: chart, symbol and contract duration in ticks.
alter table public.bot_settings
  add column if not exists digits_chart_type text not null default 'digits',
  add column if not exists digits_symbol text not null default 'R_10',
  add column if not exists contract_duration_ticks integer not null default 3;

alter table public.bot_settings
  drop constraint if exists bot_settings_digits_chart_type_check;

alter table public.bot_settings
  add constraint bot_settings_digits_chart_type_check
  check (digits_chart_type in ('digits', 'percentage', 'candles'));

alter table public.bot_settings
  drop constraint if exists bot_settings_contract_duration_ticks_check;

alter table public.bot_settings
  add constraint bot_settings_contract_duration_ticks_check
  check (contract_duration_ticks between 1 and 100);

-- One-time normalization of legacy Digits duration defaults.
update public.bot_settings
set contract_duration_ticks = 3
where contract_duration_ticks in (5, 20);

alter table public.bot_settings
  alter column contract_duration_ticks set default 3;
