begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select is((select count(*)::integer from core.datasets where is_active and slug not in ('research_requests','tupad_beneficiaries')), 0, 'only request and TUPAD datasets are active');
select is((select count(*)::integer from core.user_dataset_grants g join core.datasets d on d.id=g.dataset_id where not d.is_active and g.revoked_at is null), 0, 'retired dataset grants are revoked');
select is((select count(*)::integer from core.data_submissions s join core.datasets d on d.id=s.dataset_id where d.slug in ('jobseeker_registry','biometric_events')), 0, 'retired submission payloads are deleted');
select is((select count(*)::integer from core.import_jobs j join core.datasets d on d.id=j.dataset_id where d.slug in ('jobseeker_registry','biometric_events')), 0, 'retired imports are deleted');

insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000a101','request-dpo@example.invalid','{"full_name":"Request DPO","username":"request_test_dpo"}'),
 ('00000000-0000-0000-0000-00000000a102','request-focal@example.invalid','{"full_name":"Request Focal","username":"request_test_focal"}'),
 ('00000000-0000-0000-0000-00000000a103','request-admin@example.invalid','{"full_name":"Request Admin","username":"request_test_admin"}');
update core.profiles set status='active',role='dpo' where id='00000000-0000-0000-0000-00000000a101';
update core.profiles set status='active',role='office_focal' where id='00000000-0000-0000-0000-00000000a102';
update core.profiles set status='active',role='system_admin' where id='00000000-0000-0000-0000-00000000a103';
insert into core.user_dataset_grants(user_id,dataset_id,access_mode,granted_by)
select '00000000-0000-0000-0000-00000000a102',id,'read_write','00000000-0000-0000-0000-00000000a101'
from core.datasets where slug='research_requests';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a101',true);
set local role authenticated;
select is((select count(*)::integer from core.datasets), 2, 'DPO dataset picker sees requests and TUPAD');
select core.create_manual_record('research', jsonb_build_object('department_id',(select id from core.departments where code='DPO'),'request_type','data_request','requester_name','Synthetic Data Request','research_title_purpose','Synthetic data request test'));
select core.create_manual_record('research', jsonb_build_object('department_id',(select id from core.departments where code='DPO'),'request_type','interview_request','requester_name','Synthetic Interview Request','research_title_purpose','Synthetic interview request test'));
select is((core.query_records('research', p_search=>'Synthetic Data Request', p_request_type=>'data_request')->>'total')::integer, 1, 'data requests can be created and filtered');
select is((core.query_records('research', p_search=>'Synthetic Interview Request', p_request_type=>'interview_request')->>'total')::integer, 1, 'interview requests can be created and filtered');
select lives_ok($$select core.dataset_visualization_stats('research_requests')$$, 'request charts work after schema removal');
select throws_ok($$select core.query_records('biometrics')$$, '22023', 'Unknown module', 'retired biometric queries are rejected');
select throws_ok($$select core.create_manual_record('jobseekers','{}')$$, '22023', 'Unknown database', 'retired record creation is rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a102',true);
select core.stage_manual_submission('research', jsonb_build_object('department_id',(select id from core.departments where code='DPO'),'request_type','interview_request','requester_name','Synthetic Staged Interview','research_title_purpose','Synthetic staged request test'));
select is(jsonb_array_length(core.my_data_submissions()), 1, 'focalperson can still submit interview requests');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a101',true);
select lives_ok($$select core.review_data_submission((select id from core.data_submissions where submitted_by='00000000-0000-0000-0000-00000000a102'),'approve')$$, 'DPO can approve a staged request');
select is((select request_type from research.requests where requester_name='Synthetic Staged Interview'), 'interview_request', 'approval preserves the interview request type');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a103',true);
select lives_ok($$select core.system_dashboard_stats()$$, 'system dashboard works without the retired schemas');
select ok(not (core.system_dashboard_stats() ?| array['jobseekers','biometrics']), 'dashboard omits retired dataset totals');
reset role;
select * from finish();
rollback;
