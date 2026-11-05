-- Retire jobseeker and biometric data; retain both request types and all shared governance history.
-- This migration permanently removes the two retired schemas and their staged/imported source data.
BEGIN;

-- Keep registry identities so historic audit events and grant history retain their dataset references.
UPDATE core.user_dataset_grants SET revoked_at = now()
WHERE revoked_at IS NULL AND dataset_id IN (
  SELECT id FROM core.datasets WHERE slug IN ('jobseeker_registry', 'biometric_events')
);
UPDATE core.datasets SET is_active = false WHERE slug IN ('jobseeker_registry', 'biometric_events');
UPDATE core.modules SET is_active = false WHERE slug IN ('jobseekers', 'biometrics');
UPDATE core.modules SET name = 'Data & Interview Requests', description = 'Data and interview request intake, review, and release'
WHERE slug = 'research';
UPDATE core.datasets SET name = 'Data & Interview Requests' WHERE slug = 'research_requests';

-- Lock requests against writes during cleanup and abort if any preserved request changes.
LOCK TABLE research.requests IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE preserved_request_snapshot ON COMMIT DROP AS
SELECT id, to_jsonb(r) AS record FROM research.requests r;

-- Remove records, device subjects/locations, and jobseeker registrations with their schemas.
DROP SCHEMA IF EXISTS jobseekers CASCADE;
DROP SCHEMA IF EXISTS biometrics CASCADE;
DELETE FROM core.data_submissions WHERE dataset_id IN (
  SELECT id FROM core.datasets WHERE slug IN ('jobseeker_registry', 'biometric_events')
);
DELETE FROM core.import_jobs WHERE dataset_id IN (
  SELECT id FROM core.datasets WHERE slug IN ('jobseeker_registry', 'biometric_events')
);

-- Replace every RPC that referenced a retired schema before accepting further traffic.
CREATE OR REPLACE FUNCTION core.query_records(p_module text,p_search text DEFAULT '',p_status text DEFAULT '',p_secondary text DEFAULT '',p_from date DEFAULT null,p_to date DEFAULT null,p_sort text DEFAULT 'created_at',p_desc boolean DEFAULT true,p_page integer DEFAULT 1,p_size integer DEFAULT 25,p_request_type text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE source_sql text; result jsonb;
BEGIN
 IF p_page<1 OR p_size NOT IN (25,50,100) OR p_sort NOT IN ('created_at','name','status','secondary','record_date','control_number') OR length(p_search)>200 OR length(p_secondary)>200 OR length(p_status)>200 OR p_request_type NOT IN ('','data_request','interview_request') OR p_from>p_to THEN RAISE EXCEPTION 'Invalid record filters or pagination' USING errcode='22023'; END IF;
 CASE p_module
 WHEN 'research' THEN source_sql:=$q$ SELECT to_jsonb(t) record,id,created_at,requester_name name,status::text status,coalesce(category,'') secondary,date_received record_date,coalesce(control_number,'') control_number,coalesce(request_type,'data_request') request_type,concat_ws(' ',control_number,requester_name,institution_office,research_title_purpose,status,category,request_type) search_text FROM research.requests t$q$;
 ELSE RAISE EXCEPTION 'Unknown module' USING errcode='22023'; END CASE;
 EXECUTE format($q$ WITH source AS MATERIALIZED (%s),matches AS MATERIALIZED (SELECT * FROM source WHERE strpos(lower(search_text),lower(trim(coalesce($1,''))))>0 AND ($2='' OR status=$2) AND strpos(lower(secondary),lower(trim(coalesce($3,''))))>0 AND ($4 IS NULL OR record_date >= $4) AND ($5 IS NULL OR record_date <= $5) AND ($8='' OR request_type=$8)),totals AS (SELECT count(*) total FROM matches),paging AS (SELECT total,least($6::bigint,greatest(1,(total+$7-1)/$7)) page FROM totals),page_rows AS (SELECT record FROM matches ORDER BY %I %s NULLS LAST,id %s LIMIT $7 OFFSET (SELECT (page-1)*$7 FROM paging)) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(record) FROM page_rows),'[]'::jsonb),'total',(SELECT total FROM paging),'page',(SELECT page FROM paging),'statuses',coalesce((SELECT jsonb_agg(status ORDER BY status) FROM (SELECT DISTINCT status FROM source WHERE status<>'') s),'[]'::jsonb))$q$,source_sql,p_sort,CASE WHEN p_desc THEN 'desc' ELSE 'asc' END,CASE WHEN p_desc THEN 'desc' ELSE 'asc' END) INTO result USING p_search,coalesce(p_status,''),p_secondary,p_from,p_to,p_page,p_size,p_request_type;
 RETURN result;
