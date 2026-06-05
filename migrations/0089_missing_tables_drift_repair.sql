-- 0089_missing_tables_drift_repair.sql
--
-- Additive, idempotent drift repair. 18 tables declared in shared/schema/*.ts
-- had migrations that were presumed-applied by the bootstrap but whose DDL
-- never executed on dev OR prod (same failure class as 0087 -> 0088). Several
-- are actively queried (document provisioning/approvals, project folders,
-- project lifecycle, QuickBooks link cascade history) and 500 at runtime.
--
-- This recreates the canonical CURRENT shape of each table (CREATE TABLE IF
-- NOT EXISTS with full column list, sequences, defaults, constraints in
-- duplicate-safe DO blocks, indexes IF NOT EXISTS). DDL captured from a
-- scratch DB materialized via `drizzle-kit push` from shared/schema.ts, so it
-- matches the code exactly. Dependency `folder_lifecycle_mode_enum` already
-- exists in dev and prod. Safe no-op on a healthy DB.
--
-- Registered with a multi-artifact canary probe in scripts/drizzle-bootstrap.ts
-- so a partial/absent apply replays instead of being presumed complete.

CREATE TABLE IF NOT EXISTS public.dashboard_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    layout jsonb DEFAULT '{}'::jsonb NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.dashboard_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.dashboard_preferences_id_seq OWNED BY public.dashboard_preferences.id;

CREATE TABLE IF NOT EXISTS public.document_approval_requirements (
    id integer NOT NULL,
    taxonomy_key text NOT NULL,
    file_name_pattern text,
    display_name text NOT NULL,
    description text,
    approver_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    requires_all_approvers boolean DEFAULT false NOT NULL,
    extract_spec jsonb,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.document_approval_requirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.document_approval_requirements_id_seq OWNED BY public.document_approval_requirements.id;

CREATE TABLE IF NOT EXISTS public.eng_transmittal_items (
    id integer NOT NULL,
    transmittal_id integer NOT NULL,
    deliverable_id integer,
    drawing_id integer,
    revision text,
    released_for_at_issue text,
    notes text
);

CREATE SEQUENCE IF NOT EXISTS public.eng_transmittal_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.eng_transmittal_items_id_seq OWNED BY public.eng_transmittal_items.id;

CREATE TABLE IF NOT EXISTS public.eng_transmittals (
    id integer NOT NULL,
    project_id integer NOT NULL,
    transmittal_number text NOT NULL,
    title text NOT NULL,
    purpose text NOT NULL,
    recipient_name text NOT NULL,
    recipient_org text,
    recipient_user_id integer,
    issued_by_user_id integer NOT NULL,
    issued_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text,
    project_eng_stage_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.eng_transmittals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.eng_transmittals_id_seq OWNED BY public.eng_transmittals.id;

CREATE TABLE IF NOT EXISTS public.folder_taxonomy (
    id integer NOT NULL,
    internal_key text NOT NULL,
    display_name text NOT NULL,
    parent_key text,
    lifecycle_mode public.folder_lifecycle_mode_enum NOT NULL,
    stage_code text,
    disciplines jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.folder_taxonomy_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.folder_taxonomy_id_seq OWNED BY public.folder_taxonomy.id;

CREATE TABLE IF NOT EXISTS public.import_history (
    id integer NOT NULL,
    project_id integer,
    started_by_user_id integer,
    source_type text NOT NULL,
    status text NOT NULL,
    records_processed integer,
    error_count integer DEFAULT 0 NOT NULL,
    error_summary text,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.import_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.import_history_id_seq OWNED BY public.import_history.id;

CREATE TABLE IF NOT EXISTS public.om_handover_history (
    id integer NOT NULL,
    om_handover_id integer NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by_user_id integer,
    changed_by_role text,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    reason text,
    details_json jsonb
);

CREATE SEQUENCE IF NOT EXISTS public.om_handover_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.om_handover_history_id_seq OWNED BY public.om_handover_history.id;

CREATE TABLE IF NOT EXISTS public.pending_approval_history (
    id integer NOT NULL,
    pending_approval_id integer NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by_user_id integer,
    changed_by_role text,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    reason text,
    details_json jsonb
);

CREATE SEQUENCE IF NOT EXISTS public.pending_approval_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.pending_approval_history_id_seq OWNED BY public.pending_approval_history.id;

CREATE TABLE IF NOT EXISTS public.post_handover_reviews (
    id integer NOT NULL,
    project_id integer NOT NULL,
    review_number integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_date date,
    actual_review_date date,
    review_summary text,
    performance_notes text,
    client_feedback text,
    lessons_captured jsonb DEFAULT '[]'::jsonb,
    pm_sign_off_user_id integer,
    pm_sign_off_at timestamp without time zone,
    coo_sign_off_user_id integer,
    coo_sign_off_at timestamp without time zone,
    created_by_user_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

CREATE SEQUENCE IF NOT EXISTS public.post_handover_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.post_handover_reviews_id_seq OWNED BY public.post_handover_reviews.id;

CREATE TABLE IF NOT EXISTS public.project_delivery_milestones (
    id integer NOT NULL,
    project_id integer NOT NULL,
    milestone_code text NOT NULL,
    milestone_name text NOT NULL,
    phase_code text,
    sort_order integer DEFAULT 0 NOT NULL,
    planned_date date,
    actual_date date,
    status text DEFAULT 'planned'::text NOT NULL,
    owner_user_id integer,
    blocker text,
    blocker_set_at timestamp without time zone,
    blocker_cleared_at timestamp without time zone,
    evidence_link text,
    notes text,
    created_by_user_id integer,
    completed_by_user_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

CREATE SEQUENCE IF NOT EXISTS public.project_delivery_milestones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.project_delivery_milestones_id_seq OWNED BY public.project_delivery_milestones.id;

CREATE TABLE IF NOT EXISTS public.project_folders (
    id integer NOT NULL,
    project_id integer NOT NULL,
    taxonomy_key text NOT NULL,
    drive_id text,
    item_id text,
    sharepoint_path text,
    web_url text,
    provisioned_at timestamp without time zone,
    provisioned_by_user_id integer,
    last_verified_at timestamp without time zone,
    verify_error text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.project_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.project_folders_id_seq OWNED BY public.project_folders.id;

CREATE TABLE IF NOT EXISTS public.project_hold_metadata (
    id integer NOT NULL,
    project_id integer NOT NULL,
    status text NOT NULL,
    reason text,
    owner_user_id integer,
    review_date text,
    dependency text,
    decision_owner_user_id integer,
    evidence_link text,
    override_reason text,
    created_by_user_id integer,
    created_by_role text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    resolved_by_user_id integer,
    resolution_note text
);

CREATE SEQUENCE IF NOT EXISTS public.project_hold_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.project_hold_metadata_id_seq OWNED BY public.project_hold_metadata.id;

CREATE TABLE IF NOT EXISTS public.project_milestones (
    id integer NOT NULL,
    project_id integer NOT NULL,
    name text NOT NULL,
    due_date date,
    completed_at timestamp without time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.project_milestones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.project_milestones_id_seq OWNED BY public.project_milestones.id;

CREATE TABLE IF NOT EXISTS public.project_stage_exception_history (
    id integer NOT NULL,
    exception_id integer NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by_user_id integer,
    changed_by_role text,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    reason text,
    details_json jsonb
);

CREATE SEQUENCE IF NOT EXISTS public.project_stage_exception_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.project_stage_exception_history_id_seq OWNED BY public.project_stage_exception_history.id;

CREATE TABLE IF NOT EXISTS public.qb_link_proposed_cascade_history (
    id integer NOT NULL,
    cascade_id integer NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by_user_id integer,
    changed_by_role text,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    reason text,
    details_json jsonb
);

CREATE SEQUENCE IF NOT EXISTS public.qb_link_proposed_cascade_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.qb_link_proposed_cascade_history_id_seq OWNED BY public.qb_link_proposed_cascade_history.id;

CREATE TABLE IF NOT EXISTS public.standup_sessions (
    id integer NOT NULL,
    schedule_id integer,
    facilitator_user_id integer,
    session_date text NOT NULL,
    total_seconds integer DEFAULT 0 NOT NULL,
    participant_count integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    avg_seconds_per_speaker integer DEFAULT 0 NOT NULL,
    blocker_count integer DEFAULT 0 NOT NULL,
    task_movements jsonb DEFAULT '[]'::jsonb NOT NULL,
    mood_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    facilitator_notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.standup_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.standup_sessions_id_seq OWNED BY public.standup_sessions.id;

CREATE TABLE IF NOT EXISTS public.template_overrides (
    id integer NOT NULL,
    template_type text NOT NULL,
    source_template_id integer NOT NULL,
    project_id integer,
    override_data jsonb NOT NULL,
    override_reason text NOT NULL,
    overridden_by integer,
    overridden_at timestamp without time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.template_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.template_overrides_id_seq OWNED BY public.template_overrides.id;

CREATE TABLE IF NOT EXISTS public.vat_period_locks (
    id integer NOT NULL,
    period_month date NOT NULL,
    vat_201_submission_ref text,
    locked_at timestamp without time zone DEFAULT now() NOT NULL,
    locked_by_user_id integer,
    output_vat_total numeric(15,2),
    input_vat_total numeric(15,2),
    unlocked_at timestamp without time zone,
    unlocked_by_user_id integer,
    unlock_reason text,
    notes text
);

CREATE SEQUENCE IF NOT EXISTS public.vat_period_locks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vat_period_locks_id_seq OWNED BY public.vat_period_locks.id;

ALTER TABLE ONLY public.dashboard_preferences ALTER COLUMN id SET DEFAULT nextval('public.dashboard_preferences_id_seq'::regclass);

ALTER TABLE ONLY public.document_approval_requirements ALTER COLUMN id SET DEFAULT nextval('public.document_approval_requirements_id_seq'::regclass);

ALTER TABLE ONLY public.eng_transmittal_items ALTER COLUMN id SET DEFAULT nextval('public.eng_transmittal_items_id_seq'::regclass);

ALTER TABLE ONLY public.eng_transmittals ALTER COLUMN id SET DEFAULT nextval('public.eng_transmittals_id_seq'::regclass);

ALTER TABLE ONLY public.folder_taxonomy ALTER COLUMN id SET DEFAULT nextval('public.folder_taxonomy_id_seq'::regclass);

ALTER TABLE ONLY public.import_history ALTER COLUMN id SET DEFAULT nextval('public.import_history_id_seq'::regclass);

ALTER TABLE ONLY public.om_handover_history ALTER COLUMN id SET DEFAULT nextval('public.om_handover_history_id_seq'::regclass);

ALTER TABLE ONLY public.pending_approval_history ALTER COLUMN id SET DEFAULT nextval('public.pending_approval_history_id_seq'::regclass);

ALTER TABLE ONLY public.post_handover_reviews ALTER COLUMN id SET DEFAULT nextval('public.post_handover_reviews_id_seq'::regclass);

ALTER TABLE ONLY public.project_delivery_milestones ALTER COLUMN id SET DEFAULT nextval('public.project_delivery_milestones_id_seq'::regclass);

ALTER TABLE ONLY public.project_folders ALTER COLUMN id SET DEFAULT nextval('public.project_folders_id_seq'::regclass);

ALTER TABLE ONLY public.project_hold_metadata ALTER COLUMN id SET DEFAULT nextval('public.project_hold_metadata_id_seq'::regclass);

ALTER TABLE ONLY public.project_milestones ALTER COLUMN id SET DEFAULT nextval('public.project_milestones_id_seq'::regclass);

ALTER TABLE ONLY public.project_stage_exception_history ALTER COLUMN id SET DEFAULT nextval('public.project_stage_exception_history_id_seq'::regclass);

ALTER TABLE ONLY public.qb_link_proposed_cascade_history ALTER COLUMN id SET DEFAULT nextval('public.qb_link_proposed_cascade_history_id_seq'::regclass);

ALTER TABLE ONLY public.standup_sessions ALTER COLUMN id SET DEFAULT nextval('public.standup_sessions_id_seq'::regclass);

ALTER TABLE ONLY public.template_overrides ALTER COLUMN id SET DEFAULT nextval('public.template_overrides_id_seq'::regclass);

ALTER TABLE ONLY public.vat_period_locks ALTER COLUMN id SET DEFAULT nextval('public.vat_period_locks_id_seq'::regclass);

DO $$ BEGIN
  ALTER TABLE ONLY public.dashboard_preferences
    ADD CONSTRAINT dashboard_preferences_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.dashboard_preferences
    ADD CONSTRAINT dashboard_preferences_user_id_unique UNIQUE (user_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.document_approval_requirements
    ADD CONSTRAINT document_approval_requirements_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittal_items
    ADD CONSTRAINT eng_transmittal_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittals
    ADD CONSTRAINT eng_transmittals_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.folder_taxonomy
    ADD CONSTRAINT folder_taxonomy_internal_key_unique UNIQUE (internal_key);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.folder_taxonomy
    ADD CONSTRAINT folder_taxonomy_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.import_history
    ADD CONSTRAINT import_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.om_handover_history
    ADD CONSTRAINT om_handover_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.pending_approval_history
    ADD CONSTRAINT pending_approval_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.post_handover_reviews
    ADD CONSTRAINT post_handover_reviews_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_delivery_milestones
    ADD CONSTRAINT project_delivery_milestones_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_folders
    ADD CONSTRAINT project_folders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_milestones
    ADD CONSTRAINT project_milestones_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_stage_exception_history
    ADD CONSTRAINT project_stage_exception_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.qb_link_proposed_cascade_history
    ADD CONSTRAINT qb_link_proposed_cascade_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.standup_sessions
    ADD CONSTRAINT standup_sessions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.template_overrides
    ADD CONSTRAINT template_overrides_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.vat_period_locks
    ADD CONSTRAINT vat_period_locks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

CREATE INDEX IF NOT EXISTS doc_approval_req_active_idx ON public.document_approval_requirements USING btree (active);

CREATE INDEX IF NOT EXISTS doc_approval_req_taxonomy_idx ON public.document_approval_requirements USING btree (taxonomy_key);

CREATE UNIQUE INDEX IF NOT EXISTS folder_taxonomy_internal_key_idx ON public.folder_taxonomy USING btree (internal_key);

CREATE INDEX IF NOT EXISTS folder_taxonomy_lifecycle_idx ON public.folder_taxonomy USING btree (lifecycle_mode);

CREATE INDEX IF NOT EXISTS folder_taxonomy_parent_idx ON public.folder_taxonomy USING btree (parent_key);

CREATE INDEX IF NOT EXISTS folder_taxonomy_stage_idx ON public.folder_taxonomy USING btree (stage_code);

CREATE INDEX IF NOT EXISTS idx_project_delivery_milestones_project ON public.project_delivery_milestones USING btree (project_id);

CREATE INDEX IF NOT EXISTS idx_project_hold_metadata_open ON public.project_hold_metadata USING btree (project_id, resolved_at);

CREATE INDEX IF NOT EXISTS idx_project_hold_metadata_project ON public.project_hold_metadata USING btree (project_id);

CREATE INDEX IF NOT EXISTS idx_vat_period_locks_active ON public.vat_period_locks USING btree (period_month) WHERE (unlocked_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_vat_period_locks_period ON public.vat_period_locks USING btree (period_month);

CREATE INDEX IF NOT EXISTS import_history_project_started_at_idx ON public.import_history USING btree (project_id, started_at);

CREATE INDEX IF NOT EXISTS pah_pending_approval_id_idx ON public.pending_approval_history USING btree (pending_approval_id);

CREATE INDEX IF NOT EXISTS project_folders_project_idx ON public.project_folders USING btree (project_id);

CREATE UNIQUE INDEX IF NOT EXISTS project_folders_project_taxonomy_uq ON public.project_folders USING btree (project_id, taxonomy_key);

CREATE INDEX IF NOT EXISTS project_folders_taxonomy_idx ON public.project_folders USING btree (taxonomy_key);

CREATE INDEX IF NOT EXISTS pseh_exception_id_idx ON public.project_stage_exception_history USING btree (exception_id);

CREATE INDEX IF NOT EXISTS qlpch_cascade_id_idx ON public.qb_link_proposed_cascade_history USING btree (cascade_id);

CREATE INDEX IF NOT EXISTS standup_sessions_schedule_date_idx ON public.standup_sessions USING btree (schedule_id, session_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_delivery_milestones_project_code ON public.project_delivery_milestones USING btree (project_id, milestone_code) WHERE (deleted_at IS NULL);

DO $$ BEGIN
  ALTER TABLE ONLY public.dashboard_preferences
    ADD CONSTRAINT dashboard_preferences_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.document_approval_requirements
    ADD CONSTRAINT document_approval_requirements_taxonomy_key_folder_taxonomy_int FOREIGN KEY (taxonomy_key) REFERENCES public.folder_taxonomy(internal_key);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittal_items
    ADD CONSTRAINT eng_transmittal_items_deliverable_id_project_eng_deliverables_i FOREIGN KEY (deliverable_id) REFERENCES public.project_eng_deliverables(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittal_items
    ADD CONSTRAINT eng_transmittal_items_drawing_id_drawing_register_id_fk FOREIGN KEY (drawing_id) REFERENCES public.drawing_register(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittal_items
    ADD CONSTRAINT eng_transmittal_items_transmittal_id_eng_transmittals_id_fk FOREIGN KEY (transmittal_id) REFERENCES public.eng_transmittals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittals
    ADD CONSTRAINT eng_transmittals_issued_by_user_id_users_id_fk FOREIGN KEY (issued_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittals
    ADD CONSTRAINT eng_transmittals_project_eng_stage_id_project_eng_stages_id_fk FOREIGN KEY (project_eng_stage_id) REFERENCES public.project_eng_stages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittals
    ADD CONSTRAINT eng_transmittals_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.eng_transmittals
    ADD CONSTRAINT eng_transmittals_recipient_user_id_users_id_fk FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.folder_taxonomy
    ADD CONSTRAINT folder_taxonomy_parent_key_folder_taxonomy_internal_key_fk FOREIGN KEY (parent_key) REFERENCES public.folder_taxonomy(internal_key) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.folder_taxonomy
    ADD CONSTRAINT folder_taxonomy_stage_code_stage_definitions_stage_code_fk FOREIGN KEY (stage_code) REFERENCES public.stage_definitions(stage_code) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.import_history
    ADD CONSTRAINT import_history_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.import_history
    ADD CONSTRAINT import_history_started_by_user_id_users_id_fk FOREIGN KEY (started_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.om_handover_history
    ADD CONSTRAINT om_handover_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.om_handover_history
    ADD CONSTRAINT om_handover_history_om_handover_id_om_handovers_id_fk FOREIGN KEY (om_handover_id) REFERENCES public.om_handovers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.pending_approval_history
    ADD CONSTRAINT pending_approval_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.pending_approval_history
    ADD CONSTRAINT pending_approval_history_pending_approval_id_pending_approvals_ FOREIGN KEY (pending_approval_id) REFERENCES public.pending_approvals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.post_handover_reviews
    ADD CONSTRAINT post_handover_reviews_coo_sign_off_user_id_users_id_fk FOREIGN KEY (coo_sign_off_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.post_handover_reviews
    ADD CONSTRAINT post_handover_reviews_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.post_handover_reviews
    ADD CONSTRAINT post_handover_reviews_pm_sign_off_user_id_users_id_fk FOREIGN KEY (pm_sign_off_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.post_handover_reviews
    ADD CONSTRAINT post_handover_reviews_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_delivery_milestones
    ADD CONSTRAINT project_delivery_milestones_completed_by_user_id_users_id_fk FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_delivery_milestones
    ADD CONSTRAINT project_delivery_milestones_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_delivery_milestones
    ADD CONSTRAINT project_delivery_milestones_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_delivery_milestones
    ADD CONSTRAINT project_delivery_milestones_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_folders
    ADD CONSTRAINT project_folders_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_folders
    ADD CONSTRAINT project_folders_provisioned_by_user_id_users_id_fk FOREIGN KEY (provisioned_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_folders
    ADD CONSTRAINT project_folders_taxonomy_key_folder_taxonomy_internal_key_fk FOREIGN KEY (taxonomy_key) REFERENCES public.folder_taxonomy(internal_key);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_decision_owner_user_id_users_id_fk FOREIGN KEY (decision_owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_hold_metadata
    ADD CONSTRAINT project_hold_metadata_resolved_by_user_id_users_id_fk FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_milestones
    ADD CONSTRAINT project_milestones_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_stage_exception_history
    ADD CONSTRAINT project_stage_exception_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.project_stage_exception_history
    ADD CONSTRAINT project_stage_exception_history_exception_id_project_stage_exce FOREIGN KEY (exception_id) REFERENCES public.project_stage_exceptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.qb_link_proposed_cascade_history
    ADD CONSTRAINT qb_link_proposed_cascade_history_cascade_id_qb_link_proposed_ca FOREIGN KEY (cascade_id) REFERENCES public.qb_link_proposed_cascades(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.qb_link_proposed_cascade_history
    ADD CONSTRAINT qb_link_proposed_cascade_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.standup_sessions
    ADD CONSTRAINT standup_sessions_facilitator_user_id_users_id_fk FOREIGN KEY (facilitator_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.standup_sessions
    ADD CONSTRAINT standup_sessions_schedule_id_standup_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.standup_schedules(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.template_overrides
    ADD CONSTRAINT template_overrides_overridden_by_users_id_fk FOREIGN KEY (overridden_by) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.template_overrides
    ADD CONSTRAINT template_overrides_project_id_project_info_id_fk FOREIGN KEY (project_id) REFERENCES public.project_info(id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.vat_period_locks
    ADD CONSTRAINT vat_period_locks_locked_by_user_id_users_id_fk FOREIGN KEY (locked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.vat_period_locks
    ADD CONSTRAINT vat_period_locks_unlocked_by_user_id_users_id_fk FOREIGN KEY (unlocked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR invalid_table_definition OR duplicate_table THEN null; END $$;
