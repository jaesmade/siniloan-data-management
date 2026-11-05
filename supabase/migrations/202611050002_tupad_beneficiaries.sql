-- Register TUPAD without changing the request register or its governance history.
BEGIN;

CREATE SCHEMA tupad;

CREATE TABLE tupad.beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES core.departments(id),
  remarks text,
  source_number text,
  first_name text NOT NULL CHECK (length(trim(first_name)) > 0),
  middle_name text,
  last_name text NOT NULL CHECK (length(trim(last_name)) > 0),
  extension_name text,
  birth_date date,
  barangay text,
  city_municipality text,
  province text,
  district text,
  id_type text,
  id_number text,
  contact_number text,
  bank_account_number text,
  beneficiary_type text,
  occupation text,
  sex text,
  civil_status text,
  age integer,
  average_monthly_income text,
  dependent text,
  interested_in_skills_training text,
  skills_training_needed text,
  raw_source jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_source) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  source_sheet text,
  import_job_id uuid REFERENCES core.import_jobs(id),
  source_row_number integer CHECK (source_row_number > 0),
  created_by uuid REFERENCES core.profiles(id),
  updated_by uuid REFERENCES core.profiles(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tupad_beneficiaries_created_idx ON tupad.beneficiaries(created_at DESC, id DESC);
CREATE INDEX tupad_beneficiaries_department_idx ON tupad.beneficiaries(department_id);
CREATE INDEX tupad_beneficiaries_import_idx ON tupad.beneficiaries(import_job_id, source_row_number);

INSERT INTO core.modules(slug, name, description)
VALUES ('tupad', 'TUPAD Beneficiaries', 'TUPAD beneficiary records and complete uploaded source fields');
INSERT INTO core.datasets(module_id, slug, name, classification)
SELECT id, 'tupad_beneficiaries', 'TUPAD Beneficiaries', 'highly_restricted'
FROM core.modules WHERE slug = 'tupad';

ALTER TABLE tupad.beneficiaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tupad_beneficiaries_read ON tupad.beneficiaries FOR SELECT TO authenticated
USING (core.can_access_dataset('tupad_beneficiaries', 'read_only', department_id));
CREATE POLICY tupad_beneficiaries_write ON tupad.beneficiaries FOR ALL TO authenticated
USING (core.can_access_dataset('tupad_beneficiaries', 'read_write', department_id))
WITH CHECK (core.can_access_dataset('tupad_beneficiaries', 'read_write', department_id));
GRANT USAGE ON SCHEMA tupad TO authenticated, service_role;
GRANT SELECT, INSERT ON tupad.beneficiaries TO authenticated;
GRANT ALL ON tupad.beneficiaries TO service_role;

CREATE OR REPLACE FUNCTION core.query_records(p_module text,p_search text DEFAULT '',p_status text DEFAULT '',p_secondary text DEFAULT '',p_from date DEFAULT null,p_to date DEFAULT null,p_sort text DEFAULT 'created_at',p_desc boolean DEFAULT true,p_page integer DEFAULT 1,p_size integer DEFAULT 25,p_request_type text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE source_sql text; result jsonb;
BEGIN
 IF p_page<1 OR p_size NOT IN (25,50,100) OR p_sort NOT IN ('created_at','name','status','secondary','record_date','control_number') OR length(p_search)>200 OR length(p_secondary)>200 OR length(p_status)>200 OR p_request_type NOT IN ('','data_request','interview_request') OR p_from>p_to THEN RAISE EXCEPTION 'Invalid record filters or pagination' USING errcode='22023'; END IF;
 CASE p_module
 WHEN 'research' THEN source_sql:=$q$ SELECT to_jsonb(t) record,id,created_at,requester_name name,status::text status,coalesce(category,'') secondary,date_received record_date,coalesce(control_number,'') control_number,coalesce(request_type,'data_request') request_type,concat_ws(' ',control_number,requester_name,institution_office,research_title_purpose,status,category,request_type) search_text FROM research.requests t$q$;
 WHEN 'tupad' THEN source_sql:=$q$ SELECT to_jsonb(t) record,id,created_at,concat_ws(' ',first_name,middle_name,last_name,extension_name) name,coalesce(beneficiary_type,'') status,coalesce(barangay,'') secondary,birth_date record_date,coalesce(source_number,'') control_number,''::text request_type,concat_ws(' ',source_number,first_name,middle_name,last_name,extension_name,barangay,city_municipality,province,beneficiary_type,occupation,id_number,contact_number,raw_source::text) search_text FROM tupad.beneficiaries t WHERE archived_at IS NULL$q$;
 ELSE RAISE EXCEPTION 'Unknown module' USING errcode='22023'; END CASE;
 EXECUTE format($q$ WITH source AS MATERIALIZED (%s),matches AS MATERIALIZED (SELECT * FROM source WHERE strpos(lower(search_text),lower(trim(coalesce($1,''))))>0 AND ($2='' OR status=$2) AND strpos(lower(secondary),lower(trim(coalesce($3,''))))>0 AND ($4 IS NULL OR record_date >= $4) AND ($5 IS NULL OR record_date <= $5) AND ($8='' OR request_type=$8)),totals AS (SELECT count(*) total FROM matches),paging AS (SELECT total,least($6::bigint,greatest(1,(total+$7-1)/$7)) page FROM totals),page_rows AS (SELECT record FROM matches ORDER BY %I %s NULLS LAST,id %s LIMIT $7 OFFSET (SELECT (page-1)*$7 FROM paging)) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(record) FROM page_rows),'[]'::jsonb),'total',(SELECT total FROM paging),'page',(SELECT page FROM paging),'statuses',coalesce((SELECT jsonb_agg(status ORDER BY status) FROM (SELECT DISTINCT status FROM source WHERE status<>'') s),'[]'::jsonb))$q$,source_sql,p_sort,CASE WHEN p_desc THEN 'desc' ELSE 'asc' END,CASE WHEN p_desc THEN 'desc' ELSE 'asc' END) INTO result USING p_search,coalesce(p_status,''),p_secondary,p_from,p_to,p_page,p_size,p_request_type;
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION core.dataset_visualization_stats(requested_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE primary_data jsonb := '[]'::jsonb; secondary_data jsonb := '[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT core.can_access_dataset(requested_slug) THEN
  RAISE EXCEPTION 'Dataset access denied' USING errcode = '42501';
 END IF;
 IF requested_slug = 'research_requests' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', initcap(replace(label, '_', ' ')), 'value', value)), '[]'::jsonb)
  INTO primary_data FROM (
   SELECT status::text label, count(*)::integer value FROM research.requests
   WHERE archived_at IS NULL AND core.can_access_dataset(requested_slug, 'read_only', department_id)
   GROUP BY 1 ORDER BY 2 DESC
  ) stats;
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb)
  INTO secondary_data FROM (
   SELECT coalesce(nullif(trim(category), ''), 'Unspecified') label, count(*)::integer value FROM research.requests
   WHERE archived_at IS NULL AND core.can_access_dataset(requested_slug, 'read_only', department_id)
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ) stats;
 ELSIF requested_slug = 'tupad_beneficiaries' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb)
  INTO primary_data FROM (
   SELECT coalesce(nullif(trim(beneficiary_type), ''), 'Unspecified') label, count(*)::integer value FROM tupad.beneficiaries
   WHERE archived_at IS NULL AND core.can_access_dataset(requested_slug, 'read_only', department_id)
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ) stats;
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb)
  INTO secondary_data FROM (
   SELECT coalesce(nullif(trim(barangay), ''), 'Unspecified') label, count(*)::integer value FROM tupad.beneficiaries
   WHERE archived_at IS NULL AND core.can_access_dataset(requested_slug, 'read_only', department_id)
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ) stats;
 ELSE RAISE EXCEPTION 'Unknown dataset'; END IF;
 RETURN jsonb_build_object('primary', primary_data, 'secondary', secondary_data);
