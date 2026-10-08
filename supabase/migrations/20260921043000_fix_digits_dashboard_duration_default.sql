-- Digits dashboard: finalize the new 3-tick default for existing bot_settings schemas.
alter table public.bot_settings
  alter column contract_duration_ticks set default 3;

update public.bot_settings
set contract_duration_ticks = 3
where contract_duration_ticks in (5, 20);