END;
$$;


create or replace function core.dataset_visualization_stats(requested_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  primary_data jsonb := '[]'::jsonb;
  secondary_data jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not core.can_access_dataset(requested_slug) then
    raise exception 'Dataset access denied' using errcode = '42501';
  end if;

  if requested_slug = 'research_requests' then
    select coalesce(jsonb_agg(jsonb_build_object('label', initcap(replace(label, '_', ' ')), 'value', value)), '[]'::jsonb)
    into primary_data
    from (
      select status::text label, count(*)::integer value
      from research.requests
      where archived_at is null and core.can_access_dataset(requested_slug, 'read_only', department_id)
      group by 1 order by 2 desc
    ) stats;
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb)
    into secondary_data
    from (
      select coalesce(nullif(trim(category), ''), 'Unspecified') label, count(*)::integer value
      from research.requests
      where archived_at is null and core.can_access_dataset(requested_slug, 'read_only', department_id)
      group by 1 order by 2 desc limit 8
    ) stats;
  else
    raise exception 'Unknown dataset';
  end if;

  return jsonb_build_object('primary', primary_data, 'secondary', secondary_data);
end;
$$;

CREATE OR REPLACE FUNCTION core.system_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM core.profiles WHERE id=auth.uid() AND role='system_admin' AND status='active') THEN RAISE EXCEPTION 'System Administrator access required' USING errcode='42501'; END IF;
 RETURN jsonb_build_object(
  'research',(SELECT count(*) FROM research.requests WHERE archived_at IS NULL),
  'pending_accounts',(SELECT count(*) FROM core.profiles WHERE status='pending'),
  'recent_events',(SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'summary',summary,'occurred_at',occurred_at) ORDER BY occurred_at DESC),'[]'::jsonb) FROM (SELECT action,summary,occurred_at FROM core.audit_events WHERE dataset_id IS NULL AND (action LIKE 'auth.%' OR action LIKE 'account.%') ORDER BY occurred_at DESC LIMIT 8) e)
 );
END; $$;