END;
$$;

CREATE OR REPLACE FUNCTION core.system_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM core.profiles WHERE id=auth.uid() AND role='system_admin' AND status='active') THEN RAISE EXCEPTION 'System Administrator access required' USING errcode='42501'; END IF;
 RETURN jsonb_build_object(
  'research',(SELECT count(*) FROM research.requests WHERE archived_at IS NULL),
  'tupad',(SELECT count(*) FROM tupad.beneficiaries WHERE archived_at IS NULL),
  'pending_accounts',(SELECT count(*) FROM core.profiles WHERE status='pending'),
  'recent_events',(SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'summary',summary,'occurred_at',occurred_at) ORDER BY occurred_at DESC),'[]'::jsonb) FROM (SELECT action,summary,occurred_at FROM core.audit_events WHERE dataset_id IS NULL AND (action LIKE 'auth.%' OR action LIKE 'account.%') ORDER BY occurred_at DESC LIMIT 8) e)
 );
END;
$$;

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
   ELSIF slug='tupad_beneficiaries' THEN
    INSERT INTO tupad.beneficiaries(
     department_id,remarks,source_number,first_name,middle_name,last_name,extension_name,birth_date,
     barangay,city_municipality,province,district,id_type,id_number,contact_number,bank_account_number,
     beneficiary_type,occupation,sex,civil_status,age,average_monthly_income,dependent,
     interested_in_skills_training,skills_training_needed,raw_source,metadata,source_sheet,
     import_job_id,source_row_number,created_by,updated_by
    ) VALUES (
     target_department,rec->>'remarks',rec->>'source_number',rec->>'first_name',rec->>'middle_name',rec->>'last_name',rec->>'extension_name',nullif(rec->>'birth_date','')::date,
     rec->>'barangay',rec->>'city_municipality',rec->>'province',rec->>'district',rec->>'id_type',rec->>'id_number',rec->>'contact_number',rec->>'bank_account_number',
     rec->>'beneficiary_type',rec->>'occupation',rec->>'sex',rec->>'civil_status',nullif(rec->>'age','')::integer,rec->>'average_monthly_income',rec->>'dependent',
     rec->>'interested_in_skills_training',rec->>'skills_training_needed',coalesce(rec->'raw_source','{}'::jsonb),coalesce(rec->'metadata','{}'::jsonb),rec->>'source_sheet',
     job,nullif(rec->>'source_row_number','')::integer,s.submitted_by,s.submitted_by
    );
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
END;
$$;

