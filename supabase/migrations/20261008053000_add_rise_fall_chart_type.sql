alter table public.bot_settings
  add column if not exists rise_fall_chart_type text not null default 'candles';

alter table public.bot_settings
  drop constraint if exists bot_settings_rise_fall_chart_type_check;

alter table public.bot_settings
  add constraint bot_settings_rise_fall_chart_type_check
  check (rise_fall_chart_type in ('candles', 'line'));
