-- Support responsive, contains-style searches without full table scans as data grows.

begin;

set search_path = volunteerhub, public;

create extension if not exists pg_trgm;

create index if not exists events_name_search_idx on events using gin(name gin_trgm_ops);
create index if not exists events_description_search_idx on events using gin(description gin_trgm_ops);
create index if not exists events_address_search_idx on events using gin(address gin_trgm_ops);
create index if not exists campuses_name_search_idx on campuses using gin(name gin_trgm_ops);
create index if not exists event_groups_name_search_idx on event_groups using gin(name gin_trgm_ops);
create index if not exists volunteer_profiles_first_name_search_idx on volunteer_profiles using gin(first_name gin_trgm_ops);
create index if not exists volunteer_profiles_last_name_search_idx on volunteer_profiles using gin(last_name gin_trgm_ops);
create index if not exists volunteer_profiles_preferred_name_search_idx on volunteer_profiles using gin(preferred_name gin_trgm_ops);

commit;
