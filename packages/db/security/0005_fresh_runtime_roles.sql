-- FRESH DATABASE ONLY. Roles/passwords must be provisioned privately first.
-- Select apex.fresh_database_release='2026-10-04-empty-install' on this connection.
-- This deliberately refuses a catalog with prior policies or unknown objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE role_name text; item record;
  expected text[] := ARRAY['article','article_tag','article_driver','article_team','article_race','author',
    'app_user','follow','saved','circuit','driver','driver_team_history','image','lap','pit_stop','qualifying',
    'race','result','season','session','sprint_result','standing_driver','standing_team','tag','team','video',
    'prediction','prediction_attempt','event_log','ingestion_run','newsletter_edition','source_snapshot',
    'source_snapshot_event','job_lease','editorial_audit'];
BEGIN
  IF current_setting('apex.fresh_database_release', true) IS DISTINCT FROM '2026-10-04-empty-install' THEN
    RAISE EXCEPTION 'Select the explicitly reviewed fresh database release.';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['apex_runtime','apex_worker','apex_public'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=role_name::regrole)
      OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=role_name::regrole)
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=role_name::regrole) THEN
      RAISE EXCEPTION 'Provision a dedicated non-owner NOINHERIT NOREPLICATION NOBYPASSRLS role: %.', role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public') THEN RAISE EXCEPTION 'Prior policies exist; this is not a fresh security install.'; END IF;
  FOR item IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
    IF item.relkind='S' AND item.relname='event_log_id_seq' AND pg_get_serial_sequence('public.event_log','id')='public.event_log_id_seq' THEN CONTINUE; END IF;
    IF item.relkind NOT IN ('r','p') OR NOT item.relname = ANY(expected) THEN RAISE EXCEPTION 'Unreviewed fresh catalog relation: %.', item.relname; END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=format('public.%I',item.relname)::regclass AND attnum>0 AND NOT attisdropped AND attidentity <> '') THEN
      RAISE EXCEPTION 'Unreviewed fresh identity/sequence privilege on %.', item.relname;
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY expected LOOP
    IF to_regclass(format('public.%I',role_name)) IS NULL THEN RAISE EXCEPTION 'Fresh schema table absent: %.',role_name; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef) THEN
    RAISE EXCEPTION 'Unreviewed SECURITY DEFINER routine exists.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclobjtype IN ('r','S') AND (d.defaclnamespace=0 OR d.defaclnamespace='public'::regnamespace)
      AND a.grantee<>d.defaclrole) THEN RAISE EXCEPTION 'Unreviewed future table/sequence grants exist; reconcile template defaults first.'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOR item IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
        IF has_table_privilege(role_name,item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(role_name,item.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'Unreviewed managed browser role grants exist: % on %.',role_name,item.relname;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, apex_runtime, apex_worker, apex_public;
GRANT USAGE ON SCHEMA public TO apex_runtime, apex_worker, apex_public;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, apex_runtime, apex_worker, apex_public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, apex_runtime, apex_worker, apex_public;
GRANT USAGE ON SEQUENCE public.event_log_id_seq TO apex_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, apex_runtime, apex_worker, apex_public;
DO $$ DECLARE item record; columns text; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO columns FROM pg_attribute
      WHERE attrelid=format('public.%I',item.tablename)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC, apex_runtime, apex_worker, apex_public',columns,item.tablename);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.tablename);
  END LOOP;
END $$;

-- Public race facts are read-only. Fan identities, receipts and operational
-- ledgers are never granted to the public role or anonymous API roles.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['circuit','driver','driver_team_history','image','lap','pit_stop','qualifying','race',
    'result','season','session','sprint_result','standing_driver','standing_team','tag','team'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO apex_public, apex_runtime, apex_worker',t);
    EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO apex_public, apex_runtime, apex_worker USING (true)',t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO apex_worker',t);
    EXECUTE format('CREATE POLICY worker_insert ON public.%I FOR INSERT TO apex_worker WITH CHECK (true)',t);
    EXECUTE format('CREATE POLICY worker_update ON public.%I FOR UPDATE TO apex_worker USING (true) WITH CHECK (true)',t);
    EXECUTE format('CREATE POLICY worker_delete ON public.%I FOR DELETE TO apex_worker USING (true)',t);
  END LOOP;
END $$;
GRANT SELECT ON video TO apex_public, apex_runtime, apex_worker;
GRANT INSERT, UPDATE, DELETE ON video TO apex_worker;
CREATE POLICY public_read ON video FOR SELECT TO apex_public, apex_runtime USING (availability='public');
CREATE POLICY worker_all ON video FOR ALL TO apex_worker USING (true) WITH CHECK (true);
GRANT SELECT ON article TO apex_public, apex_runtime, apex_worker;
GRANT INSERT, UPDATE ON article TO apex_runtime;
CREATE POLICY public_read ON article FOR SELECT TO apex_public, apex_worker USING
  (published_at IS NOT NULL AND published_at<=now() AND (embargo_until IS NULL OR embargo_until<=now()) AND NOT is_premium);
CREATE POLICY editorial_read ON article FOR SELECT TO apex_runtime USING (true);
CREATE POLICY editorial_insert ON article FOR INSERT TO apex_runtime WITH CHECK (true);
CREATE POLICY editorial_update ON article FOR UPDATE TO apex_runtime USING (true) WITH CHECK (true);
GRANT SELECT (id,slug,name,bio_md,avatar_url,twitter,instagram,created_at) ON author TO apex_public, apex_runtime, apex_worker;
CREATE POLICY public_read ON author FOR SELECT TO apex_public, apex_runtime, apex_worker USING (true);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['article_tag','article_driver','article_team','article_race'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO apex_public, apex_runtime, apex_worker',t);
    EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO apex_public, apex_runtime, apex_worker USING (EXISTS (SELECT 1 FROM article a WHERE a.id=%I.article_id))',t,t);
  END LOOP;
END $$;

GRANT SELECT ON prediction TO apex_runtime, apex_worker;
GRANT INSERT (client_id,handle,season,round,race_slug,picks,updated_at) ON prediction TO apex_runtime;
GRANT UPDATE (handle,race_slug,picks,updated_at) ON prediction TO apex_runtime;
GRANT UPDATE (score,scored_at,score_source_version) ON prediction TO apex_worker;
CREATE POLICY runtime_read ON prediction FOR SELECT TO apex_runtime, apex_worker USING (true);
CREATE POLICY runtime_insert ON prediction FOR INSERT TO apex_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON prediction FOR UPDATE TO apex_runtime, apex_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON prediction_attempt TO apex_runtime;
CREATE POLICY runtime_read ON prediction_attempt FOR SELECT TO apex_runtime USING (true);
CREATE POLICY runtime_insert ON prediction_attempt FOR INSERT TO apex_runtime WITH CHECK (true);
GRANT SELECT, INSERT ON editorial_audit TO apex_runtime;
CREATE POLICY editorial_read ON editorial_audit FOR SELECT TO apex_runtime USING (true);
CREATE POLICY editorial_insert ON editorial_audit FOR INSERT TO apex_runtime WITH CHECK (true);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['source_snapshot','job_lease','newsletter_edition','ingestion_run','event_log'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO apex_worker',t);
    EXECUTE format('CREATE POLICY worker_all ON public.%I FOR ALL TO apex_worker USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON source_snapshot_event TO apex_worker;
CREATE POLICY worker_read ON source_snapshot_event FOR SELECT TO apex_worker USING (true);
CREATE POLICY worker_insert ON source_snapshot_event FOR INSERT TO apex_worker WITH CHECK (true);
-- Release deletes only its matching lease token; no broad table deletion.
GRANT DELETE ON job_lease TO apex_worker;
-- Web reads only the accepted equality marker to hide obsolete grades.
GRANT SELECT (source,scope,content_hash) ON source_snapshot TO apex_runtime;
CREATE POLICY runtime_grade_marker_read ON source_snapshot FOR SELECT TO apex_runtime USING (true);

DO $$ DECLARE role_name text; item record; forbidden text := 'TRUNCATE,REFERENCES,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN forbidden := forbidden || ',MAINTAIN'; END IF;
  FOREACH role_name IN ARRAY ARRAY['apex_runtime','apex_worker','apex_public'] LOOP
    IF has_schema_privilege(role_name,'public','CREATE') THEN RAISE EXCEPTION 'Unexpected schema CREATE for %.',role_name; END IF;
    FOR item IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
      IF has_table_privilege(role_name,item.oid,forbidden) OR has_any_column_privilege(role_name,item.oid,'REFERENCES') THEN
        RAISE EXCEPTION 'Unreviewed privileged relation capability for % on %.',role_name,item.relname;
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
