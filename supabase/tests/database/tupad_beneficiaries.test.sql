BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

SELECT has_schema('tupad', 'TUPAD has its own schema');
SELECT has_table('tupad', 'beneficiaries', 'TUPAD beneficiaries table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='tupad.beneficiaries'::regclass), 'beneficiaries have RLS');
SELECT is((SELECT classification FROM core.datasets WHERE slug='tupad_beneficiaries' AND is_active), 'highly_restricted', 'beneficiary data is registered as highly restricted');
SELECT ok(NOT has_table_privilege('anon','tupad.beneficiaries','SELECT'), 'anonymous callers cannot read beneficiaries');
SELECT ok(NOT has_table_privilege('authenticated','tupad.beneficiaries','UPDATE'), 'direct beneficiary updates are unavailable');
SELECT ok(NOT has_table_privilege('authenticated','tupad.beneficiaries','DELETE'), 'deletion must use the audited RPC');

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000b101','tupad-dpo@example.invalid','{"full_name":"TUPAD DPO","username":"tupad_test_dpo"}'),
 ('00000000-0000-0000-0000-00000000b102','tupad-focal@example.invalid','{"full_name":"TUPAD Focal","username":"tupad_test_focal"}'),
 ('00000000-0000-0000-0000-00000000b103','tupad-staff@example.invalid','{"full_name":"TUPAD Staff","username":"tupad_test_staff"}'),
 ('00000000-0000-0000-0000-00000000b104','tupad-admin@example.invalid','{"full_name":"TUPAD Admin","username":"tupad_test_admin"}');
UPDATE core.profiles SET status='active',role='dpo' WHERE id='00000000-0000-0000-0000-00000000b101';
UPDATE core.profiles SET status='active',role='office_focal' WHERE id='00000000-0000-0000-0000-00000000b102';
UPDATE core.profiles SET status='active',role='staff' WHERE id='00000000-0000-0000-0000-00000000b103';
UPDATE core.profiles SET status='active',role='system_admin' WHERE id='00000000-0000-0000-0000-00000000b104';
INSERT INTO core.user_dataset_grants(user_id,dataset_id,access_mode,granted_by)
SELECT '00000000-0000-0000-0000-00000000b102',id,'read_write','00000000-0000-0000-0000-00000000b101'
FROM core.datasets WHERE slug='tupad_beneficiaries';

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b101',true);
SET LOCAL ROLE authenticated;
INSERT INTO tupad.beneficiaries(id,department_id,first_name,last_name,birth_date,source_number,beneficiary_type,barangay,id_number,contact_number,average_monthly_income,raw_source,metadata,source_sheet,source_row_number,created_by,updated_by)
VALUES
 ('00000000-0000-0000-0000-00000000b201',(SELECT id FROM core.departments WHERE code='PESO'),'SyntheticTupadFixture','One','1980-01-02','001','Displaced worker','Fixture Barangay A','000123','09123456789','9OOO','{"EXTRA COLUMN":"TupadSourceOnlyFixture","ID NO.":"000123","ORIGINAL DATE":"01/02/1980"}','{"workbook_title":"Synthetic title","notes":["Retained footer"]}','Sheet1',5,'00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-00000000b101'),
 ('00000000-0000-0000-0000-00000000b202',(SELECT id FROM core.departments WHERE code='PESO'),'SyntheticTupadFixture','Two','1981-02-03','002','Self-employed','Fixture Barangay B','000124','09123456780','none','{"EXTRA COLUMN":"Other source value"}','{}','Sheet1',6,'00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-00000000b101');

SELECT is((core.query_records('tupad',p_search=>'SyntheticTupadFixture')->>'total')::integer,2,'DPO can query beneficiaries');
SELECT is((core.query_records('tupad',p_search=>'SyntheticTupadFixture',p_status=>'Displaced worker')->>'total')::integer,1,'beneficiary type filter works');
SELECT is((core.query_records('tupad',p_search=>'SyntheticTupadFixture',p_secondary=>'Fixture Barangay A')->>'total')::integer,1,'barangay filter works');
SELECT is((core.query_records('tupad',p_search=>'SyntheticTupadFixture',p_from=>'1980-01-02',p_to=>'1980-01-02')->>'total')::integer,1,'birth date filter works');
SELECT is((core.query_records('tupad',p_search=>'TupadSourceOnlyFixture')->>'total')::integer,1,'additional original fields are searchable');
SELECT is((SELECT id_number FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b201'),'000123','identifier leading zeroes are retained');
SELECT is((SELECT average_monthly_income FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b201'),'9OOO','source income text is retained');
SELECT is((SELECT average_monthly_income FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b202'),'none','none income text is retained');
SELECT is((SELECT raw_source->>'ORIGINAL DATE' FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b201'),'01/02/1980','original date spelling remains available');
SELECT is((SELECT metadata->'notes'->>0 FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b201'),'Retained footer','workbook notes are retained');
SELECT is((core.query_records('tupad',p_search=>'SyntheticTupadFixture',p_page=>99)->>'page')::integer,1,'out-of-range beneficiary pages are clamped');
SELECT lives_ok($$SELECT core.dataset_visualization_stats('tupad_beneficiaries')$$,'beneficiary charts are available');
SELECT lives_ok($$SELECT core.dataset_visualization_stats('research_requests')$$,'request charts remain available');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b103',true);
SELECT is((SELECT count(*)::integer FROM tupad.beneficiaries),0,'staff cannot read beneficiary rows');
SELECT is((core.query_records('tupad')->>'total')::integer,0,'record query respects staff RLS');
SELECT throws_ok($$INSERT INTO tupad.beneficiaries(department_id,first_name,last_name) VALUES((SELECT id FROM core.departments WHERE code='PESO'),'Forbidden','Insert')$$,'42501',NULL,'staff cannot insert beneficiaries');
SELECT throws_ok($$SELECT core.dataset_visualization_stats('tupad_beneficiaries')$$,'42501','Dataset access denied','staff cannot inspect beneficiary chart data');
SELECT throws_ok($$SELECT core.delete_record('tupad','00000000-0000-0000-0000-00000000b201')$$,'42501','DPO authority required','staff cannot delete beneficiaries');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b104',true);
SELECT is((SELECT count(*)::integer FROM tupad.beneficiaries),0,'system administrator cannot read beneficiary identities');
SELECT ok((core.system_dashboard_stats()->>'tupad')::integer>=2,'system dashboard exposes the beneficiary count');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b102',true);
SELECT is(core.can_submit_dataset('tupad_beneficiaries',(SELECT id FROM core.departments WHERE code='PESO')),true,'assigned focalperson can submit TUPAD data');
SELECT is((SELECT count(*)::integer FROM tupad.beneficiaries),0,'focalperson cannot read published beneficiary identities');
SELECT core.submit_data_submission('tupad_beneficiaries','import',jsonb_build_array(jsonb_build_object(
 'department_id',(SELECT id FROM core.departments WHERE code='PESO'),
 'remarks','Synthetic finding','source_number','003','first_name','SyntheticTupadFocal','middle_name','Middle','last_name','Three','extension_name','Jr.',
 'birth_date','1982-03-04','barangay','Fixture Barangay C','city_municipality','Siniloan','province','Laguna','district','4th',
 'id_type','National ID','id_number','000125','contact_number','09123456781','bank_account_number','0000000123',
 'beneficiary_type','Unemployed','occupation','Worker','sex','Female','civil_status','Married','age',44,'average_monthly_income','none','dependent','Child',
 'interested_in_skills_training','Yes','skills_training_needed','Baking',
 'raw_source',jsonb_build_object('BANK ACCOUNT NO.','0000000123','EXTRA COLUMN','Full source retained'),
 'metadata',jsonb_build_object('title','Synthetic workbook','footer','Synthetic footer'),
 'source_sheet','Beneficiaries','source_row_number',7
)),'tupad-sql-review-fixture.xlsx');
SELECT is(jsonb_array_length(core.my_data_submissions()),1,'focalperson sees their staged beneficiary upload');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b101',true);
SELECT is(core.data_submission_preview((SELECT id FROM core.data_submissions WHERE source_filename='tupad-sql-review-fixture.xlsx'))->0->'raw_source'->>'EXTRA COLUMN','Full source retained','review preview includes original source fields');
SELECT is(core.data_submission_preview((SELECT id FROM core.data_submissions WHERE source_filename='tupad-sql-review-fixture.xlsx'))->0->'metadata'->>'footer','Synthetic footer','review preview includes workbook context');
SELECT is((core.review_data_submission((SELECT id FROM core.data_submissions WHERE source_filename='tupad-sql-review-fixture.xlsx'),'approve')->>'accepted')::integer,1,'DPO approval commits staged beneficiaries');
SELECT ok((SELECT to_jsonb(t) @> '{"remarks":"Synthetic finding","source_number":"003","first_name":"SyntheticTupadFocal","middle_name":"Middle","last_name":"Three","extension_name":"Jr.","birth_date":"1982-03-04","barangay":"Fixture Barangay C","city_municipality":"Siniloan","province":"Laguna","district":"4th","id_type":"National ID","id_number":"000125","contact_number":"09123456781","bank_account_number":"0000000123","beneficiary_type":"Unemployed","occupation":"Worker","sex":"Female","civil_status":"Married","age":44,"average_monthly_income":"none","dependent":"Child","interested_in_skills_training":"Yes","skills_training_needed":"Baking","raw_source":{"BANK ACCOUNT NO.":"0000000123","EXTRA COLUMN":"Full source retained"},"metadata":{"title":"Synthetic workbook","footer":"Synthetic footer"},"source_sheet":"Beneficiaries","source_row_number":7}'::jsonb FROM tupad.beneficiaries t WHERE first_name='SyntheticTupadFocal'),'approval preserves every beneficiary and source field');
SELECT is((SELECT created_by FROM tupad.beneficiaries WHERE first_name='SyntheticTupadFocal'),'00000000-0000-0000-0000-00000000b102'::uuid,'approved beneficiary retains submitter attribution');
SELECT is((SELECT j.accepted_rows FROM core.import_jobs j JOIN tupad.beneficiaries b ON b.import_job_id=j.id WHERE b.first_name='SyntheticTupadFocal'),1,'reviewed import reports its committed row count');
SELECT throws_ok($$SELECT core.review_data_submission((SELECT id FROM core.data_submissions WHERE source_filename='tupad-sql-review-fixture.xlsx'),'approve')$$,'40001','Submission is no longer awaiting review','a submission cannot be committed twice');
SELECT lives_ok($$SELECT core.delete_record('tupad','00000000-0000-0000-0000-00000000b201')$$,'DPO can delete beneficiaries through the audited RPC');
SELECT is((SELECT count(*)::integer FROM tupad.beneficiaries WHERE id='00000000-0000-0000-0000-00000000b201'),0,'beneficiary was deleted');
SELECT is((SELECT count(*)::integer FROM core.audit_events WHERE action='record.deleted' AND target_id='00000000-0000-0000-0000-00000000b201'),1,'beneficiary deletion is audited');
SELECT throws_ok($$SELECT core.query_records('jobseekers')$$,'22023','Unknown module','adding TUPAD does not restore retired databases');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