-- Keep all beneficiary source fields available to the DPO while retaining the bounded preview.
CREATE OR REPLACE FUNCTION core.data_submission_preview(p_submission_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT (
  SELECT coalesce(jsonb_agg(
   CASE WHEN d.slug='tupad_beneficiaries' THEN item ELSE item - 'metadata' - 'raw_source' END
   ORDER BY position), '[]'::jsonb)
  FROM jsonb_path_query(s.payload, '$[0 to 29]') WITH ORDINALITY AS preview(item, position)
 )
 FROM core.data_submissions s JOIN core.datasets d ON d.id=s.dataset_id
 WHERE s.id=p_submission_id AND s.status='pending_review';
$$;

CREATE OR REPLACE FUNCTION core.delete_record(p_module text,p_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset_slug text; did uuid; dep uuid; deleted boolean:=false;
BEGIN
 IF NOT core.is_active_admin('dpo') THEN RAISE EXCEPTION 'DPO authority required' USING errcode='42501'; END IF;
 dataset_slug := CASE p_module WHEN 'research' THEN 'research_requests' WHEN 'tupad' THEN 'tupad_beneficiaries' END;
 IF dataset_slug IS NULL THEN RAISE EXCEPTION 'Unknown database' USING errcode='22023'; END IF;
 SELECT id INTO did FROM core.datasets WHERE core.datasets.slug=dataset_slug;
 IF p_module='research' THEN DELETE FROM research.requests WHERE id=p_record_id RETURNING department_id INTO dep;
 ELSE DELETE FROM tupad.beneficiaries WHERE id=p_record_id RETURNING department_id INTO dep; END IF;
 deleted:=FOUND;
 IF NOT deleted THEN RAISE EXCEPTION 'Record not found' USING errcode='P0002'; END IF;
 INSERT INTO core.audit_events(actor_id,dataset_id,action,target_type,target_id,summary,metadata)
 VALUES(auth.uid(),did,'record.deleted','record',p_record_id::text,'Record permanently deleted',jsonb_build_object('module',p_module,'department_id',dep));
END;
$$;

INSERT INTO core.audit_events(action,target_type,summary,metadata)
VALUES ('dataset.registered','dataset','Registered TUPAD Beneficiaries',jsonb_build_object('dataset','tupad_beneficiaries'));
NOTIFY pgrst, 'reload schema';
COMMIT;
