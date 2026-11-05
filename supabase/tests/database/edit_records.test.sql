begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function('core', 'update_manual_record', array['text', 'uuid', 'integer', 'jsonb'], 'audited edit function exists');
select has_column('research', 'requests', 'version', 'requests have a version');
select has_column('research', 'requests', 'updated_by', 'requests track the editor');
select ok(not has_table_privilege('authenticated', 'research.requests', 'update'), 'research direct updates are denied');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e101', 'edit-dpo@example.invalid', '{"full_name":"Edit test DPO","username":"edit_test_dpo"}'),
  ('00000000-0000-0000-0000-00000000e102', 'edit-reader@example.invalid', '{"full_name":"Edit test reader","username":"edit_test_reader"}');
update core.profiles set role = 'dpo', status = 'active' where id = '00000000-0000-0000-0000-00000000e101';
update core.profiles set role = 'staff', status = 'active' where id = '00000000-0000-0000-0000-00000000e102';
insert into core.user_dataset_grants (user_id, dataset_id, access_mode, granted_by)
select '00000000-0000-0000-0000-00000000e102', id, 'read_only', '00000000-0000-0000-0000-00000000e101'
from core.datasets;

insert into research.requests (id, department_id, requester_name, research_title_purpose)
values ('00000000-0000-0000-0000-00000000e202', (select id from core.departments where code = 'DPO'),
        'Before Researcher', 'Test purpose');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e101', true);

select core.update_manual_record('research', '00000000-0000-0000-0000-00000000e202', 1,
  jsonb_build_object('department_id', (select id from core.departments where code = 'DPO'),
                     'requester_name', 'After Researcher', 'research_title_purpose', 'Test purpose',
                     'status', 'under_review', 'request_type', 'interview_request'));
select is((select status::text from research.requests where id = '00000000-0000-0000-0000-00000000e202'), 'under_review', 'research status was edited');
select is((select version from research.requests where id = '00000000-0000-0000-0000-00000000e202'), 2, 'research version incremented');
select is((select count(*)::integer from core.audit_events where action = 'record.updated' and target_id in
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-00000000e203')), 1, 'request edit was audited');

select throws_ok(
  $$select core.update_manual_record('research', '00000000-0000-0000-0000-00000000e202', 1,
    jsonb_build_object('department_id', (select id from core.departments where code = 'DPO'),
                       'requester_name', 'Stale', 'research_title_purpose', 'Test purpose'))$$,
  '40001', 'Record changed while editing', 'stale version is rejected');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e102', true);
select throws_ok(
  $$select core.update_manual_record('research', '00000000-0000-0000-0000-00000000e202', 2,
    jsonb_build_object('department_id', (select id from core.departments where code = 'DPO'),
                       'requester_name', 'Unauthorized', 'research_title_purpose', 'Test purpose'))$$,
  '42501', 'Read/write access is required for both departments', 'read-only user cannot edit');

select is((select request_type from research.requests where id='00000000-0000-0000-0000-00000000e202'), 'interview_request', 'editing preserves interview request type');
select throws_ok($$select core.query_records('jobseekers')$$, '22023', 'Unknown module', 'retired modules cannot be queried');
select * from finish();
rollback;