CREATE OR REPLACE FUNCTION core.review_data_submission(p_submission_id uuid, p_decision text, p_feedback text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s core.data_submissions%rowtype; slug text; job uuid; accepted integer; rec jsonb; target_department uuid;
BEGIN
 IF NOT core.is_active_admin('dpo') THEN RAISE EXCEPTION 'DPO authorization required' USING errcode='42501'; END IF;
 IF p_decision NOT IN ('approve','return','reject') THEN RAISE EXCEPTION 'Choose approve, return, or reject' USING errcode='22023'; END IF;
 SELECT * INTO s FROM core.data_submissions WHERE id=p_submission_id FOR UPDATE;
 IF s.id IS NULL OR s.status<>'pending_review' THEN RAISE EXCEPTION 'Submission is no longer awaiting review' USING errcode='40001'; END IF;
 SELECT d.slug INTO slug FROM core.datasets d WHERE d.id=s.dataset_id;
 IF p_decision='approve' THEN
  IF s.submission_type='import' THEN
   SELECT id INTO job FROM core.import_jobs WHERE id=s.import_job_id;
   IF job IS NULL THEN
    INSERT INTO core.import_jobs(dataset_id,requested_by,status,source_filename,mapping_version,total_rows,started_at)
    VALUES(s.dataset_id,auth.uid(),'processing',coalesce(s.source_filename,'approved submission'),'reviewed-mapping-v1',s.total_rows,now()) RETURNING id INTO job;
   END IF;
  END IF;
  FOR rec IN SELECT value FROM jsonb_array_elements(s.payload) LOOP
   target_department := nullif(rec->>'department_id','')::uuid;
   IF slug='research_requests' THEN
    INSERT INTO research.requests(department_id,submitted_at,request_type,category,requester_name,institution_office,research_title_purpose,control_number,date_received,status,decision_notes,import_job_id,source_row_number,created_by,updated_by)
    VALUES(target_department,coalesce(nullif(rec->>'submitted_at','')::timestamptz,now()),CASE WHEN rec->>'request_type' IN ('data_request','interview_request') THEN rec->>'request_type' WHEN lower(trim(coalesce(rec->>'category','')))='interview request' THEN 'interview_request' ELSE 'data_request' END,nullif(rec->>'category',''),rec->>'requester_name',nullif(rec->>'institution_office',''),rec->>'research_title_purpose',nullif(rec->>'control_number',''),nullif(rec->>'date_received','')::date,'received',nullif(rec->>'decision_notes',''),job,nullif(rec->>'source_row_number','')::integer,s.submitted_by,s.submitted_by);
   ELSE RAISE EXCEPTION 'Unknown dataset'; END IF;
   accepted := coalesce(accepted,0)+1;
  END LOOP;
  IF job IS NOT NULL THEN
   UPDATE core.import_jobs SET status='completed',processed_rows=accepted,accepted_rows=accepted,rejected_rows=0,completed_at=now() WHERE id=job;
  END IF;
 END IF;
 UPDATE core.data_submissions SET status=CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'return' THEN 'returned' ELSE 'rejected' END,
 reviewer_id=auth.uid(),reviewer_feedback=nullif(left(trim(coalesce(p_feedback,'')),1000),''),reviewed_at=now(),import_job_id=job,committed_rows=accepted,revision=revision+CASE WHEN p_decision='return' THEN 1 ELSE 0 END
 WHERE id=s.id;
 INSERT INTO core.audit_events(actor_id,dataset_id,action,target_type,target_id,summary,metadata)
 VALUES(auth.uid(),s.dataset_id,'submission.'||p_decision,'data_submission',s.id::text,'DPO reviewed data submission',jsonb_build_object('submitter',s.submitted_by,'rows',s.total_rows,'feedback',left(coalesce(p_feedback,''),300)));
 RETURN jsonb_build_object('id',s.id,'status',CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'return' THEN 'returned' ELSE 'rejected' END,'accepted',coalesce(accepted,0));
END; $$;

CREATE OR REPLACE FUNCTION core.stage_manual_submission(p_module text,p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slug text; item jsonb;
BEGIN
 IF p_module IS DISTINCT FROM 'research' THEN RAISE EXCEPTION 'Unknown database'; END IF;
 slug := 'research_requests';
 IF NOT core.can_submit_dataset(slug,nullif(p_data->>'department_id','')::uuid) THEN RAISE EXCEPTION 'Assigned dataset submission access required' USING errcode='42501'; END IF;

  IF coalesce(p_data->>'request_type','') NOT IN ('data_request','interview_request') THEN RAISE EXCEPTION 'Choose a request type' USING errcode='22023'; END IF;
  item:=jsonb_build_object('department_id',p_data->>'department_id','submitted_at',now(),'request_type',p_data->>'request_type','category',p_data->>'category','requester_name',p_data->>'requester_name','institution_office',p_data->>'institution_office','research_title_purpose',p_data->>'research_title_purpose','date_received',p_data->>'date_received','status','received');

 RETURN core.submit_data_submission(slug,'manual',jsonb_build_array(item),NULL);
END; $$;

create or replace function core.update_manual_record(
  p_module text, p_record_id uuid, p_version integer, p_data jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  dataset_slug text;
  dataset_id uuid;
  new_department uuid;
  old_department uuid;
  current_version integer;
  record_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_record_id is null or p_version is null or p_version < 1 then
    raise exception 'Invalid record version' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 32768 then
    raise exception 'Invalid record data' using errcode = '22023';
  end if;
  begin new_department := nullif(p_data ->> 'department_id', '')::uuid;
  exception when invalid_text_representation then raise exception 'Choose a valid department' using errcode = '22023'; end;
  if new_department is null or not exists (select 1 from core.departments where id = new_department and is_active) then
    raise exception 'Choose an active department' using errcode = '22023';
  end if;

  if p_module is distinct from 'research' then raise exception 'Unknown database' using errcode = '22023'; end if;
  dataset_slug := 'research_requests';
  select id into dataset_id from core.datasets where slug = dataset_slug and is_active;
  if dataset_id is null then raise exception 'Database is unavailable' using errcode = '22023'; end if;

  select department_id, version into old_department, current_version
    from research.requests where id = p_record_id and archived_at is null for update;

  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not core.can_access_dataset(dataset_slug, 'read_write', old_department)
     or not core.can_access_dataset(dataset_slug, 'read_write', new_department) then
    raise exception 'Read/write access is required for both departments' using errcode = '42501';
  end if;
  if current_version <> p_version then
    raise exception 'Record changed while editing' using errcode = '40001';
  end if;

    if length(trim(coalesce(p_data->>'requester_name', ''))) not between 2 and 160
       or length(trim(coalesce(p_data->>'research_title_purpose', ''))) not between 2 and 1000 then
      raise exception 'Requester and research title or purpose are required' using errcode = '22023';
    end if;
    if coalesce(p_data->>'request_type', '') not in ('data_request', 'interview_request') then
      raise exception 'Choose a request type' using errcode = '22023';
    end if;
    update research.requests
    set department_id = new_department,
        request_type = p_data->>'request_type',
        category = nullif(trim(p_data->>'category'), ''),
        requester_name = trim(p_data->>'requester_name'),
        institution_office = nullif(trim(p_data->>'institution_office'), ''),
        research_title_purpose = trim(p_data->>'research_title_purpose'),
        control_number = nullif(trim(p_data->>'control_number'), ''),
        date_received = nullif(p_data->>'date_received', '')::date,
        status = coalesce(nullif(p_data->>'status', '')::research.request_status, 'received'),
        decision_notes = nullif(trim(p_data->>'decision_notes'), ''),
        updated_by = auth.uid(), updated_at = now(), version = version + 1
    where id = p_record_id;
    select requester_name into record_label from research.requests where id = p_record_id;

  insert into core.audit_events (actor_id, dataset_id, action, target_type, target_id, summary, metadata)
  values (auth.uid(), dataset_id, 'record.updated', 'record', p_record_id::text,
          'Record edited', jsonb_build_object('module', p_module, 'label', record_label,
                                              'old_department_id', old_department,
                                              'department_id', new_department,
                                              'version', p_version + 1));
  return p_record_id;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Enter a valid date and time' using errcode = '22007';
  when string_data_right_truncation then
    raise exception 'One or more values are too long' using errcode = '22001';
end;
$$;

CREATE OR REPLACE FUNCTION core.delete_record(p_module text,p_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slug text; did uuid; dep uuid; deleted boolean:=false;
BEGIN
 IF NOT core.is_active_admin('dpo') THEN RAISE EXCEPTION 'DPO authority required' USING errcode='42501'; END IF;
 IF p_module IS DISTINCT FROM 'research' THEN RAISE EXCEPTION 'Unknown database' USING errcode='22023'; END IF;
 slug:='research_requests';
 SELECT id INTO did FROM core.datasets WHERE core.datasets.slug=slug;
 DELETE FROM research.requests WHERE id=p_record_id RETURNING department_id INTO dep;
 deleted:=FOUND;
 IF NOT deleted THEN RAISE EXCEPTION 'Record not found' USING errcode='P0002'; END IF;
 INSERT INTO core.audit_events(actor_id,dataset_id,action,target_type,target_id,summary,metadata) VALUES(auth.uid(),did,'record.deleted','record',p_record_id::text,'Record permanently deleted',jsonb_build_object('module',p_module,'department_id',dep));
END; $$;

CREATE OR REPLACE FUNCTION core.create_manual_record(p_module text, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_module IS DISTINCT FROM 'research' THEN
    RAISE EXCEPTION 'Unknown database' USING errcode = '22023';
  END IF;
  RETURN core.create_research_request(p_data);
END;
$$;
-- Keep these tombstones hidden from dataset pickers; their audit references remain valid.
DROP POLICY IF EXISTS datasets_read ON core.datasets;
CREATE POLICY datasets_read ON core.datasets FOR SELECT TO authenticated USING (
  is_active AND (core.is_active_admin('data_steward') OR core.can_access_dataset(slug)
    OR EXISTS (SELECT 1 FROM core.user_dataset_grants g
      WHERE g.user_id = auth.uid() AND g.dataset_id = core.datasets.id
        AND g.revoked_at IS NULL AND g.access_mode = 'read_write'))
);

DO $$
BEGIN
  IF EXISTS (
    (SELECT id, record FROM preserved_request_snapshot
     EXCEPT SELECT id, to_jsonb(r) FROM research.requests r)
    UNION ALL
    (SELECT id, to_jsonb(r) FROM research.requests r
     EXCEPT SELECT id, record FROM preserved_request_snapshot)
  ) THEN RAISE EXCEPTION 'Request preservation check failed'; END IF;
END;
$$;

INSERT INTO core.audit_events(action, target_type, summary, metadata)
VALUES ('dataset.retired', 'dataset', 'Retired jobseeker and biometric databases; retained data and interview requests',
  jsonb_build_object('retired_datasets', ARRAY['jobseeker_registry', 'biometric_events'],
    'retained_dataset', 'research_requests', 'retained_request_count', (SELECT count(*) FROM research.requests)));
NOTIFY pgrst, 'reload schema';
COMMIT;
