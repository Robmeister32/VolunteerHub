begin;
set search_path = volunteerhub, public;

alter table ministries
  add column if not exists screener_score smallint;

update ministries
set screener_score = 10
where screener_score is null;

alter table ministries
  alter column screener_score set default 10,
  alter column screener_score set not null;

alter table volunteer_profiles
  add column if not exists screener_score smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ministries_screener_score_check'
  ) then
    alter table ministries
      add constraint ministries_screener_score_check
      check (screener_score between 0 and 10);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'volunteer_profiles_screener_score_check'
  ) then
    alter table volunteer_profiles
      add constraint volunteer_profiles_screener_score_check
      check (screener_score is null or screener_score between 0 and 10);
  end if;
end $$;

comment on column ministries.screener_score is 'Maximum allowed volunteer screener score for ministry registration. Lower volunteer scores are better.';
comment on column volunteer_profiles.screener_score is 'Score assigned by screeners during volunteer application approval. Lower scores are better.';

commit;
