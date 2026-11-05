begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_schema('core', 'core schema exists');
select hasnt_schema('jobseekers', 'retired jobseeker schema is removed');
select has_schema('research', 'research schema exists');
select hasnt_schema('biometrics', 'retired biometric schema is removed');

select has_table('core', 'profiles', 'profiles table exists');
select has_table('core', 'user_dataset_grants', 'dataset grants table exists');
select has_table('core', 'audit_events', 'audit table exists');
select has_table('research', 'requests', 'research requests table exists');

select is((select count(*)::integer from core.modules where is_active), 2, 'request and TUPAD modules are active');
select is((select count(*)::integer from core.datasets where is_active), 2, 'request and TUPAD datasets are active');

select ok((select relrowsecurity from pg_class where oid = 'core.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'research.requests'::regclass), 'research requests has RLS enabled');

select is(core.can_access_dataset('research_requests'), false, 'anonymous database context has no dataset access');

select has_table('core', 'rate_limit_buckets', 'rate limit buckets table exists');
select ok((select relrowsecurity from pg_class where oid = 'core.rate_limit_buckets'::regclass), 'rate limit buckets have RLS enabled');
select has_function('core', 'check_rate_limit', array['text', 'text', 'integer', 'integer'], 'database rate limiter exists');
select has_function('core', 'query_records', array['text', 'text', 'text', 'text', 'date', 'date', 'text', 'boolean', 'integer', 'integer', 'text'], 'paginated record query exists');
select has_function('core', 'create_manual_record', array['text', 'jsonb'], 'manual record entry function exists');

select has_column('research', 'requests', 'request_type', 'requests retain their type');
select has_table('research', 'request_attachments', 'request attachments are retained');
select * from finish();
rollback;
