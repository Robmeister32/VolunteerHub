import assert from "node:assert/strict";
import { after, test } from "node:test";
import { checkDatabase, get, pool, run } from "./db.js";
import { haversineMeters } from "./domain.js";

after(() => pool.end());

test("distance calculation supports location-bound check-in", () => {
  assert.equal(Math.round(haversineMeters(39.8002, -89.6436, 39.8002, -89.6436)), 0);
  assert.ok(haversineMeters(39.8002, -89.6436, 39.8102, -89.6436) > 1_000);
});

test("configured PostgreSQL database is reachable", async () => {
  assert.equal(await checkDatabase(), true);
});

test("production schema and reporting views are installed", async () => {
  const result = await get<{ tables: number; views: number }>(
    `select
      (select count(*)::int from information_schema.tables where table_schema='volunteerhub' and table_type='BASE TABLE') tables,
      (select count(*)::int from information_schema.views where table_schema='volunteerhub') views`
  );
  assert.ok((result?.tables ?? 0) >= 34);
  assert.equal(result?.views, 9);
});

test("email templates support reusable content", async () => {
  const result = await get<{ columns: number }>(
    `select count(*)::int columns
     from information_schema.columns
     where table_schema='volunteerhub' and table_name='email_templates'
       and column_name in ('name','subject','body','created_by','is_active','updated_at')`
  );
  assert.equal(result?.columns, 6);
});

test("broadcasts can reference an email template", async () => {
  const result = await get<{ exists: boolean }>(
    `select exists(
       select 1 from information_schema.columns
       where table_schema='volunteerhub' and table_name='broadcasts' and column_name='email_template_id'
     ) exists`
  );
  assert.equal(result?.exists, true);
});

test("operational tasks support recipient snapshots and multi-volunteer claims", async () => {
  const result = await get<{ tables: number }>(
    `select count(*)::int tables
     from information_schema.tables
     where table_schema='volunteerhub'
       and table_name in ('tasks','task_recipients','task_claims')`
  );
  assert.equal(result?.tables, 3);
});

test("task administration list can sort tasks newest first", async () => {
  const result = await get<{ index_definition: string }>(
    `select indexdef index_definition
     from pg_indexes
     where schemaname='volunteerhub' and indexname='tasks_group_status_created_idx'`
  );
  assert.match(result?.index_definition ?? "", /created_at DESC/);
});

test("tasks track updates for editable administrator assignments", async () => {
  const result = await get<{ exists: boolean }>(
    `select exists(
       select 1 from information_schema.columns
       where table_schema='volunteerhub' and table_name='tasks' and column_name='updated_at'
     ) exists`
  );
  assert.equal(result?.exists, true);
});

test("task edit status calculation accepts integer parameters", async () => {
  const missingId = "00000000-0000-0000-0000-000000000000";
  const result = await run(
    `update tasks set required_volunteers=$1::integer,
      status=case when $1::integer <= $2::integer then 'STAFFED' else 'OPEN' end
     where id=$3`,
    [4, 0, missingId]
  );
  assert.equal(result.rowCount, 0);
});

test("active task visibility supports team members, claimants, and leaders", async () => {
  const result = await get<{ count: number }>(
    `select count(distinct t.id)::int count
     from tasks t join event_groups eg on eg.id=t.event_group_id join events e on e.id=t.event_id
     left join task_recipients tr on tr.task_id=t.id
     left join task_claims tc on tc.task_id=t.id
     where t.status not in ('COMPLETED','CANCELLED')
       and (
         (t.status in ('OPEN','STAFFED') and (tr.volunteer_id=$1::uuid or $2::boolean))
         or (t.status='IN_PROGRESS' and ((tc.volunteer_id=$1::uuid and tc.status='CLAIMED') or $2::boolean))
       )`,
    [null, true]
  );
  assert.ok((result?.count ?? -1) >= 0);
});

test("conversation read states support unread message tracking", async () => {
  const result = await get<{ exists: boolean }>(
    `select exists(
       select 1 from information_schema.tables
       where table_schema='volunteerhub' and table_name='conversation_read_states'
     ) exists`
  );
  assert.equal(result?.exists, true);
});

test("middle names are optional across user and household records", async () => {
  const result = await get<{ columns: number; all_nullable: boolean }>(
    `select count(*)::int columns, bool_and(is_nullable='YES') all_nullable
     from information_schema.columns
     where table_schema='volunteerhub'
       and table_name in ('app_users','volunteer_profiles','household_members')
       and column_name='middle_name'`
  );
  assert.equal(result?.columns, 3);
  assert.equal(result?.all_nullable, true);
});

test("application users can be assigned a home campus", async () => {
  const result = await get<{ exists: boolean }>(
    `select exists(
       select 1 from information_schema.columns
       where table_schema='volunteerhub' and table_name='app_users' and column_name='home_campus_id'
     ) exists`
  );
  assert.equal(result?.exists, true);
});

test("event and volunteer searches have trigram indexes", async () => {
  const result = await get<{ indexes: number }>(
    `select count(*)::int indexes from pg_indexes
     where schemaname='volunteerhub' and indexname in (
       'events_name_search_idx','event_groups_name_search_idx',
       'volunteer_profiles_first_name_search_idx','volunteer_profiles_last_name_search_idx'
     )`
  );
  assert.equal(result?.indexes, 4);
});

test("events use the current lifecycle and default to draft", async () => {
  const result = await get<{ column_default: string; constraint_definition: string }>(
    `select c.column_default,
      pg_get_constraintdef(pc.oid) constraint_definition
     from information_schema.columns c
     join pg_constraint pc on pc.conrelid='volunteerhub.events'::regclass and pc.conname='events_status_check'
     where c.table_schema='volunteerhub' and c.table_name='events' and c.column_name='status'`
  );
  assert.equal(result?.column_default, "'DRAFT'::text");
  for (const status of ["ACTIVE", "COMPLETE", "DRAFT", "CANCELLED", "REMOVED"]) {
    assert.match(result?.constraint_definition ?? "", new RegExp(status));
  }
  assert.doesNotMatch(result?.constraint_definition ?? "", /PUBLISHED|COMPLETED/);
});

test("events support one-off location type and participating campuses", async () => {
  const result = await get<{ columns: number; index_exists: boolean }>(
    `select
      (select count(*)::int
       from information_schema.columns
       where table_schema='volunteerhub' and table_name='events'
         and column_name in ('location_type','participating_campus_ids')) columns,
      exists(
        select 1 from pg_indexes
        where schemaname='volunteerhub' and indexname='events_participating_campuses_idx'
      ) index_exists`
  );
  assert.equal(result?.columns, 2);
  assert.equal(result?.index_exists, true);
});

test("audit logs include searchable module metadata", async () => {
  const result = await get<{ module_column: boolean; module_index: boolean }>(
    `select
      exists(
        select 1 from information_schema.columns
        where table_schema='volunteerhub' and table_name='audit_logs' and column_name='module'
      ) module_column,
      exists(
        select 1 from pg_indexes
        where schemaname='volunteerhub' and indexname='audit_logs_module_occurred_idx'
      ) module_index`
  );
  assert.equal(result?.module_column, true);
  assert.equal(result?.module_index, true);
});
