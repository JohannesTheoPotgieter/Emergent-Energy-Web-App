-- Auto-generated full schema alignment SQL
-- Adds all missing columns to existing tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_settings' AND column_name='key') THEN
    ALTER TABLE "app_settings" ADD COLUMN "key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_settings' AND column_name='value') THEN
    ALTER TABLE "app_settings" ADD COLUMN "value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_settings' AND column_name='updated_by') THEN
    ALTER TABLE "app_settings" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_settings' AND column_name='updated_at') THEN
    ALTER TABLE "app_settings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='type') THEN
    ALTER TABLE "approvals" ADD COLUMN "type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='title') THEN
    ALTER TABLE "approvals" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='description') THEN
    ALTER TABLE "approvals" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='status') THEN
    ALTER TABLE "approvals" ADD COLUMN "status" approval_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='requested_by') THEN
    ALTER TABLE "approvals" ADD COLUMN "requested_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='requested_at') THEN
    ALTER TABLE "approvals" ADD COLUMN "requested_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='decided_by') THEN
    ALTER TABLE "approvals" ADD COLUMN "decided_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='decided_at') THEN
    ALTER TABLE "approvals" ADD COLUMN "decided_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='decision_note') THEN
    ALTER TABLE "approvals" ADD COLUMN "decision_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='token') THEN
    ALTER TABLE "approvals" ADD COLUMN "token" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='expires_at') THEN
    ALTER TABLE "approvals" ADD COLUMN "expires_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='related_entity_type') THEN
    ALTER TABLE "approvals" ADD COLUMN "related_entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='related_entity_id') THEN
    ALTER TABLE "approvals" ADD COLUMN "related_entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='assigned_approver') THEN
    ALTER TABLE "approvals" ADD COLUMN "assigned_approver" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='due_date') THEN
    ALTER TABLE "approvals" ADD COLUMN "due_date" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='project_id') THEN
    ALTER TABLE "approvals" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approvals' AND column_name='approval_category') THEN
    ALTER TABLE "approvals" ADD COLUMN "approval_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='actor_role') THEN
    ALTER TABLE "audit_events" ADD COLUMN "actor_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='user_id') THEN
    ALTER TABLE "audit_events" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='user_name') THEN
    ALTER TABLE "audit_events" ADD COLUMN "user_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='source') THEN
    ALTER TABLE "audit_events" ADD COLUMN "source" audit_source DEFAULT 'UI';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='entity_type') THEN
    ALTER TABLE "audit_events" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='entity_id') THEN
    ALTER TABLE "audit_events" ADD COLUMN "entity_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='action') THEN
    ALTER TABLE "audit_events" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='changes_json') THEN
    ALTER TABLE "audit_events" ADD COLUMN "changes_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='project_name') THEN
    ALTER TABLE "audit_events" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='project_id') THEN
    ALTER TABLE "audit_events" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='correlation_id') THEN
    ALTER TABLE "audit_events" ADD COLUMN "correlation_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='ip_address') THEN
    ALTER TABLE "audit_events" ADD COLUMN "ip_address" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='request_path') THEN
    ALTER TABLE "audit_events" ADD COLUMN "request_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='request_method') THEN
    ALTER TABLE "audit_events" ADD COLUMN "request_method" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='created_at') THEN
    ALTER TABLE "audit_events" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='week_start_date') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='previous_value') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "previous_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='new_value') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "new_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='computed_value') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "computed_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='reason') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='changed_at') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_history' AND column_name='changed_by') THEN
    ALTER TABLE "available_payment_history" ADD COLUMN "changed_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_overrides' AND column_name='week_start_date') THEN
    ALTER TABLE "available_payment_overrides" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_overrides' AND column_name='override_value') THEN
    ALTER TABLE "available_payment_overrides" ADD COLUMN "override_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_overrides' AND column_name='reason') THEN
    ALTER TABLE "available_payment_overrides" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_overrides' AND column_name='updated_at') THEN
    ALTER TABLE "available_payment_overrides" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='available_payment_overrides' AND column_name='updated_by') THEN
    ALTER TABLE "available_payment_overrides" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calendar_holiday' AND column_name='date') THEN
    ALTER TABLE "calendar_holiday" ADD COLUMN "date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calendar_holiday' AND column_name='name') THEN
    ALTER TABLE "calendar_holiday" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calendar_holiday' AND column_name='country_code') THEN
    ALTER TABLE "calendar_holiday" ADD COLUMN "country_code" TEXT DEFAULT 'ZA';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='week_start_date') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='previous_value') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "previous_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='new_value') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "new_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='computed_value') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "computed_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='delta') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "delta" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='changed_at') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_balance_history' AND column_name='changed_by') THEN
    ALTER TABLE "cashflow_balance_history" ADD COLUMN "changed_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='project_name') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='series_name') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "series_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='point_date') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "point_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='value') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='project_id') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='source') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='import_snapshot') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='last_edited_by') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='last_edited_at') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='created_at') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='effective_from') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='effective_to') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_points' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "cashflow_points" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_weekly_manual' AND column_name='week_start_date') THEN
    ALTER TABLE "cashflow_weekly_manual" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_weekly_manual' AND column_name='opening_balance') THEN
    ALTER TABLE "cashflow_weekly_manual" ADD COLUMN "opening_balance" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cashflow_weekly_manual' AND column_name='updated_at') THEN
    ALTER TABLE "cashflow_weekly_manual" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='run_id') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='file_id') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "file_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='event_type') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "event_type" change_event_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='old_etag') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "old_etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='new_etag') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "new_etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='sp_modified_at') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "sp_modified_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='sp_modified_by_name') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "sp_modified_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='sp_modified_by_email') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "sp_modified_by_email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='detected_at') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "detected_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='import_status') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "import_status" import_status_type DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='snapshot_id') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "snapshot_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='error_code') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "error_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_ledger' AND column_name='error_message') THEN
    ALTER TABLE "change_ledger" ADD COLUMN "error_message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='project_id') THEN
    ALTER TABLE "change_requests" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='title') THEN
    ALTER TABLE "change_requests" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='description') THEN
    ALTER TABLE "change_requests" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='change_type') THEN
    ALTER TABLE "change_requests" ADD COLUMN "change_type" change_request_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='requested_by_user_id') THEN
    ALTER TABLE "change_requests" ADD COLUMN "requested_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='owner_user_id') THEN
    ALTER TABLE "change_requests" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='impact_summary') THEN
    ALTER TABLE "change_requests" ADD COLUMN "impact_summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='cost_impact') THEN
    ALTER TABLE "change_requests" ADD COLUMN "cost_impact" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='schedule_impact_days') THEN
    ALTER TABLE "change_requests" ADD COLUMN "schedule_impact_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='status') THEN
    ALTER TABLE "change_requests" ADD COLUMN "status" change_request_status DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='approval_id') THEN
    ALTER TABLE "change_requests" ADD COLUMN "approval_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='created_at') THEN
    ALTER TABLE "change_requests" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_requests' AND column_name='updated_at') THEN
    ALTER TABLE "change_requests" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='actor_role') THEN
    ALTER TABLE "change_sets" ADD COLUMN "actor_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='actor_user_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "actor_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='source') THEN
    ALTER TABLE "change_sets" ADD COLUMN "source" change_set_source;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='entity_type') THEN
    ALTER TABLE "change_sets" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='entity_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "entity_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='project_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='project_name') THEN
    ALTER TABLE "change_sets" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='import_run_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='smart_import_run_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "smart_import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='action') THEN
    ALTER TABLE "change_sets" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='summary') THEN
    ALTER TABLE "change_sets" ADD COLUMN "summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='override_category') THEN
    ALTER TABLE "change_sets" ADD COLUMN "override_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='override_comment') THEN
    ALTER TABLE "change_sets" ADD COLUMN "override_comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='correlation_id') THEN
    ALTER TABLE "change_sets" ADD COLUMN "correlation_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='file_metadata') THEN
    ALTER TABLE "change_sets" ADD COLUMN "file_metadata" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='change_sets' AND column_name='created_at') THEN
    ALTER TABLE "change_sets" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='client_id') THEN
    ALTER TABLE "clients" ADD COLUMN "client_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='name') THEN
    ALTER TABLE "clients" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='created_by') THEN
    ALTER TABLE "clients" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='updated_by') THEN
    ALTER TABLE "clients" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='created_at') THEN
    ALTER TABLE "clients" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='updated_at') THEN
    ALTER TABLE "clients" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='project_id') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='item_type') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "item_type" TEXT DEFAULT 'commissioning';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='title') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='description') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='owner_user_id') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='due_date') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='status') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "status" commissioning_status DEFAULT 'not_started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='evidence_notes') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "evidence_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='approval_id') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "approval_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='gate_id') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "gate_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='category') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='sort_order') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='created_at') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='updated_at') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='commissioning_items' AND column_name='completed_at') THEN
    ALTER TABLE "commissioning_items" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='ms_object_id') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "ms_object_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='project_id') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='task_id') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='task_type') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "task_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='dedupe_key') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "dedupe_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='due_at') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "due_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='reminder_at') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "reminder_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='reminder_sent_at') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "reminder_sent_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='status') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "status" communication_follow_up_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='created_by') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='completed_at') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communication_follow_ups' AND column_name='created_at') THEN
    ALTER TABLE "communication_follow_ups" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='import_run_id') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='entity_type') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='entity_id') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "entity_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='field_name') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "field_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='manual_value') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "manual_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='import_value') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "import_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='decision') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "decision" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='decided_by_user_id') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "decided_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='decided_by_name') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "decided_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conflict_resolution_log' AND column_name='decided_at') THEN
    ALTER TABLE "conflict_resolution_log" ADD COLUMN "decided_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='name_canonical') THEN
    ALTER TABLE "counterparties" ADD COLUMN "name_canonical" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='name_aliases') THEN
    ALTER TABLE "counterparties" ADD COLUMN "name_aliases" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='type_default') THEN
    ALTER TABLE "counterparties" ADD COLUMN "type_default" counterparty_type DEFAULT 'OTHER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='is_core') THEN
    ALTER TABLE "counterparties" ADD COLUMN "is_core" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='is_active') THEN
    ALTER TABLE "counterparties" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='role_tags') THEN
    ALTER TABLE "counterparties" ADD COLUMN "role_tags" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='vat_number') THEN
    ALTER TABLE "counterparties" ADD COLUMN "vat_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='registration_number') THEN
    ALTER TABLE "counterparties" ADD COLUMN "registration_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='address') THEN
    ALTER TABLE "counterparties" ADD COLUMN "address" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='contact_person') THEN
    ALTER TABLE "counterparties" ADD COLUMN "contact_person" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='contact_phone') THEN
    ALTER TABLE "counterparties" ADD COLUMN "contact_phone" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='contact_email') THEN
    ALTER TABLE "counterparties" ADD COLUMN "contact_email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='bank_name') THEN
    ALTER TABLE "counterparties" ADD COLUMN "bank_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='bank_account_number') THEN
    ALTER TABLE "counterparties" ADD COLUMN "bank_account_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='bank_branch_code') THEN
    ALTER TABLE "counterparties" ADD COLUMN "bank_branch_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='payment_terms') THEN
    ALTER TABLE "counterparties" ADD COLUMN "payment_terms" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='notes') THEN
    ALTER TABLE "counterparties" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='created_by') THEN
    ALTER TABLE "counterparties" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='created_at') THEN
    ALTER TABLE "counterparties" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='updated_at') THEN
    ALTER TABLE "counterparties" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='last_seen_at') THEN
    ALTER TABLE "counterparties" ADD COLUMN "last_seen_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='counterparty_id') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "counterparty_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='name') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='email') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='phone') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "phone" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='title') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='role_tags') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "role_tags" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='is_active') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='notes') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='created_by_user_id') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='created_at') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparty_contacts' AND column_name='updated_at') THEN
    ALTER TABLE "counterparty_contacts" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='total_projects') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "total_projects" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='active_projects') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "active_projects" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='total_program_revenue') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "total_program_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='total_program_cost') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "total_program_cost" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='received_revenue') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "received_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='paid_cost') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "paid_cost" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='avg_margin') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "avg_margin" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='projects_at_risk') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "projects_at_risk" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='total_tasks_overdue') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "total_tasks_overdue" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='total_open_warnings') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "total_open_warnings" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_program_metrics' AND column_name='last_refreshed_at') THEN
    ALTER TABLE "dashboard_program_metrics" ADD COLUMN "last_refreshed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='project_id') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='total_revenue') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "total_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='received_revenue') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "received_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='outstanding_revenue') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "outstanding_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='total_cost') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "total_cost" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='paid_cost') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "paid_cost" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='outstanding_cost') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "outstanding_cost" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='margin_pct') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "margin_pct" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='task_count') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "task_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='tasks_completed') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "tasks_completed" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='tasks_in_progress') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "tasks_in_progress" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='tasks_overdue') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "tasks_overdue" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='tasks_active') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "tasks_active" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='open_warnings') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "open_warnings" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='qc_progress_pct') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "qc_progress_pct" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='health_score') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "health_score" NUMERIC(5,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='phase') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='rag_status') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "rag_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='contract_value') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "contract_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='project_name') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='pm') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "pm" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='pd') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "pd" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_project_metrics' AND column_name='last_refreshed_at') THEN
    ALTER TABLE "dashboard_project_metrics" ADD COLUMN "last_refreshed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_widget_config' AND column_name='user_id') THEN
    ALTER TABLE "dashboard_widget_config" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_widget_config' AND column_name='widget_order') THEN
    ALTER TABLE "dashboard_widget_config" ADD COLUMN "widget_order" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_widget_config' AND column_name='hidden_widgets') THEN
    ALTER TABLE "dashboard_widget_config" ADD COLUMN "hidden_widgets" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dashboard_widget_config' AND column_name='updated_at') THEN
    ALTER TABLE "dashboard_widget_config" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='deliverable_id') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='event_type') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='from_status') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "from_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='to_status') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "to_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='feedback_text') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "feedback_text" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='actor_user_id') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "actor_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_events' AND column_name='created_at') THEN
    ALTER TABLE "deliverable_events" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='deliverable_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='version_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "version_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='site_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='drive_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "drive_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='file_item_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "file_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='file_name') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='web_url') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "web_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='is_approved') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "is_approved" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='uploaded_by_user_id') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "uploaded_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_files' AND column_name='uploaded_at') THEN
    ALTER TABLE "deliverable_files" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='deliverable_id') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='version_number') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "version_number" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='change_reason') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "change_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='impact_json') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "impact_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='status') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "status" TEXT DEFAULT 'IN PROGRESS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='created_by_user_id') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverable_versions' AND column_name='created_at') THEN
    ALTER TABLE "deliverable_versions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='project_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='project_name') THEN
    ALTER TABLE "deliverables" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='deliverable_type') THEN
    ALTER TABLE "deliverables" ADD COLUMN "deliverable_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='title') THEN
    ALTER TABLE "deliverables" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='description') THEN
    ALTER TABLE "deliverables" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='phase') THEN
    ALTER TABLE "deliverables" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='owner_user_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='reviewer_user_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "reviewer_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='qc_reviewer_user_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "qc_reviewer_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='status') THEN
    ALTER TABLE "deliverables" ADD COLUMN "status" TEXT DEFAULT 'TO DO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='current_version') THEN
    ALTER TABLE "deliverables" ADD COLUMN "current_version" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='sharepoint_folder_site_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "sharepoint_folder_site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='sharepoint_folder_drive_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "sharepoint_folder_drive_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='sharepoint_folder_item_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "sharepoint_folder_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='linked_plan_item_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "linked_plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='linked_quality_item_instance_id') THEN
    ALTER TABLE "deliverables" ADD COLUMN "linked_quality_item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='created_at') THEN
    ALTER TABLE "deliverables" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='updated_at') THEN
    ALTER TABLE "deliverables" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='scheduled_date') THEN
    ALTER TABLE "deliverables" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "deliverables" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deliverables' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "deliverables" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='snapshot_key') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "snapshot_key" TEXT DEFAULT 'current';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='total_program_budget') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "total_program_budget" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='actual_spend_paid') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "actual_spend_paid" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='revenue_realised') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "revenue_realised" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='active_projects_count') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "active_projects_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='active_capacity_mw') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "active_capacity_mw" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='on_schedule_rate') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "on_schedule_rate" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='behind_plan_count') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "behind_plan_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='on_hold_count') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "on_hold_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='closed_count') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "closed_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='gross_profit') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "gross_profit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='gross_profit_pct') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "gross_profit_pct" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='revenue_outstanding') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "revenue_outstanding" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='expenses_outstanding') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "expenses_outstanding" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='phase_distribution_json') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "phase_distribution_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_portfolio_kpis' AND column_name='computed_at') THEN
    ALTER TABLE "derived_portfolio_kpis" ADD COLUMN "computed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='project_key') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "project_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='project_name') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='project_id') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='phase') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='size_kwp') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "size_kwp" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='contract_value') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "contract_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='rag_status') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "rag_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='pm') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "pm" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='pd') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "pd" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='is_active') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='total_planned_revenue') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "total_planned_revenue" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='total_actual_revenue') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "total_actual_revenue" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='revenue_realised') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "revenue_realised" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='revenue_outstanding') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "revenue_outstanding" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='total_planned_expenses') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "total_planned_expenses" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='total_actual_expenses') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "total_actual_expenses" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='cos_realised') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "cos_realised" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='expenses_outstanding') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "expenses_outstanding" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='gross_profit') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "gross_profit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='gross_margin_pct') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "gross_margin_pct" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='avg_actual_pct_complete') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "avg_actual_pct_complete" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='avg_expected_pct_complete') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "avg_expected_pct_complete" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='schedule_delta') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "schedule_delta" NUMERIC(8,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='task_count') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "task_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='expense_line_count') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "expense_line_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='revenue_line_count') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "revenue_line_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='needs_review') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "needs_review" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='needs_review_reason') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "needs_review_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_project_kpis' AND column_name='computed_at') THEN
    ALTER TABLE "derived_project_kpis" ADD COLUMN "computed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_rag_summary' AND column_name='rag_status') THEN
    ALTER TABLE "derived_rag_summary" ADD COLUMN "rag_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_rag_summary' AND column_name='project_count') THEN
    ALTER TABLE "derived_rag_summary" ADD COLUMN "project_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_rag_summary' AND column_name='total_kwp') THEN
    ALTER TABLE "derived_rag_summary" ADD COLUMN "total_kwp" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_rag_summary' AND column_name='total_contract_value') THEN
    ALTER TABLE "derived_rag_summary" ADD COLUMN "total_contract_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='derived_rag_summary' AND column_name='computed_at') THEN
    ALTER TABLE "derived_rag_summary" ADD COLUMN "computed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='event_type') THEN
    ALTER TABLE "domain_events" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='aggregate_type') THEN
    ALTER TABLE "domain_events" ADD COLUMN "aggregate_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='aggregate_id') THEN
    ALTER TABLE "domain_events" ADD COLUMN "aggregate_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='project_id') THEN
    ALTER TABLE "domain_events" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='triggered_by') THEN
    ALTER TABLE "domain_events" ADD COLUMN "triggered_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='payload') THEN
    ALTER TABLE "domain_events" ADD COLUMN "payload" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='created_at') THEN
    ALTER TABLE "domain_events" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='domain_events' AND column_name='processed_at') THEN
    ALTER TABLE "domain_events" ADD COLUMN "processed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='node_id') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='filename') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "filename" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='mime_type') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "mime_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='storage_path') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "storage_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='uploaded_at') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_assets' AND column_name='uploaded_by') THEN
    ALTER TABLE "ee_info_assets" ADD COLUMN "uploaded_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_edges' AND column_name='from_node_id') THEN
    ALTER TABLE "ee_info_edges" ADD COLUMN "from_node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_edges' AND column_name='to_node_id') THEN
    ALTER TABLE "ee_info_edges" ADD COLUMN "to_node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_edges' AND column_name='edge_type') THEN
    ALTER TABLE "ee_info_edges" ADD COLUMN "edge_type" TEXT DEFAULT 'link';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='node_id') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='purpose') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "purpose" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='inputs') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "inputs" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='steps') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "steps" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='outputs') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "outputs" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='raci') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "raci" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='tools_docs') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "tools_docs" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='risks_failure_modes') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "risks_failure_modes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='updated_at') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_details' AND column_name='updated_by') THEN
    ALTER TABLE "ee_info_node_details" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_editors' AND column_name='node_id') THEN
    ALTER TABLE "ee_info_node_editors" ADD COLUMN "node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_editors' AND column_name='user_id') THEN
    ALTER TABLE "ee_info_node_editors" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_editors' AND column_name='can_edit') THEN
    ALTER TABLE "ee_info_node_editors" ADD COLUMN "can_edit" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_editors' AND column_name='can_manage_children') THEN
    ALTER TABLE "ee_info_node_editors" ADD COLUMN "can_manage_children" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_editors' AND column_name='created_at') THEN
    ALTER TABLE "ee_info_node_editors" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='node_id') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='metric_key') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "metric_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='metric_query_type') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "metric_query_type" TEXT DEFAULT 'project_count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='config') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "config" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='display_format') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "display_format" TEXT DEFAULT 'number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='sort_order') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_node_metrics' AND column_name='created_at') THEN
    ALTER TABLE "ee_info_node_metrics" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='slug') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "slug" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='title') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='content_markdown') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "content_markdown" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='status') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "status" TEXT DEFAULT 'stub';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='category') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "category" TEXT DEFAULT 'unknown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='node_type') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "node_type" TEXT DEFAULT 'content';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='department_slug') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "department_slug" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='lifecycle_stages') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "lifecycle_stages" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='sort_order') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='sop_data') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "sop_data" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='parent_node_id') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "parent_node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='external_url') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "external_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='tags') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "tags" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='flow_enabled') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "flow_enabled" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='flow_lane') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "flow_lane" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='flow_step_code') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "flow_step_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='next_slugs') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "next_slugs" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='prev_slugs') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "prev_slugs" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='gate_conditions') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "gate_conditions" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='blocking_conditions') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "blocking_conditions" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='responsible_role') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "responsible_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='escalation_role') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "escalation_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='primary_instruction') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "primary_instruction" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='stage_code') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "stage_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='definition_of_done') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "definition_of_done" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='owner_role_id') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "owner_role_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='approver_role_id') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "approver_role_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='required_links') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "required_links" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='example_artifacts') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "example_artifacts" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='example_notes') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "example_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='common_pitfalls') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "common_pitfalls" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='next_node_id') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "next_node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='created_at') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='updated_at') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='created_by') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_nodes' AND column_name='updated_by') THEN
    ALTER TABLE "ee_info_nodes" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_settings' AND column_name='seed_import_completed') THEN
    ALTER TABLE "ee_info_settings" ADD COLUMN "seed_import_completed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_settings' AND column_name='seed_import_hash') THEN
    ALTER TABLE "ee_info_settings" ADD COLUMN "seed_import_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_settings' AND column_name='seed_imported_at') THEN
    ALTER TABLE "ee_info_settings" ADD COLUMN "seed_imported_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_settings' AND column_name='seed_imported_by') THEN
    ALTER TABLE "ee_info_settings" ADD COLUMN "seed_imported_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_versions' AND column_name='node_id') THEN
    ALTER TABLE "ee_info_versions" ADD COLUMN "node_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_versions' AND column_name='content_markdown') THEN
    ALTER TABLE "ee_info_versions" ADD COLUMN "content_markdown" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_versions' AND column_name='changed_by') THEN
    ALTER TABLE "ee_info_versions" ADD COLUMN "changed_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_versions' AND column_name='changed_at') THEN
    ALTER TABLE "ee_info_versions" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ee_info_versions' AND column_name='change_note') THEN
    ALTER TABLE "ee_info_versions" ADD COLUMN "change_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='stage_template_id') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "stage_template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='name') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='description') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='is_required') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "is_required" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='allowed_file_types') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "allowed_file_types" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_deliverable_templates' AND column_name='required_count') THEN
    ALTER TABLE "eng_deliverable_templates" ADD COLUMN "required_count" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='name') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='purpose') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "purpose" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='inputs') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "inputs" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='raci_responsible') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "raci_responsible" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='raci_accountable') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "raci_accountable" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='raci_consulted') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "raci_consulted" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='raci_informed') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "raci_informed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='failure_modes') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "failure_modes" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='stage_gate_rules') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "stage_gate_rules" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='sort_order') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='version') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "version" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='is_active') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='created_by') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_stage_templates' AND column_name='created_at') THEN
    ALTER TABLE "eng_stage_templates" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='stage_template_id') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "stage_template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='title') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='description') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='is_required') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "is_required" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='sequence') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "sequence" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='eng_task_templates' AND column_name='default_owner_role') THEN
    ALTER TABLE "eng_task_templates" ADD COLUMN "default_owner_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='entity_type') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='entity_id') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='project_id') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='assignment_role') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "assignment_role" TEXT DEFAULT 'ASSIGNEE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='assignee_type') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "assignee_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='assignee_id') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "assignee_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='display_label_snapshot') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "display_label_snapshot" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='active') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='assigned_by_user_id') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "assigned_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='cleared_by_user_id') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "cleared_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='assigned_at') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "assigned_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='cleared_at') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "cleared_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='metadata') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "metadata" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='created_at') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_assignments' AND column_name='updated_at') THEN
    ALTER TABLE "entity_assignments" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='user_id') THEN
    ALTER TABLE "error_logs" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='route') THEN
    ALTER TABLE "error_logs" ADD COLUMN "route" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='action') THEN
    ALTER TABLE "error_logs" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='correlation_id') THEN
    ALTER TABLE "error_logs" ADD COLUMN "correlation_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='error_message') THEN
    ALTER TABLE "error_logs" ADD COLUMN "error_message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='error_stack') THEN
    ALTER TABLE "error_logs" ADD COLUMN "error_stack" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='payload_shape') THEN
    ALTER TABLE "error_logs" ADD COLUMN "payload_shape" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='error_logs' AND column_name='created_at') THEN
    ALTER TABLE "error_logs" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='event_id') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "event_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='handler_name') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "handler_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='status') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "status" event_processing_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='error_message') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "error_message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='processed_at') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "processed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_processing_log' AND column_name='duration_ms') THEN
    ALTER TABLE "event_processing_log" ADD COLUMN "duration_ms" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_subscriptions' AND column_name='event_type') THEN
    ALTER TABLE "event_subscriptions" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_subscriptions' AND column_name='handler_name') THEN
    ALTER TABLE "event_subscriptions" ADD COLUMN "handler_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_subscriptions' AND column_name='is_active') THEN
    ALTER TABLE "event_subscriptions" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_subscriptions' AND column_name='created_at') THEN
    ALTER TABLE "event_subscriptions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='project_id') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='completion_type') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "completion_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='source_type') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "source_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='source_ref') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "source_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='requirement_key') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "requirement_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='evidence_type') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "evidence_type" evidence_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='title') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='value_ref') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "value_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='value_json') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "value_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='uploaded_by_user_id') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "uploaded_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='uploaded_by_name') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "uploaded_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='created_at') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_collected_items' AND column_name='deleted_at') THEN
    ALTER TABLE "evidence_collected_items" ADD COLUMN "deleted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='project_id') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='completion_type') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "completion_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='source_type') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "source_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='source_ref') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "source_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='threshold_percent') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "threshold_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='score_percent') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "score_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='total_required') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "total_required" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='total_present') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "total_present" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='missing_items_json') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "missing_items_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='pass') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "pass" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='evaluated_by_user_id') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "evaluated_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='evaluated_by_name') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "evaluated_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_evaluations' AND column_name='created_at') THEN
    ALTER TABLE "evidence_evaluations" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='project_id') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='completion_type') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "completion_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='source_type') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "source_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='source_ref') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "source_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='score_percent') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "score_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='threshold_percent') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "threshold_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='reason') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='authorized_by_user_id') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "authorized_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='authorized_by_name') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "authorized_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='authorized_by_role') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "authorized_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_override_records' AND column_name='created_at') THEN
    ALTER TABLE "evidence_override_records" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='project_id') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='completion_type') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "completion_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='source_type') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "source_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='source_ref') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "source_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='requirement_key') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "requirement_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='label') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "label" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='evidence_type') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "evidence_type" evidence_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='is_required') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "is_required" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='weight') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "weight" REAL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='min_count') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "min_count" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='threshold_percent') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "threshold_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='config_json') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "config_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='active') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='created_at') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evidence_requirement_definitions' AND column_name='updated_at') THEN
    ALTER TABLE "evidence_requirement_definitions" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='project_id') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='action') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='previous_status') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "previous_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='new_status') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "new_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='reason') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='changed_by_user_id') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "changed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='changed_by_role') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "changed_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='execution_gate_log' AND column_name='changed_at') THEN
    ALTER TABLE "execution_gate_log" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='project_name') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='project_id') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='expense_id') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "expense_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='task_id') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='date_override') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "date_override" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='date_override_reason') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "date_override_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='created_by') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='created_at') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_task_links' AND column_name='updated_at') THEN
    ALTER TABLE "expense_task_links" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='type') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "type" TEXT DEFAULT 'bug';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='title') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='description') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='status') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "status" TEXT DEFAULT 'open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='priority') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "priority" TEXT DEFAULT 'medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='submitted_by') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "submitted_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='submitted_by_name') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "submitted_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='admin_notes') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "admin_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='created_at') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback_tickets' AND column_name='updated_at') THEN
    ALTER TABLE "feedback_tickets" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_changes' AND column_name='change_set_id') THEN
    ALTER TABLE "field_changes" ADD COLUMN "change_set_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_changes' AND column_name='field_name') THEN
    ALTER TABLE "field_changes" ADD COLUMN "field_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_changes' AND column_name='old_value') THEN
    ALTER TABLE "field_changes" ADD COLUMN "old_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_changes' AND column_name='new_value') THEN
    ALTER TABLE "field_changes" ADD COLUMN "new_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_changes' AND column_name='data_type') THEN
    ALTER TABLE "field_changes" ADD COLUMN "data_type" TEXT DEFAULT 'text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='project_name') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='project_id') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='category') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='month_end_date') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "month_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='value') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='source') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='import_snapshot') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='last_edited_by') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='last_edited_at') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='created_at') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='effective_from') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='effective_to') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cos_monthly' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "finance_cos_monthly" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='project_name') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='project_id') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='category') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='month_end_date') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "month_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='value') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='source') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='import_snapshot') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='last_edited_by') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='last_edited_at') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='created_at') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='effective_from') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='effective_to') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_revenue_monthly' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "finance_revenue_monthly" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='project_name') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='project_id') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='requested_by_user_id') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "requested_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='edit_type') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "edit_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='edit_target') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "edit_target" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='edit_payload') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "edit_payload" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='edit_summary') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "edit_summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='is_critical_path') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "is_critical_path" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='affects_revenue') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "affects_revenue" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='affects_expenditure') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "affects_expenditure" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='affects_quality') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "affects_quality" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='status') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "status" TEXT DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='reviewed_by_user_id') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "reviewed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='review_comment') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "review_comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='reviewed_at') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "reviewed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='created_at') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_edit_requests' AND column_name='updated_at') THEN
    ALTER TABLE "financial_edit_requests" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='project_name') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='project_id') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='rule_type') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "rule_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='rule_config') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "rule_config" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='is_active') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='created_by_user_id') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='created_at') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_integration_rules' AND column_name='updated_at') THEN
    ALTER TABLE "financial_integration_rules" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='fye_year') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "fye_year" INTEGER DEFAULT 2026;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='project_name') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='project_id') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='project_developer') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "project_developer" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='location') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "location" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='size_kwp') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "size_kwp" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='deal_probability_pct') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "deal_probability_pct" INTEGER DEFAULT 75;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='forecast_signature_date') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "forecast_signature_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='solar_revenue') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "solar_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='bess_revenue') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "bess_revenue" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='forecast_gp_pct') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "forecast_gp_pct" NUMERIC(6,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='status') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "status" TEXT DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='notes') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='created_by') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='updated_by') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='created_at') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forecast_pipeline' AND column_name='updated_at') THEN
    ALTER TABLE "forecast_pipeline" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='project_id') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='project_name') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='fye') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "fye" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='month_key') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "month_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='budget_type') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "budget_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='amount') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "amount" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='updated_by') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='created_at') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_budgets' AND column_name='updated_at') THEN
    ALTER TABLE "fye_budgets" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='fye_year') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "fye_year" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='brought_in') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "brought_in" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='signed') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "signed" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='updated_by') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='created_at') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_kpi_counters' AND column_name='updated_at') THEN
    ALTER TABLE "fye_kpi_counters" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='fye_year') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "fye_year" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='snapshot_month') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "snapshot_month" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='snapshot_date') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "snapshot_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='snapshot_label') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "snapshot_label" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='status') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "status" TEXT DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='snapshot_data') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "snapshot_data" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='notes') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='created_by') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='created_at') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='submitted_by') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "submitted_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='submitted_at') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "submitted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='approved_by') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "approved_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fye_report_snapshots' AND column_name='approved_at') THEN
    ALTER TABLE "fye_report_snapshots" ADD COLUMN "approved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='report_date') THEN
    ALTER TABLE "home_notes" ADD COLUMN "report_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='prepared_by') THEN
    ALTER TABLE "home_notes" ADD COLUMN "prepared_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='highlights_notes') THEN
    ALTER TABLE "home_notes" ADD COLUMN "highlights_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='construction_notes') THEN
    ALTER TABLE "home_notes" ADD COLUMN "construction_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='finance_notes') THEN
    ALTER TABLE "home_notes" ADD COLUMN "finance_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='home_notes' AND column_name='updated_at') THEN
    ALTER TABLE "home_notes" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='import_run_id') THEN
    ALTER TABLE "import_issues" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='severity') THEN
    ALTER TABLE "import_issues" ADD COLUMN "severity" import_issue_severity;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='section') THEN
    ALTER TABLE "import_issues" ADD COLUMN "section" import_section;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='message') THEN
    ALTER TABLE "import_issues" ADD COLUMN "message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='suggested_action') THEN
    ALTER TABLE "import_issues" ADD COLUMN "suggested_action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='issue_type') THEN
    ALTER TABLE "import_issues" ADD COLUMN "issue_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='issue_fingerprint') THEN
    ALTER TABLE "import_issues" ADD COLUMN "issue_fingerprint" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='resolved') THEN
    ALTER TABLE "import_issues" ADD COLUMN "resolved" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='resolution') THEN
    ALTER TABLE "import_issues" ADD COLUMN "resolution" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='resolution_note') THEN
    ALTER TABLE "import_issues" ADD COLUMN "resolution_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='resolved_by') THEN
    ALTER TABLE "import_issues" ADD COLUMN "resolved_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='resolved_at') THEN
    ALTER TABLE "import_issues" ADD COLUMN "resolved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='auto_resolved') THEN
    ALTER TABLE "import_issues" ADD COLUMN "auto_resolved" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='matched_rule_id') THEN
    ALTER TABLE "import_issues" ADD COLUMN "matched_rule_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='override_data') THEN
    ALTER TABLE "import_issues" ADD COLUMN "override_data" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_issues' AND column_name='payload_json') THEN
    ALTER TABLE "import_issues" ADD COLUMN "payload_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='import_run_id') THEN
    ALTER TABLE "import_logs" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='file_name') THEN
    ALTER TABLE "import_logs" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='imported_by_user_id') THEN
    ALTER TABLE "import_logs" ADD COLUMN "imported_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='imported_by_name') THEN
    ALTER TABLE "import_logs" ADD COLUMN "imported_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='project_name') THEN
    ALTER TABLE "import_logs" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='project_id') THEN
    ALTER TABLE "import_logs" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='status') THEN
    ALTER TABLE "import_logs" ADD COLUMN "status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='rows_attempted') THEN
    ALTER TABLE "import_logs" ADD COLUMN "rows_attempted" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='rows_written') THEN
    ALTER TABLE "import_logs" ADD COLUMN "rows_written" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='rows_skipped') THEN
    ALTER TABLE "import_logs" ADD COLUMN "rows_skipped" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='rows_rejected') THEN
    ALTER TABLE "import_logs" ADD COLUMN "rows_rejected" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='conflicts_detected') THEN
    ALTER TABLE "import_logs" ADD COLUMN "conflicts_detected" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='conflicts_resolved') THEN
    ALTER TABLE "import_logs" ADD COLUMN "conflicts_resolved" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='error_message') THEN
    ALTER TABLE "import_logs" ADD COLUMN "error_message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='summary_json') THEN
    ALTER TABLE "import_logs" ADD COLUMN "summary_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_logs' AND column_name='created_at') THEN
    ALTER TABLE "import_logs" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='trigger_type') THEN
    ALTER TABLE "import_runs" ADD COLUMN "trigger_type" import_trigger_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='started_at') THEN
    ALTER TABLE "import_runs" ADD COLUMN "started_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='finished_at') THEN
    ALTER TABLE "import_runs" ADD COLUMN "finished_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='status') THEN
    ALTER TABLE "import_runs" ADD COLUMN "status" import_run_status DEFAULT 'running';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='delta_token_used') THEN
    ALTER TABLE "import_runs" ADD COLUMN "delta_token_used" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='triggered_by') THEN
    ALTER TABLE "import_runs" ADD COLUMN "triggered_by" TEXT DEFAULT 'system';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_runs' AND column_name='summary_json') THEN
    ALTER TABLE "import_runs" ADD COLUMN "summary_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='sp_item_id') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "sp_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='project_id') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='client_key') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "client_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='client_name') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "client_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='request_type') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "request_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='status') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='priority') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "priority" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='due_date') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='days_in_progress') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "days_in_progress" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='project_developer') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "project_developer" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='designer') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "designer" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='size_kwp') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "size_kwp" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='province') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "province" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='gps_coordinates') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "gps_coordinates" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='funding_type') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "funding_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='bills_tariff_data') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "bills_tariff_data" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='metering_data') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "metering_data" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='site_inspection_form') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "site_inspection_form" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='comments') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "comments" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='working_schedule') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "working_schedule" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='batteries_needed') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "batteries_needed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='battery_size') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "battery_size" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='diesel_gen_needed') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "diesel_gen_needed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='roof_replacement_needed') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "roof_replacement_needed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='hse_discussed') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "hse_discussed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='number_of_reworks') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "number_of_reworks" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='clickup_synced') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "clickup_synced" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='item_type') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "item_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='sp_path') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "sp_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='sp_etag') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "sp_etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='sp_raw_json') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "sp_raw_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='app_notes') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "app_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='app_internal_blockers') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "app_internal_blockers" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='cp_signed') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "cp_signed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='cp_signed_date') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "cp_signed_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='cp_signed_by') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "cp_signed_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='cp_evidence_type') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "cp_evidence_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='cp_evidence_ref') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "cp_evidence_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='pm_created') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "pm_created" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='tasks_generated') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "tasks_generated" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='last_pulled_at') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "last_pulled_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='last_pushed_at') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "last_pushed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='last_pulled_hash') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "last_pulled_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='last_app_edit_at') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "last_app_edit_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='sync_conflict') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "sync_conflict" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='conflict_fields_json') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "conflict_fields_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='created_at') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_requests' AND column_name='updated_at') THEN
    ALTER TABLE "intake_requests" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='request_type') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "request_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='title') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='description') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='dod_items') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "dod_items" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='sort_order') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='is_active') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_task_templates' AND column_name='created_at') THEN
    ALTER TABLE "intake_task_templates" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='intake_request_id') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "intake_request_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='template_item_id') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "template_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='title') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='description') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='status') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "status" TEXT DEFAULT 'NOT_STARTED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='dod_items') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "dod_items" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='dod_completed_json') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "dod_completed_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='assigned_to') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "assigned_to" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='due_date') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='completed_at') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='completed_by') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "completed_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='sort_order') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='created_at') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='intake_tasks' AND column_name='updated_at') THEN
    ALTER TABLE "intake_tasks" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='project_id') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='supplier_id') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "supplier_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='invoice_number') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "invoice_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='invoice_date') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "invoice_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='amount') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "amount" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='vat_amount') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "vat_amount" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='linked_po_id') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "linked_po_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='linked_procurement_item_id') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "linked_procurement_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='status') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "status" invoice_capture_status DEFAULT 'captured';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='captured_by_user_id') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "captured_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='document_path') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "document_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='notes') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='created_at') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_captures' AND column_name='updated_at') THEN
    ALTER TABLE "invoice_captures" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='import_run_id') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='project_id') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='invoice_number_raw') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "invoice_number_raw" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='invoice_number_norm') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "invoice_number_norm" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='matched_rule_id') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "matched_rule_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='inferred_type') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "inferred_type" counterparty_type DEFAULT 'OTHER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='inferred_counterparty_id') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "inferred_counterparty_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='confidence_score') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "confidence_score" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='outcome') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "outcome" pattern_match_outcome DEFAULT 'UNRESOLVED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='source_row') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='override_reason') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "override_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_matches' AND column_name='created_at') THEN
    ALTER TABLE "invoice_pattern_matches" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='pattern_type') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "pattern_type" pattern_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='pattern_value') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "pattern_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='normalized_example') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "normalized_example" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='counterparty_id') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "counterparty_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='counterparty_name') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "counterparty_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='inferred_type') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "inferred_type" counterparty_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='confidence_weight') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "confidence_weight" INTEGER DEFAULT 50;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='created_by') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='created_at') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='last_confirmed_at') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "last_confirmed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='times_matched') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "times_matched" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='times_confirmed') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "times_confirmed" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='times_overridden') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "times_overridden" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_pattern_rules' AND column_name='is_active') THEN
    ALTER TABLE "invoice_pattern_rules" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='project_name') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='project_id') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='issue_type') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "issue_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='fingerprint') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "fingerprint" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='section') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "section" import_section;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='resolution') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "resolution" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='resolution_note') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "resolution_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='override_data') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "override_data" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='apply_always') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "apply_always" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='times_applied') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "times_applied" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='created_by') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='created_at') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='last_applied_at') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "last_applied_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='issue_resolution_rules' AND column_name='active') THEN
    ALTER TABLE "issue_resolution_rules" ADD COLUMN "active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='project_name') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='project_id') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='key_date_name') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "key_date_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='source_task_id') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "source_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='source_task_code') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "source_task_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='source_task_name_match') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "source_task_name_match" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='date_field') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "date_field" TEXT DEFAULT 'dueDate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='precedence_rule') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "precedence_rule" TEXT DEFAULT 'actual_over_planned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='sort_order') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='created_by') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='created_at') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='key_date_mappings' AND column_name='updated_at') THEN
    ALTER TABLE "key_date_mappings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='fye_year') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "fye_year" INTEGER DEFAULT 2026;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='deal_name') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "deal_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='deal_value') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "deal_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='business_developer') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "business_developer" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='lost_reason') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "lost_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='lost_date') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "lost_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='notes') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='created_by') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='updated_by') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='created_at') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lost_deals' AND column_name='updated_at') THEN
    ALTER TABLE "lost_deals" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='entity_type') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='entity_id') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='field_name') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "field_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='edited_by_user_id') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "edited_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='edited_by_name') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "edited_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='edited_at') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='is_protected') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "is_protected" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='protected_at') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "protected_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manual_edit_flags' AND column_name='protected_by_user_id') THEN
    ALTER TABLE "manual_edit_flags" ADD COLUMN "protected_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='template_profile_id') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "template_profile_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='section') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "section" import_section;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='source_header') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "source_header" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='canonical_field') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "canonical_field" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='confidence_weight') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "confidence_weight" REAL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='examples_json') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "examples_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='created_at') THEN
    ALTER TABLE "mapping_rules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='meeting_id') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "meeting_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='text') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "text" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='owner') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "owner" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='due_date') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='status') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "status" meeting_action_item_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='converted_to_type') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "converted_to_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='converted_to_id') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "converted_to_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_action_items' AND column_name='created_at') THEN
    ALTER TABLE "meeting_action_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='external_meeting_id') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "external_meeting_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='title') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='start_time') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "start_time" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='end_time') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "end_time" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='participants') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "participants" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='summary') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='report_url') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "report_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='source') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "source" TEXT DEFAULT 'read_ai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='raw_payload') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "raw_payload" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meeting_summaries' AND column_name='created_at') THEN
    ALTER TABLE "meeting_summaries" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='primary_project_id') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "primary_project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='secondary_project_id') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "secondary_project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='primary_project_name') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "primary_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='secondary_project_name') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "secondary_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='merged_by_user_id') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "merged_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='merged_by_role') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "merged_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='reason') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='conflicts_json') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "conflicts_json" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='moved_task_count') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "moved_task_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='moved_plan_count') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "moved_plan_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='merge_audit_log' AND column_name='merged_at') THEN
    ALTER TABLE "merge_audit_log" ADD COLUMN "merged_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='project_name') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='project_id') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='milestone_row_number') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "milestone_row_number" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='task_id') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='date_override') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "date_override" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='date_override_reason') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "date_override_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='milestone_task_links' AND column_name='created_at') THEN
    ALTER TABLE "milestone_task_links" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='mock_item_id') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "mock_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='fields') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "fields" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='etag') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='created_date_time') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "created_date_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='last_modified_date_time') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "last_modified_date_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='created_at') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mock_sp_items' AND column_name='updated_at') THEN
    ALTER TABLE "mock_sp_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='user_id') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='tenant_id') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "tenant_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='ms_user_id') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "ms_user_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='email') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='display_name') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "display_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='refresh_token_encrypted') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "refresh_token_encrypted" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='sso_access_token') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "sso_access_token" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='sso_token_expires_at') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "sso_token_expires_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='connected_at') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "connected_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_accounts' AND column_name='status') THEN
    ALTER TABLE "ms_accounts" ADD COLUMN "status" ms_account_status DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='user_id') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='type') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "type" ms_object_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='ms_id') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "ms_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='subject_or_title') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "subject_or_title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='preview') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "preview" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='web_link') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "web_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='sender_or_organizer') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "sender_or_organizer" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='received_or_start_datetime') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "received_or_start_datetime" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='end_datetime') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "end_datetime" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='last_synced_at') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "last_synced_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='action_required') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "action_required" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='is_read') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "is_read" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='importance') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "importance" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='linked_project_id') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "linked_project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='linked_task_id') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='metadata') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "metadata" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ms_objects' AND column_name='dismissed') THEN
    ALTER TABLE "ms_objects" ADD COLUMN "dismissed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='title') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='description') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='department') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='horizon') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "horizon" mytool_priority_horizon DEFAULT 'week';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='owner_role') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "owner_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='linked_project_name') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "linked_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='linked_project_id') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "linked_project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='severity') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "severity" mytool_priority_severity DEFAULT 'normal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='status') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "status" mytool_priority_status DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='priority_rank') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "priority_rank" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='assigned_to') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "assigned_to" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='next_action') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "next_action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='support') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "support" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='definition_of_done') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "definition_of_done" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='due_date') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='linked_task_id') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='linked_task_type') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "linked_task_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='created_at') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_company_priorities' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_company_priorities" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='owner_user_id') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='date') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='top_outcomes') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "top_outcomes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='what_moved') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "what_moved" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='blocked') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "blocked" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='notes') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='created_at') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_daily_reviews' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_daily_reviews" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_dod_templates' AND column_name='name') THEN
    ALTER TABLE "mytool_dod_templates" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_dod_templates' AND column_name='department') THEN
    ALTER TABLE "mytool_dod_templates" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_dod_templates' AND column_name='content') THEN
    ALTER TABLE "mytool_dod_templates" ADD COLUMN "content" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_dod_templates' AND column_name='created_by') THEN
    ALTER TABLE "mytool_dod_templates" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_dod_templates' AND column_name='created_at') THEN
    ALTER TABLE "mytool_dod_templates" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='subject') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "subject" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='sender') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "sender" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='email_date') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "email_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='snippet') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "snippet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='outlook_message_id') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "outlook_message_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='web_link') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "web_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='linked_task_id') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='linked_operational_task_id') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "linked_operational_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='linked_priority_id') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "linked_priority_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='created_by') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_email_links' AND column_name='created_at') THEN
    ALTER TABLE "mytool_email_links" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_instances' AND column_name='template_id') THEN
    ALTER TABLE "mytool_recurrence_instances" ADD COLUMN "template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_instances' AND column_name='task_id') THEN
    ALTER TABLE "mytool_recurrence_instances" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_instances' AND column_name='instance_date') THEN
    ALTER TABLE "mytool_recurrence_instances" ADD COLUMN "instance_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_instances' AND column_name='created_at') THEN
    ALTER TABLE "mytool_recurrence_instances" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='owner_user_id') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='title') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='description') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='project_name') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='project_id') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='default_assignee_role') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "default_assignee_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='checklist_items') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "checklist_items" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='frequency') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "frequency" mytool_recurrence_frequency;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='interval') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "interval" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='days_of_week') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "days_of_week" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='start_date') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='end_date') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='active') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='created_at') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_recurrence_templates' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_recurrence_templates" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_settings' AND column_name='enabled') THEN
    ALTER TABLE "mytool_settings" ADD COLUMN "enabled" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_settings' AND column_name='allowed_roles') THEN
    ALTER TABLE "mytool_settings" ADD COLUMN "allowed_roles" TEXT DEFAULT 'admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_settings' AND column_name='default_priority_horizon') THEN
    ALTER TABLE "mytool_settings" ADD COLUMN "default_priority_horizon" TEXT DEFAULT 'week';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_settings' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_settings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_task_dependencies' AND column_name='predecessor_task_id') THEN
    ALTER TABLE "mytool_task_dependencies" ADD COLUMN "predecessor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_task_dependencies' AND column_name='successor_task_id') THEN
    ALTER TABLE "mytool_task_dependencies" ADD COLUMN "successor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_task_dependencies' AND column_name='dependency_type') THEN
    ALTER TABLE "mytool_task_dependencies" ADD COLUMN "dependency_type" mytool_dependency_type DEFAULT 'finish_to_start';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_task_dependencies' AND column_name='created_at') THEN
    ALTER TABLE "mytool_task_dependencies" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='owner_user_id') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='title') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='status') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "status" mytool_task_status DEFAULT 'inbox';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='priority') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "priority" mytool_task_priority DEFAULT 'normal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='planned_for_date') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "planned_for_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='due_at') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "due_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='start_date') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='notes') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='bucket') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "bucket" mytool_task_bucket DEFAULT 'personal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='project_name') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='project_id') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='department') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='tag') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "tag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='source_email_id') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "source_email_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='source_email_subject') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "source_email_subject" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='blocked_reason') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "blocked_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='next_step') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "next_step" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='definition_of_done') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "definition_of_done" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='completion_note') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "completion_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='pinned_today') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "pinned_today" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='pinned_week') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "pinned_week" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='sort_order') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='is_recurring') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "is_recurring" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='recurrence_frequency') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "recurrence_frequency" mytool_recurrence_frequency;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='recurrence_interval') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "recurrence_interval" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='recurrence_days_of_week') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "recurrence_days_of_week" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='recurrence_end_date') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "recurrence_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='recurrence_parent_id') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "recurrence_parent_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='task_type') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "task_type" mytool_task_type DEFAULT 'task';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='scheduled_date') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='deleted_at') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "deleted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='created_at') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_tasks' AND column_name='completed_at') THEN
    ALTER TABLE "mytool_tasks" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='owner_user_id') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='date') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='start_time') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='end_time') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='label') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "label" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='linked_task_id') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='outlook_event_id') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "outlook_event_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='outlook_calendar_id') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "outlook_calendar_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='idempotency_key') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "idempotency_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='created_at') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_timeblocks' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_timeblocks" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='owner_user_id') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='today_layout') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "today_layout" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='default_view') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "default_view" TEXT DEFAULT 'today';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='workday_start_time') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "workday_start_time" TEXT DEFAULT '08:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='workday_end_time') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "workday_end_time" TEXT DEFAULT '17:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='show_company_priorities') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "show_company_priorities" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mytool_user_preferences' AND column_name='updated_at') THEN
    ALTER TABLE "mytool_user_preferences" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='project_id') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='project_name') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='cost_category') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "cost_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='counterparty_id') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "counterparty_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='counterparty_name') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "counterparty_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='counterparty_type') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "counterparty_type" counterparty_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='description') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='amount_ex_vat') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "amount_ex_vat" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='invoice_number') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "invoice_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='invoice_date') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "invoice_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='invoice_date_font_color') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "invoice_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='invoice_date_confirmed') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "invoice_date_confirmed" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='approved_date') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "approved_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='paid_date') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "paid_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='paid_date_font_color') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "paid_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='paid_date_confirmed') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "paid_date_confirmed" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='po_number') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "po_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='cos_realised') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "cos_realised" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='cashflow_confirmed') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "cashflow_confirmed" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='cost_line_status') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "cost_line_status" cost_line_status DEFAULT 'PLANNED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='source_sheet') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "source_sheet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='source_row') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='import_run_id') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='turnaround_days') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "turnaround_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='pattern_rule_id') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "pattern_rule_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='pattern_classified_at') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "pattern_classified_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='pattern_inferred_type') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "pattern_inferred_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='no_revenue_linked') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "no_revenue_linked" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='budget_qty') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "budget_qty" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='budget_rate') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "budget_rate" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='budget_total') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "budget_total" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='budget_cos') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "budget_cos" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='revenue_recognition_amount') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "revenue_recognition_amount" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='forecast_payment_date') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "forecast_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='sub_project_name') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='created_at') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='updated_at') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='effective_from') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='effective_to') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_cost_lines' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "normalized_cost_lines" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='project_id') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='project_name') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='phase_name') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "phase_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='phase_date') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "phase_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='source') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "source" phase_source DEFAULT 'EXCEL_IMPORT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='import_run_id') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_execution_phases' AND column_name='created_at') THEN
    ALTER TABLE "normalized_execution_phases" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='project_id') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='project_name') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='task_name') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "task_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='task_no') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "task_no" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='phase') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='start_date') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='end_date') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='duration_days') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "duration_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='actual_start_date') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "actual_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='actual_end_date') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "actual_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='actual_duration_days') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "actual_duration_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='owner') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "owner" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='assignee_user_id') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "assignee_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='status') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='pct_complete') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='expected_pct_complete') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "expected_pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='comment') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='is_milestone') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "is_milestone" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='parent_task_no') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "parent_task_no" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='indent_level') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "indent_level" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='source_sheet') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "source_sheet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='source_row') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='import_run_id') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='scheduled_date') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_plan_tasks' AND column_name='created_at') THEN
    ALTER TABLE "normalized_plan_tasks" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='project_id') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='project_name') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='description') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='milestone_name') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "milestone_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='amount_ex_vat') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "amount_ex_vat" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='vat') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "vat" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='invoice_number') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "invoice_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='invoice_date') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "invoice_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='invoice_date_font_color') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "invoice_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='invoice_date_confirmed') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "invoice_date_confirmed" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='expected_payment_date') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "expected_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='paid_date') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "paid_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='paid_date_font_color') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "paid_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='paid_date_confirmed') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "paid_date_confirmed" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='in_bank_date') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "in_bank_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='status') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "status" revenue_line_status DEFAULT 'PLANNED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='source_sheet') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "source_sheet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='source_row') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='import_run_id') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='turnaround_days') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "turnaround_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='sub_project_name') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='created_at') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='updated_at') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='effective_from') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='effective_to') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='normalized_revenue_lines' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "normalized_revenue_lines" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_throttle' AND column_name='recipient_user_id') THEN
    ALTER TABLE "notification_throttle" ADD COLUMN "recipient_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_throttle' AND column_name='event_type') THEN
    ALTER TABLE "notification_throttle" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_throttle' AND column_name='entity_type') THEN
    ALTER TABLE "notification_throttle" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_throttle' AND column_name='entity_id') THEN
    ALTER TABLE "notification_throttle" ADD COLUMN "entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_throttle' AND column_name='last_sent_at') THEN
    ALTER TABLE "notification_throttle" ADD COLUMN "last_sent_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='recipient_user_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "recipient_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='event_type') THEN
    ALTER TABLE "notifications" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='title') THEN
    ALTER TABLE "notifications" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='body') THEN
    ALTER TABLE "notifications" ADD COLUMN "body" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='project_name') THEN
    ALTER TABLE "notifications" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='project_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='linked_task_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='linked_deliverable_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "linked_deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='linked_warning_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "linked_warning_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='linked_plan_item_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "linked_plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='is_read') THEN
    ALTER TABLE "notifications" ADD COLUMN "is_read" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='read_at') THEN
    ALTER TABLE "notifications" ADD COLUMN "read_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='requires_confirmation') THEN
    ALTER TABLE "notifications" ADD COLUMN "requires_confirmation" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='confirmed_by_user_id') THEN
    ALTER TABLE "notifications" ADD COLUMN "confirmed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='confirmed_at') THEN
    ALTER TABLE "notifications" ADD COLUMN "confirmed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='change_details') THEN
    ALTER TABLE "notifications" ADD COLUMN "change_details" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='created_at') THEN
    ALTER TABLE "notifications" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_budget_monthly' AND column_name='month_key') THEN
    ALTER TABLE "opex_budget_monthly" ADD COLUMN "month_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_budget_monthly' AND column_name='amount') THEN
    ALTER TABLE "opex_budget_monthly" ADD COLUMN "amount" NUMERIC(15,2) DEFAULT '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_budget_monthly' AND column_name='updated_at') THEN
    ALTER TABLE "opex_budget_monthly" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_weekly_manual' AND column_name='week_start_date') THEN
    ALTER TABLE "opex_weekly_manual" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_weekly_manual' AND column_name='opex_amount') THEN
    ALTER TABLE "opex_weekly_manual" ADD COLUMN "opex_amount" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opex_weekly_manual' AND column_name='updated_at') THEN
    ALTER TABLE "opex_weekly_manual" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='name') THEN
    ALTER TABLE "organizations" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='slug') THEN
    ALTER TABLE "organizations" ADD COLUMN "slug" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='created_at') THEN
    ALTER TABLE "organizations" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='is_active') THEN
    ALTER TABLE "organizations" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='entity_type') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='entity_name') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "entity_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='terms_days') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "terms_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='scenario') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "scenario" TEXT DEFAULT 'base';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='created_by') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='created_at') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_terms' AND column_name='updated_at') THEN
    ALTER TABLE "payment_terms" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='client_id') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "client_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='client_name_snapshot') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "client_name_snapshot" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='project_id') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='project_site_name') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "project_site_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='due_date') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='request_type') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "request_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='priority') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "priority" TEXT DEFAULT 'Medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='status') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "status" TEXT DEFAULT 'Draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='number_of_reworks') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "number_of_reworks" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='project_developer_user_id') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "project_developer_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='designer_user_id') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "designer_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='funding_type') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "funding_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='size_kwp') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "size_kwp" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='province') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "province" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='gps_coordinates') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "gps_coordinates" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='bills_or_tariff_data') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "bills_or_tariff_data" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='metering_data_available') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "metering_data_available" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='site_inspection_form') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "site_inspection_form" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='site_inspection_link') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "site_inspection_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='working_schedule') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "working_schedule" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='batteries_needed') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "batteries_needed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='battery_size') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "battery_size" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='diesel_gen_integration') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "diesel_gen_integration" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='roof_replacement_needed') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "roof_replacement_needed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='hse_discussed') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "hse_discussed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='comments') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "comments" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='clickup_synced') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "clickup_synced" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='tasks_spawned_at') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "tasks_spawned_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='created_by') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='created_at') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pd_tickets' AND column_name='updated_at') THEN
    ALTER TABLE "pd_tickets" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='event_type') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='target_role') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "target_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='target_user_id') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "target_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='changed_by_user_id') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "changed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='changed_by_role') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "changed_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='change_detail') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "change_detail" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_audit_log' AND column_name='created_at') THEN
    ALTER TABLE "permission_audit_log" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='phase') THEN
    ALTER TABLE "phase_template" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='name') THEN
    ALTER TABLE "phase_template" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='version') THEN
    ALTER TABLE "phase_template" ADD COLUMN "version" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='is_active') THEN
    ALTER TABLE "phase_template" ADD COLUMN "is_active" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='created_by_user_id') THEN
    ALTER TABLE "phase_template" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='created_at') THEN
    ALTER TABLE "phase_template" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template' AND column_name='updated_at') THEN
    ALTER TABLE "phase_template" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='project_id') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='phase') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='template_id') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='template_version') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "template_version" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='applied_by_user_id') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "applied_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='applied_at') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "applied_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='application_key') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "application_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_application' AND column_name='result_summary_json') THEN
    ALTER TABLE "phase_template_application" ADD COLUMN "result_summary_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='template_id') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='item_key') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "item_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='item_type') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "item_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='title') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='description') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='primary_workstream') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "primary_workstream" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='default_status') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "default_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='default_priority') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "default_priority" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='offset_days_from_phase_start') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "offset_days_from_phase_start" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='requires_approval') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "requires_approval" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='approver_role') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "approver_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='link_target_type') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "link_target_type" TEXT DEFAULT 'NONE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='link_target_key') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "link_target_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='deliverable_type_key') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "deliverable_type_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='requires_qc_approval') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "requires_qc_approval" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='requires_operational_approval') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "requires_operational_approval" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='quality_item_key') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "quality_item_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='evidence_required') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "evidence_required" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='view_key') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "view_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='sort_order') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item' AND column_name='is_deleted') THEN
    ALTER TABLE "phase_template_item" ADD COLUMN "is_deleted" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item_history' AND column_name='template_item_id') THEN
    ALTER TABLE "phase_template_item_history" ADD COLUMN "template_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item_history' AND column_name='changed_by_user_id') THEN
    ALTER TABLE "phase_template_item_history" ADD COLUMN "changed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item_history' AND column_name='changed_at') THEN
    ALTER TABLE "phase_template_item_history" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phase_template_item_history' AND column_name='change_json') THEN
    ALTER TABLE "phase_template_item_history" ADD COLUMN "change_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='project_name') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='project_id') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='task_id') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='task_name') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "task_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='edit_type') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "edit_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='field_name') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "field_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='old_value') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "old_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='new_value') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "new_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='edited_by_user_id') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "edited_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='edited_by_name') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "edited_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='resolved_by_user_id') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "resolved_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='resolved_by_name') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "resolved_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='resolved_at') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "resolved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='resolution') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "resolution" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='status') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "status" TEXT DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_edit_notifications' AND column_name='created_at') THEN
    ALTER TABLE "plan_edit_notifications" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='project_id') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='user_id') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='week_start_date') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "week_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='daily_diary_done') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "daily_diary_done" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='weekly_progress_done') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "weekly_progress_done" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='weekly_risk_done') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "weekly_risk_done" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='created_at') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_compliance_tracking' AND column_name='updated_at') THEN
    ALTER TABLE "pm_compliance_tracking" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_mode_preferences' AND column_name='user_id') THEN
    ALTER TABLE "pm_mode_preferences" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_mode_preferences' AND column_name='preferred_mode') THEN
    ALTER TABLE "pm_mode_preferences" ADD COLUMN "preferred_mode" TEXT DEFAULT 'full_detail';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_mode_preferences' AND column_name='updated_at') THEN
    ALTER TABLE "pm_mode_preferences" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='project_id') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='user_id') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='action_type') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "action_type" pm_action_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='title') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='description') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='severity') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "severity" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='amount') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "amount" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='status') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "status" pm_action_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='related_entity_id') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "related_entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='related_entity_type') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "related_entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='metadata') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "metadata" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='created_at') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='created_by') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='updated_at') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='updated_by') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_on_the_go_actions' AND column_name='source') THEN
    ALTER TABLE "pm_on_the_go_actions" ADD COLUMN "source" TEXT DEFAULT 'on_the_go';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='project_id') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='user_id') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='visit_date') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "visit_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='notes') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='weather_conditions') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "weather_conditions" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='safety_status') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "safety_status" pm_safety_status DEFAULT 'clear';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='photo_ids') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "photo_ids" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='created_at') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='created_by') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='updated_at') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='updated_by') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pm_site_visits' AND column_name='source') THEN
    ALTER TABLE "pm_site_visits" ADD COLUMN "source" TEXT DEFAULT 'on_the_go';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='rollout_plan_id') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "rollout_plan_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='phase_name') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "phase_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='start_date') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='end_date') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='target_kwp') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "target_kwp" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='target_revenue') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "target_revenue" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_phases' AND column_name='sort_order') THEN
    ALTER TABLE "portfolio_rollout_phases" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='portfolio_id') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "portfolio_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='name') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='notes') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='created_by') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='updated_by') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='created_at') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_rollout_plans' AND column_name='updated_at') THEN
    ALTER TABLE "portfolio_rollout_plans" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='name') THEN
    ALTER TABLE "portfolios" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='client_name') THEN
    ALTER TABLE "portfolios" ADD COLUMN "client_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='status') THEN
    ALTER TABLE "portfolios" ADD COLUMN "status" TEXT DEFAULT 'Active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='description') THEN
    ALTER TABLE "portfolios" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='owner_user_id') THEN
    ALTER TABLE "portfolios" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='created_by') THEN
    ALTER TABLE "portfolios" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='updated_by') THEN
    ALTER TABLE "portfolios" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='created_at') THEN
    ALTER TABLE "portfolios" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolios' AND column_name='updated_at') THEN
    ALTER TABLE "portfolios" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='priority_id') THEN
    ALTER TABLE "priority_links" ADD COLUMN "priority_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='link_type') THEN
    ALTER TABLE "priority_links" ADD COLUMN "link_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='project_name') THEN
    ALTER TABLE "priority_links" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='project_id') THEN
    ALTER TABLE "priority_links" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='task_id') THEN
    ALTER TABLE "priority_links" ADD COLUMN "task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='task_type') THEN
    ALTER TABLE "priority_links" ADD COLUMN "task_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='priority_links' AND column_name='created_at') THEN
    ALTER TABLE "priority_links" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='project_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='title') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='description') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='category') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "category" procurement_category DEFAULT 'other';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='quantity') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "quantity" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='unit') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "unit" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='expected_cost') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "expected_cost" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='actual_cost') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "actual_cost" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='supplier_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "supplier_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='requested_by_user_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "requested_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='owner_user_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='status') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "status" procurement_status DEFAULT 'requested';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='required_date') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "required_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='po_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "po_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='invoice_ref') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "invoice_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='linked_invoice_capture_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "linked_invoice_capture_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='budget_line') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "budget_line" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='linked_deliverable_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "linked_deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='linked_milestone') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "linked_milestone" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='progress_percent') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "progress_percent" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='receipt_ref') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "receipt_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='payment_status') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "payment_status" procurement_payment_status DEFAULT 'not_applicable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='linked_task_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='approval_id') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "approval_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='notes') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='created_at') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='procurement_items' AND column_name='updated_at') THEN
    ALTER TABLE "procurement_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='project_name') THEN
    ALTER TABLE "program_expense" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='row_number') THEN
    ALTER TABLE "program_expense" ADD COLUMN "row_number" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='row_type') THEN
    ALTER TABLE "program_expense" ADD COLUMN "row_type" TEXT DEFAULT 'item';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_category') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_line_item') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_line_item" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='budget_qty') THEN
    ALTER TABLE "program_expense" ADD COLUMN "budget_qty" NUMERIC(12,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='budget_rate_unit') THEN
    ALTER TABLE "program_expense" ADD COLUMN "budget_rate_unit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='budget_total') THEN
    ALTER TABLE "program_expense" ADD COLUMN "budget_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='forecast_payment_date') THEN
    ALTER TABLE "program_expense" ADD COLUMN "forecast_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='budget_cos_total') THEN
    ALTER TABLE "program_expense" ADD COLUMN "budget_cos_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_qty') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_qty" NUMERIC(12,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_rate_unit') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_rate_unit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_actual_total') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_actual_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_po_number') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_po_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_invoice_number') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_invoice_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_invoiced_date') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_invoiced_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='invoice_date_confirmed') THEN
    ALTER TABLE "program_expense" ADD COLUMN "invoice_date_confirmed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='invoice_date_font_color') THEN
    ALTER TABLE "program_expense" ADD COLUMN "invoice_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_payment_date') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='payment_date_confirmed') THEN
    ALTER TABLE "program_expense" ADD COLUMN "payment_date_confirmed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='payment_date_font_color') THEN
    ALTER TABLE "program_expense" ADD COLUMN "payment_date_font_color" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='revenue_amount') THEN
    ALTER TABLE "program_expense" ADD COLUMN "revenue_amount" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='actual_cos_total') THEN
    ALTER TABLE "program_expense" ADD COLUMN "actual_cos_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='line_status') THEN
    ALTER TABLE "program_expense" ADD COLUMN "line_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='expense_line_hash') THEN
    ALTER TABLE "program_expense" ADD COLUMN "expense_line_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='computed_state') THEN
    ALTER TABLE "program_expense" ADD COLUMN "computed_state" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='computed_forecast_payment_date') THEN
    ALTER TABLE "program_expense" ADD COLUMN "computed_forecast_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='supplier_name') THEN
    ALTER TABLE "program_expense" ADD COLUMN "supplier_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='is_manual') THEN
    ALTER TABLE "program_expense" ADD COLUMN "is_manual" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='sub_project_name') THEN
    ALTER TABLE "program_expense" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='data_source') THEN
    ALTER TABLE "program_expense" ADD COLUMN "data_source" TEXT DEFAULT 'SMART_IMPORT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='project_id') THEN
    ALTER TABLE "program_expense" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='import_run_id') THEN
    ALTER TABLE "program_expense" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='source') THEN
    ALTER TABLE "program_expense" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='import_snapshot') THEN
    ALTER TABLE "program_expense" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='last_edited_by') THEN
    ALTER TABLE "program_expense" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='last_edited_at') THEN
    ALTER TABLE "program_expense" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='created_at') THEN
    ALTER TABLE "program_expense" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='effective_from') THEN
    ALTER TABLE "program_expense" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='effective_to') THEN
    ALTER TABLE "program_expense" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_expense' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "program_expense" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='project_name') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='row_number') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "row_number" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_no') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_no" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_name') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_percent') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_percent" NUMERIC(6,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_amount') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_amount" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='planned_payment_date') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "planned_payment_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_invoice_number') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_invoice_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='invoice_raised_date') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "invoice_raised_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='payment_received_date') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "payment_received_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='milestone_notes') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "milestone_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='documents_received') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "documents_received" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='in_bank') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "in_bank" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='inflow_line_hash') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "inflow_line_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='computed_forecast_receipt_date') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "computed_forecast_receipt_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='sub_project_name') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='data_source') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "data_source" TEXT DEFAULT 'SMART_IMPORT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='project_id') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='import_run_id') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='source') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='import_snapshot') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='last_edited_by') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='last_edited_at') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='created_at') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='effective_from') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='effective_to') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='program_inflows' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "program_inflows" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='project_id') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='old_client_id') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "old_client_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='new_client_id') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "new_client_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='moved_by_user_id') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "moved_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='moved_at') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "moved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_client_history' AND column_name='reason') THEN
    ALTER TABLE "project_client_history" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='project_id') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='ms_object_id') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "ms_object_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='event_type') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='event_title') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "event_title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='event_detail') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "event_detail" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='related_task_id') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "related_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='actor_user_id') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "actor_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_communication_timeline_events' AND column_name='created_at') THEN
    ALTER TABLE "project_communication_timeline_events" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='project_name') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='project_id') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='cost_proposal_signed') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "cost_proposal_signed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='funding_signed') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "funding_signed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='epc_contract_signed') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "epc_contract_signed" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='cost_proposal_type') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "cost_proposal_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='cost_proposal_link') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "cost_proposal_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='cost_proposal_na_reason') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "cost_proposal_na_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='funding_type') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "funding_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='funding_link') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "funding_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='funding_na_reason') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "funding_na_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='epc_contract_type') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "epc_contract_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='epc_contract_link') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "epc_contract_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='epc_contract_na_reason') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "epc_contract_na_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='current_vo_total') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "current_vo_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='comments') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "comments" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='latest_update') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "latest_update" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='latest_update_at') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "latest_update_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='latest_update_by') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "latest_update_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_editable_fields' AND column_name='updated_at') THEN
    ALTER TABLE "project_editable_fields" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='project_eng_stage_id') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "project_eng_stage_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='approver_role') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "approver_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='approver_user_id') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "approver_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='status') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "status" eng_approval_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='comments') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "comments" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='created_at') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_approvals' AND column_name='updated_at') THEN
    ALTER TABLE "project_eng_approvals" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='project_eng_stage_id') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "project_eng_stage_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='deliverable_template_id') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "deliverable_template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='project_eng_task_id') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "project_eng_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='file_name') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='file_size') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "file_size" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='mime_type') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "mime_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='storage_ref') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "storage_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='uploaded_by') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "uploaded_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='uploaded_at') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='version_tag') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "version_tag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='notes') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='sharepoint_folder_path') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "sharepoint_folder_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='approval_status') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "approval_status" TEXT DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='approved_by') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "approved_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_deliverables' AND column_name='approved_at') THEN
    ALTER TABLE "project_eng_deliverables" ADD COLUMN "approved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='project_id') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='stage_template_id') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "stage_template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='status') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "status" eng_stage_status DEFAULT 'not_started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='started_at') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "started_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='completed_at') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='override_reason') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "override_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='created_by') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_stages' AND column_name='created_at') THEN
    ALTER TABLE "project_eng_stages" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='project_eng_stage_id') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "project_eng_stage_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='task_template_id') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "task_template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='status') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "status" eng_task_instance_status DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='owner_user_id') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='notes') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='due_date') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='completed_at') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='completed_by') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "completed_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='has_deliverable') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "has_deliverable" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='work_item_id') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_eng_tasks' AND column_name='created_at') THEN
    ALTER TABLE "project_eng_tasks" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='project_id') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='phase') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='phase_updated_at') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "phase_updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='phase_updated_by_user_id') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "phase_updated_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='phase_notes') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "phase_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='pd_handover_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "pd_handover_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='construction_start_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "construction_start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='commissioning_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "commissioning_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='om_handover_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "om_handover_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='client_handover_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "client_handover_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='construction_start_actual') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "construction_start_actual" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='pd_handover_actual') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "pd_handover_actual" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='commissioning_actual') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "commissioning_actual" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='client_handover_actual') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "client_handover_actual" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='escalation_level') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "escalation_level" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='rag_status') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "rag_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='rag_comment') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "rag_comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='rag_updated_at') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "rag_updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='rag_updated_by_user_id') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "rag_updated_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='is_active') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='archived_status') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "archived_status" TEXT DEFAULT 'ACTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='execution_enabled') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "execution_enabled" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='execution_gate_status') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "execution_gate_status" TEXT DEFAULT 'NOT_ELIGIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='execution_gate_reason') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "execution_gate_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='execution_phase') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "execution_phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='signed_status') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "signed_status" TEXT DEFAULT 'NONE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='signed_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "signed_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='signed_document_link') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "signed_document_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='cp_signed') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "cp_signed" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='cp_signed_date') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "cp_signed_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='cp_signed_by_user_id') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "cp_signed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='cp_evidence_type') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "cp_evidence_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='cp_evidence_ref') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "cp_evidence_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='pm_task_pack_created') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "pm_task_pack_created" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='eng_post_cp_task_pack_created') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "eng_post_cp_task_pack_created" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='created_at') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_execution_state' AND column_name='updated_at') THEN
    ALTER TABLE "project_execution_state" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='project_id') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='gate_name') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "gate_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='from_stage') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "from_stage" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='target_stage') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "target_stage" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='status') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='missing_items') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "missing_items" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='has_override') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "has_override" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='override_id') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "override_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='evaluated_by_user_id') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "evaluated_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='evaluated_by_role') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "evaluated_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_gate_evaluations' AND column_name='evaluated_at') THEN
    ALTER TABLE "project_gate_evaluations" ADD COLUMN "evaluated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='project_id') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='gate_id') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "gate_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='status') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "status" TEXT DEFAULT 'PENDING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='checked_items') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "checked_items" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='completed_at') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='completed_by_user_id') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "completed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='completed_by_name') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "completed_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='notes') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='created_at') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_gates' AND column_name='updated_at') THEN
    ALTER TABLE "project_handover_gates" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='project_id') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='gate_id') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "gate_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='action') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='performed_by_user_id') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "performed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='performed_by_name') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "performed_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='performed_by_role') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "performed_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='details') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "details" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_handover_history' AND column_name='performed_at') THEN
    ALTER TABLE "project_handover_history" ADD COLUMN "performed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='project_name') THEN
    ALTER TABLE "project_info" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='size_kwp') THEN
    ALTER TABLE "project_info" ADD COLUMN "size_kwp" NUMERIC(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='pd') THEN
    ALTER TABLE "project_info" ADD COLUMN "pd" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='pm') THEN
    ALTER TABLE "project_info" ADD COLUMN "pm" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='contract_value') THEN
    ALTER TABLE "project_info" ADD COLUMN "contract_value" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='canonical_project_id') THEN
    ALTER TABLE "project_info" ADD COLUMN "canonical_project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='client_id') THEN
    ALTER TABLE "project_info" ADD COLUMN "client_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='pm_user_id') THEN
    ALTER TABLE "project_info" ADD COLUMN "pm_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='pd_user_id') THEN
    ALTER TABLE "project_info" ADD COLUMN "pd_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_info' AND column_name='updated_at') THEN
    ALTER TABLE "project_info" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='table_name') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "table_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='record_id') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "record_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='reason') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='context_json') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "context_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='resolved_at') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "resolved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='resolved_by_user_id') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "resolved_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_linkage_review_queue' AND column_name='created_at') THEN
    ALTER TABLE "project_linkage_review_queue" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_links' AND column_name='ms_object_id') THEN
    ALTER TABLE "project_links" ADD COLUMN "ms_object_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_links' AND column_name='project_id') THEN
    ALTER TABLE "project_links" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_links' AND column_name='linked_by_user_id') THEN
    ALTER TABLE "project_links" ADD COLUMN "linked_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_links' AND column_name='linked_at') THEN
    ALTER TABLE "project_links" ADD COLUMN "linked_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_links' AND column_name='note') THEN
    ALTER TABLE "project_links" ADD COLUMN "note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='project_id') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='status') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "status" TEXT DEFAULT 'DRAFT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='handover_status_text') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "handover_status_text" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='pd_owner') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "pd_owner" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='pm_owner') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "pm_owner" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='summary') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='risks') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "risks" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='assumptions') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "assumptions" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='engineering_status') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "engineering_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='quality_status') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "quality_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='notes_to_pm') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "notes_to_pm" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='handover_summary') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "handover_summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='deliverables') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "deliverables" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='submitted_by') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "submitted_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='submitted_at') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "submitted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='accepted_by') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "accepted_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='accepted_at') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "accepted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='rejected_by') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "rejected_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='rejected_at') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "rejected_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='rejection_reason') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "rejection_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='created_at') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_pd_pm_handover' AND column_name='updated_at') THEN
    ALTER TABLE "project_pd_pm_handover" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='project_id') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='from_phase') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "from_phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='to_phase') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "to_phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='changed_by_user_id') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "changed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='changed_at') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_phase_history' AND column_name='reason') THEN
    ALTER TABLE "project_phase_history" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='project_name') THEN
    ALTER TABLE "project_plan" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='project_id') THEN
    ALTER TABLE "project_plan" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='row_number') THEN
    ALTER TABLE "project_plan" ADD COLUMN "row_number" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='task_no') THEN
    ALTER TABLE "project_plan" ADD COLUMN "task_no" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='high_level_programme') THEN
    ALTER TABLE "project_plan" ADD COLUMN "high_level_programme" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='actual_start') THEN
    ALTER TABLE "project_plan" ADD COLUMN "actual_start" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='duration_days') THEN
    ALTER TABLE "project_plan" ADD COLUMN "duration_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='actual_end') THEN
    ALTER TABLE "project_plan" ADD COLUMN "actual_end" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='actual_pct_complete') THEN
    ALTER TABLE "project_plan" ADD COLUMN "actual_pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='expected_pct_complete') THEN
    ALTER TABLE "project_plan" ADD COLUMN "expected_pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='source') THEN
    ALTER TABLE "project_plan" ADD COLUMN "source" row_source DEFAULT 'imported';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='import_snapshot') THEN
    ALTER TABLE "project_plan" ADD COLUMN "import_snapshot" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='last_edited_by') THEN
    ALTER TABLE "project_plan" ADD COLUMN "last_edited_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='last_edited_at') THEN
    ALTER TABLE "project_plan" ADD COLUMN "last_edited_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan' AND column_name='created_at') THEN
    ALTER TABLE "project_plan" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='project_name') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='project_id') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='predecessor_task_id') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "predecessor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='successor_task_id') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "successor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='dependency_type') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "dependency_type" TEXT DEFAULT 'FS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='lag_days') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "lag_days" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_plan_dependency' AND column_name='created_at') THEN
    ALTER TABLE "project_plan_dependency" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='project_id') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='portfolio_id') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "portfolio_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='assigned_by') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "assigned_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='assigned_at') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "assigned_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='moved_by') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "moved_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_portfolio_assignments' AND column_name='moved_at') THEN
    ALTER TABLE "project_portfolio_assignments" ADD COLUMN "moved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='project_id') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='from_rag') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "from_rag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='to_rag') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "to_rag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='comment') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='changed_by_user_id') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "changed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_rag_audit' AND column_name='changed_at') THEN
    ALTER TABLE "project_rag_audit" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='project_name') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='planned_revenue') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "planned_revenue" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='planned_expenditure') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "planned_expenditure" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='planned_profit') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "planned_profit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='planned_margin') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "planned_margin" NUMERIC(6,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='actual_revenue') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "actual_revenue" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='actual_expenditure') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "actual_expenditure" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='actual_profit') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "actual_profit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='actual_margin') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "actual_margin" NUMERIC(6,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='vo_pm_limit') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "vo_pm_limit" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='current_vo_total') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "current_vo_total" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='project_id') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='captured_at') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "captured_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='effective_from') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "effective_from" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='effective_to') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "effective_to" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_revenue_summary' AND column_name='snapshot_run_id') THEN
    ALTER TABLE "project_revenue_summary" ADD COLUMN "snapshot_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_settings' AND column_name='project_id') THEN
    ALTER TABLE "project_settings" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_settings' AND column_name='excel_tracker_link') THEN
    ALTER TABLE "project_settings" ADD COLUMN "excel_tracker_link" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_settings' AND column_name='created_at') THEN
    ALTER TABLE "project_settings" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_settings' AND column_name='updated_at') THEN
    ALTER TABLE "project_settings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='project_id') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='counterparty_id') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "counterparty_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='work_package') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "work_package" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='scope_description') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "scope_description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='owner_user_id') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='status') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "status" subcontractor_assignment_status DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='key_dates') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "key_dates" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='performance_notes') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "performance_notes" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='linked_approval_id') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "linked_approval_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='created_at') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_subcontractor_assignments' AND column_name='updated_at') THEN
    ALTER TABLE "project_subcontractor_assignments" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_team_members' AND column_name='project_name') THEN
    ALTER TABLE "project_team_members" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_team_members' AND column_name='project_id') THEN
    ALTER TABLE "project_team_members" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_team_members' AND column_name='user_id') THEN
    ALTER TABLE "project_team_members" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_team_members' AND column_name='role_on_project') THEN
    ALTER TABLE "project_team_members" ADD COLUMN "role_on_project" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_team_members' AND column_name='created_at') THEN
    ALTER TABLE "project_team_members" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='user_id') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='role') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='last_success_at') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "last_success_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='failed_attempts_count') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "failed_attempts_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='locked_until') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "locked_until" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='created_at') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_access_challenge' AND column_name='updated_at') THEN
    ALTER TABLE "qc_access_challenge" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_checklist' AND column_name='project_id') THEN
    ALTER TABLE "qc_checklist" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_checklist' AND column_name='project_name') THEN
    ALTER TABLE "qc_checklist" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_checklist' AND column_name='template_id') THEN
    ALTER TABLE "qc_checklist" ADD COLUMN "template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_checklist' AND column_name='status') THEN
    ALTER TABLE "qc_checklist" ADD COLUMN "status" TEXT DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_checklist' AND column_name='created_at') THEN
    ALTER TABLE "qc_checklist" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_evidence' AND column_name='project_id') THEN
    ALTER TABLE "qc_item_evidence" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_evidence' AND column_name='item_instance_id') THEN
    ALTER TABLE "qc_item_evidence" ADD COLUMN "item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_evidence' AND column_name='evidence_url') THEN
    ALTER TABLE "qc_item_evidence" ADD COLUMN "evidence_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_evidence' AND column_name='evidence_note') THEN
    ALTER TABLE "qc_item_evidence" ADD COLUMN "evidence_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_evidence' AND column_name='created_at') THEN
    ALTER TABLE "qc_item_evidence" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='checklist_id') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "checklist_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='template_item_id') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "template_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='is_applicable') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "is_applicable" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='start_date') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='end_date') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='approved') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "approved" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='approved_by_user_id') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "approved_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='approved_at') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "approved_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='approval_comment') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "approval_comment" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='not_applicable_reason') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "not_applicable_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='working_days') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "working_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='allowed_working_days') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "allowed_working_days" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='qm_status') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "qm_status" TEXT DEFAULT 'not_started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='assignee_user_id') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "assignee_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='last_updated_at') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "last_updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='scheduled_date') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_item_instance' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "qc_item_instance" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='project_name') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='project_id') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='plan_item_id') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='item_instance_id') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='phase_id') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "phase_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='link_type') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "link_type" TEXT DEFAULT 'phase_task';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_plan_link' AND column_name='created_at') THEN
    ALTER TABLE "qc_plan_link" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem' AND column_name='project_name') THEN
    ALTER TABLE "qc_postmortem" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem' AND column_name='project_id') THEN
    ALTER TABLE "qc_postmortem" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem' AND column_name='completed_at') THEN
    ALTER TABLE "qc_postmortem" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem' AND column_name='completed_by_user_id') THEN
    ALTER TABLE "qc_postmortem" ADD COLUMN "completed_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem' AND column_name='created_at') THEN
    ALTER TABLE "qc_postmortem" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_metric_value' AND column_name='postmortem_id') THEN
    ALTER TABLE "qc_postmortem_metric_value" ADD COLUMN "postmortem_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_metric_value' AND column_name='template_metric_id') THEN
    ALTER TABLE "qc_postmortem_metric_value" ADD COLUMN "template_metric_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_metric_value' AND column_name='input_value_number') THEN
    ALTER TABLE "qc_postmortem_metric_value" ADD COLUMN "input_value_number" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_metric_value' AND column_name='input_value_choice') THEN
    ALTER TABLE "qc_postmortem_metric_value" ADD COLUMN "input_value_choice" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_metric_value' AND column_name='score') THEN
    ALTER TABLE "qc_postmortem_metric_value" ADD COLUMN "score" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_summary' AND column_name='postmortem_id') THEN
    ALTER TABLE "qc_postmortem_summary" ADD COLUMN "postmortem_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_summary' AND column_name='contractor_quality_score') THEN
    ALTER TABLE "qc_postmortem_summary" ADD COLUMN "contractor_quality_score" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_summary' AND column_name='engineering_quality_score') THEN
    ALTER TABLE "qc_postmortem_summary" ADD COLUMN "engineering_quality_score" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_postmortem_summary' AND column_name='red_flag') THEN
    ALTER TABLE "qc_postmortem_summary" ADD COLUMN "red_flag" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='checklist_id') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "checklist_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='template_risk_question_id') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "template_risk_question_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='answer_yesno') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "answer_yesno" BOOLEAN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='answer_text') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "answer_text" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='answer_number') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "answer_number" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='last_updated_by') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "last_updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_risk_answer' AND column_name='last_updated_at') THEN
    ALTER TABLE "qc_risk_answer" ADD COLUMN "last_updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template' AND column_name='name') THEN
    ALTER TABLE "qc_template" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template' AND column_name='version') THEN
    ALTER TABLE "qc_template" ADD COLUMN "version" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template' AND column_name='is_active') THEN
    ALTER TABLE "qc_template" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template' AND column_name='created_at') THEN
    ALTER TABLE "qc_template" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_group' AND column_name='template_phase_id') THEN
    ALTER TABLE "qc_template_group" ADD COLUMN "template_phase_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_group' AND column_name='group_name') THEN
    ALTER TABLE "qc_template_group" ADD COLUMN "group_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_group' AND column_name='sort_order') THEN
    ALTER TABLE "qc_template_group" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_item' AND column_name='template_group_id') THEN
    ALTER TABLE "qc_template_item" ADD COLUMN "template_group_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_item' AND column_name='item_name') THEN
    ALTER TABLE "qc_template_item" ADD COLUMN "item_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_item' AND column_name='sort_order') THEN
    ALTER TABLE "qc_template_item" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_item' AND column_name='is_evidence_required') THEN
    ALTER TABLE "qc_template_item" ADD COLUMN "is_evidence_required" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_item' AND column_name='default_severity') THEN
    ALTER TABLE "qc_template_item" ADD COLUMN "default_severity" TEXT DEFAULT 'Medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_phase' AND column_name='template_id') THEN
    ALTER TABLE "qc_template_phase" ADD COLUMN "template_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_phase' AND column_name='phase_key') THEN
    ALTER TABLE "qc_template_phase" ADD COLUMN "phase_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_phase' AND column_name='phase_name') THEN
    ALTER TABLE "qc_template_phase" ADD COLUMN "phase_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_phase' AND column_name='sort_order') THEN
    ALTER TABLE "qc_template_phase" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_postmortem_metric' AND column_name='name') THEN
    ALTER TABLE "qc_template_postmortem_metric" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_postmortem_metric' AND column_name='input_type') THEN
    ALTER TABLE "qc_template_postmortem_metric" ADD COLUMN "input_type" TEXT DEFAULT 'count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_postmortem_metric' AND column_name='scoring_rule_json') THEN
    ALTER TABLE "qc_template_postmortem_metric" ADD COLUMN "scoring_rule_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_postmortem_metric' AND column_name='metric_group') THEN
    ALTER TABLE "qc_template_postmortem_metric" ADD COLUMN "metric_group" TEXT DEFAULT 'contractor_quality';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='template_phase_id') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "template_phase_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='question_text') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "question_text" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='sort_order') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='response_type') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "response_type" TEXT DEFAULT 'yesno';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='triggers_warning') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "triggers_warning" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='trigger_condition') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "trigger_condition" TEXT DEFAULT 'yes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_template_risk_question' AND column_name='trigger_severity') THEN
    ALTER TABLE "qc_template_risk_question" ADD COLUMN "trigger_severity" TEXT DEFAULT 'Medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='project_name') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='project_id') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='severity') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "severity" TEXT DEFAULT 'Medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='warning_type') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "warning_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='title') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='description') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='related_plan_item_id') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "related_plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='related_item_instance_id') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "related_item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='status') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "status" TEXT DEFAULT 'open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='owner_user_id') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='due_date') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='created_at') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning' AND column_name='updated_at') THEN
    ALTER TABLE "qc_warning" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning_event' AND column_name='warning_id') THEN
    ALTER TABLE "qc_warning_event" ADD COLUMN "warning_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning_event' AND column_name='event_type') THEN
    ALTER TABLE "qc_warning_event" ADD COLUMN "event_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning_event' AND column_name='note') THEN
    ALTER TABLE "qc_warning_event" ADD COLUMN "note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning_event' AND column_name='actor_user_id') THEN
    ALTER TABLE "qc_warning_event" ADD COLUMN "actor_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qc_warning_event' AND column_name='created_at') THEN
    ALTER TABLE "qc_warning_event" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='project_id') THEN
    ALTER TABLE "raid_items" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='type') THEN
    ALTER TABLE "raid_items" ADD COLUMN "type" raid_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='title') THEN
    ALTER TABLE "raid_items" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='description') THEN
    ALTER TABLE "raid_items" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='owner_user_id') THEN
    ALTER TABLE "raid_items" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='status') THEN
    ALTER TABLE "raid_items" ADD COLUMN "status" raid_status DEFAULT 'open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='priority') THEN
    ALTER TABLE "raid_items" ADD COLUMN "priority" raid_priority DEFAULT 'medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='due_date') THEN
    ALTER TABLE "raid_items" ADD COLUMN "due_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='mitigation_response') THEN
    ALTER TABLE "raid_items" ADD COLUMN "mitigation_response" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='linked_task_id') THEN
    ALTER TABLE "raid_items" ADD COLUMN "linked_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='created_by_user_id') THEN
    ALTER TABLE "raid_items" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='created_at') THEN
    ALTER TABLE "raid_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='updated_at') THEN
    ALTER TABLE "raid_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='raid_items' AND column_name='closed_at') THEN
    ALTER TABLE "raid_items" ADD COLUMN "closed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refresh_logs' AND column_name='refreshed_at') THEN
    ALTER TABLE "refresh_logs" ADD COLUMN "refreshed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refresh_logs' AND column_name='triggered_by') THEN
    ALTER TABLE "refresh_logs" ADD COLUMN "triggered_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='refresh_logs' AND column_name='status') THEN
    ALTER TABLE "refresh_logs" ADD COLUMN "status" TEXT DEFAULT 'success';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='role') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='password_hash') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "password_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='last_password_plain') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "last_password_plain" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='failed_attempts') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "failed_attempts" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='locked_until') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "locked_until" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='updated_by') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='updated_at') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_credentials' AND column_name='created_at') THEN
    ALTER TABLE "role_credentials" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='role') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='label') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "label" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='description') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='sections') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "sections" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='can_manage_users') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "can_manage_users" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='can_manage_roles') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "can_manage_roles" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='can_edit_data') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "can_edit_data" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='entity_permissions') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "entity_permissions" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='authority_model') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "authority_model" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='is_system') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "is_system" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='permission_version') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "permission_version" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='created_at') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='role_permissions' AND column_name='updated_at') THEN
    ALTER TABLE "role_permissions" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='name') THEN
    ALTER TABLE "scenarios" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='description') THEN
    ALTER TABLE "scenarios" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='created_by') THEN
    ALTER TABLE "scenarios" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='is_default') THEN
    ALTER TABLE "scenarios" ADD COLUMN "is_default" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='created_at') THEN
    ALTER TABLE "scenarios" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='project_name') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='project_id') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='summary') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='old_finish_date') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "old_finish_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='new_finish_date') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "new_finish_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='changed_tasks') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "changed_tasks" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='critical_path_delta') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "critical_path_delta" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='user_note') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "user_note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='client_notified') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "client_notified" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='documentation_updated') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "documentation_updated" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='created_by') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_change_notice' AND column_name='created_at') THEN
    ALTER TABLE "schedule_change_notice" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='project_id') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='project_name') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='uploaded_by') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "uploaded_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='uploaded_at') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='source_file_name') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "source_file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='source_file_hash') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "source_file_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='status') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "status" smart_import_status DEFAULT 'PREVIEW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='template_profile_id') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "template_profile_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='summary_json') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "summary_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='committed_at') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "committed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='committed_by') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "committed_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='records_attempted') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "records_attempted" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='records_succeeded') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "records_succeeded" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='records_failed') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "records_failed" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_import_runs' AND column_name='import_type') THEN
    ALTER TABLE "smart_import_runs" ADD COLUMN "import_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='snapshot_id') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "snapshot_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='table_name') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "table_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='row_count') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "row_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='checksum') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "checksum" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='min_date') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "min_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='max_date') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "max_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshot_metrics' AND column_name='totals_json') THEN
    ALTER TABLE "snapshot_metrics" ADD COLUMN "totals_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='file_id') THEN
    ALTER TABLE "snapshots" ADD COLUMN "file_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='imported_at') THEN
    ALTER TABLE "snapshots" ADD COLUMN "imported_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='source_etag') THEN
    ALTER TABLE "snapshots" ADD COLUMN "source_etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='content_hash') THEN
    ALTER TABLE "snapshots" ADD COLUMN "content_hash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='row_count_total') THEN
    ALTER TABLE "snapshots" ADD COLUMN "row_count_total" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='parser_version') THEN
    ALTER TABLE "snapshots" ADD COLUMN "parser_version" TEXT DEFAULT '1.0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='storage_ref') THEN
    ALTER TABLE "snapshots" ADD COLUMN "storage_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='snapshots' AND column_name='created_at') THEN
    ALTER TABLE "snapshots" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='entity_type') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='entity_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "entity_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='site_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='drive_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "drive_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='folder_item_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "folder_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='file_item_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "file_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='file_name') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='web_url') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "web_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='uploaded_by_user_id') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "uploaded_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_file_pointers' AND column_name='uploaded_at') THEN
    ALTER TABLE "sp_file_pointers" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='site_id') THEN
    ALTER TABLE "sp_files" ADD COLUMN "site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='drive_id') THEN
    ALTER TABLE "sp_files" ADD COLUMN "drive_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='item_id') THEN
    ALTER TABLE "sp_files" ADD COLUMN "item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='path') THEN
    ALTER TABLE "sp_files" ADD COLUMN "path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='file_name') THEN
    ALTER TABLE "sp_files" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='last_seen_etag') THEN
    ALTER TABLE "sp_files" ADD COLUMN "last_seen_etag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='last_seen_ctag') THEN
    ALTER TABLE "sp_files" ADD COLUMN "last_seen_ctag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='sp_last_modified_at') THEN
    ALTER TABLE "sp_files" ADD COLUMN "sp_last_modified_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='sp_last_modified_by_name') THEN
    ALTER TABLE "sp_files" ADD COLUMN "sp_last_modified_by_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='sp_last_modified_by_email') THEN
    ALTER TABLE "sp_files" ADD COLUMN "sp_last_modified_by_email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='is_active') THEN
    ALTER TABLE "sp_files" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='created_at') THEN
    ALTER TABLE "sp_files" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_files' AND column_name='updated_at') THEN
    ALTER TABLE "sp_files" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='site_id') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='list_id') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "list_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='site_name') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "site_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='list_name') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "list_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='site_url') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "site_url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='column_mapping_json') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "column_mapping_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='field_ownership_json') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "field_ownership_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='last_pulled_at') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "last_pulled_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='last_pushed_at') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "last_pushed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='last_delta_token') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "last_delta_token" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='sync_view_filter') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "sync_view_filter" TEXT DEFAULT 'IN PROGRESS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='configured_by_role') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "configured_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='created_at') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_list_config' AND column_name='updated_at') THEN
    ALTER TABLE "sp_list_config" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='site_id') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "site_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='drive_id') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "drive_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='folder_item_id') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "folder_item_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='folder_path') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "folder_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='interval_minutes') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "interval_minutes" INTEGER DEFAULT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='enabled') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "enabled" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='last_run_at') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "last_run_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='updated_at') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sp_settings' AND column_name='updated_by') THEN
    ALTER TABLE "sp_settings" ADD COLUMN "updated_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='gate_name') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "gate_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='from_stage') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "from_stage" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='target_stage') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "target_stage" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='requirement_type') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "requirement_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='requirement_key') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "requirement_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='requirement_config') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "requirement_config" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='is_required') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "is_required" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='sort_order') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='is_active') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='created_at') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_definitions' AND column_name='updated_at') THEN
    ALTER TABLE "stage_gate_definitions" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='project_id') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='gate_name') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "gate_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='target_stage') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "target_stage" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='override_reason') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "override_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='overridden_by') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "overridden_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='overridden_by_role') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "overridden_by_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='note') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='expires_at') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "expires_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='is_active') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='created_at') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stage_gate_overrides' AND column_name='revoked_at') THEN
    ALTER TABLE "stage_gate_overrides" ADD COLUMN "revoked_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='schedule_id') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "schedule_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='user_id') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='standup_date') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "standup_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='what_i_did') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "what_i_did" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='what_im_doing') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "what_im_doing" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='blockers') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "blockers" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='mood') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "mood" standup_mood;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='is_late') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "is_late" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='submitted_at') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "submitted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_entries' AND column_name='updated_at') THEN
    ALTER TABLE "standup_entries" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_participants' AND column_name='schedule_id') THEN
    ALTER TABLE "standup_participants" ADD COLUMN "schedule_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_participants' AND column_name='user_id') THEN
    ALTER TABLE "standup_participants" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_participants' AND column_name='is_required') THEN
    ALTER TABLE "standup_participants" ADD COLUMN "is_required" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_participants' AND column_name='added_at') THEN
    ALTER TABLE "standup_participants" ADD COLUMN "added_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='name') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='team_label') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "team_label" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='project_id') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='cadence') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "cadence" standup_cadence DEFAULT 'EVERY_2_DAYS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='cadence_days') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "cadence_days" INTEGER DEFAULT 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='anchor_date') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "anchor_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='deadline_time') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "deadline_time" TEXT DEFAULT '10:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='is_active') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='created_by') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='created_at') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='standup_schedules' AND column_name='updated_at') THEN
    ALTER TABLE "standup_schedules" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='user_id') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='summary') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "summary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='steps_to_reproduce') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "steps_to_reproduce" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='current_route') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "current_route" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='user_agent') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "user_agent" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='correlation_id') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "correlation_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='status') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "status" TEXT DEFAULT 'open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='created_at') THEN
    ALTER TABLE "support_tickets" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='action') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='actor_role') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "actor_role" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='direction') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "direction" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='summary') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "summary" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='errors_json') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "errors_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='conflicts_json') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "conflicts_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='item_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "item_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='new_projects_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "new_projects_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='new_requests_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "new_requests_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='updated_requests_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "updated_requests_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='conflicts_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "conflicts_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='errors_count') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "errors_count" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_audit_log' AND column_name='created_at') THEN
    ALTER TABLE "sync_audit_log" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='work_item_id') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='actor_id') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "actor_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='action_type') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "action_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='field_name') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "field_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='old_value') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "old_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='new_value') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "new_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_activity_log' AND column_name='created_at') THEN
    ALTER TABLE "task_activity_log" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='work_item_id') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='filename') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "filename" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='url') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "url" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='mime_type') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "mime_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='size_bytes') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "size_bytes" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='uploaded_by') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "uploaded_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_attachments' AND column_name='created_at') THEN
    ALTER TABLE "task_attachments" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklist_items' AND column_name='checklist_id') THEN
    ALTER TABLE "task_checklist_items" ADD COLUMN "checklist_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklist_items' AND column_name='content') THEN
    ALTER TABLE "task_checklist_items" ADD COLUMN "content" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklist_items' AND column_name='is_done') THEN
    ALTER TABLE "task_checklist_items" ADD COLUMN "is_done" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklist_items' AND column_name='sort_order') THEN
    ALTER TABLE "task_checklist_items" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklist_items' AND column_name='created_at') THEN
    ALTER TABLE "task_checklist_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklists' AND column_name='work_item_id') THEN
    ALTER TABLE "task_checklists" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklists' AND column_name='title') THEN
    ALTER TABLE "task_checklists" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklists' AND column_name='sort_order') THEN
    ALTER TABLE "task_checklists" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_checklists' AND column_name='created_at') THEN
    ALTER TABLE "task_checklists" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_comments' AND column_name='work_item_id') THEN
    ALTER TABLE "task_comments" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_comments' AND column_name='author_id') THEN
    ALTER TABLE "task_comments" ADD COLUMN "author_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_comments' AND column_name='body') THEN
    ALTER TABLE "task_comments" ADD COLUMN "body" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_comments' AND column_name='created_at') THEN
    ALTER TABLE "task_comments" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='work_item_id') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='filename') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "filename" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='original_name') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "original_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='file_size') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "file_size" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='note') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "note" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='sent_by_user_id') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "sent_by_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='recipient_user_id') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "recipient_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='acknowledged') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "acknowledged" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='acknowledged_at') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "acknowledged_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_deliverables' AND column_name='created_at') THEN
    ALTER TABLE "task_deliverables" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_tags' AND column_name='name') THEN
    ALTER TABLE "task_tags" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_tags' AND column_name='color') THEN
    ALTER TABLE "task_tags" ADD COLUMN "color" TEXT DEFAULT '#6366f1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_tags' AND column_name='category') THEN
    ALTER TABLE "task_tags" ADD COLUMN "category" task_tag_category DEFAULT 'CUSTOM';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_tags' AND column_name='created_by') THEN
    ALTER TABLE "task_tags" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_tags' AND column_name='created_at') THEN
    ALTER TABLE "task_tags" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='work_item_id') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='user_id') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='duration_minutes') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "duration_minutes" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='description') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='date') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_time_entries' AND column_name='created_at') THEN
    ALTER TABLE "task_time_entries" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_watchers' AND column_name='work_item_id') THEN
    ALTER TABLE "task_watchers" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_watchers' AND column_name='user_id') THEN
    ALTER TABLE "task_watchers" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_watchers' AND column_name='created_at') THEN
    ALTER TABLE "task_watchers" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='name') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='group_type') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "group_type" TEXT DEFAULT 'department';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='department') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='project_name') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='project_id') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='teams_chat_id') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "teams_chat_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='description') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='created_by') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='created_at') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_groups' AND column_name='updated_at') THEN
    ALTER TABLE "teams_chat_groups" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_members' AND column_name='group_id') THEN
    ALTER TABLE "teams_chat_members" ADD COLUMN "group_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_members' AND column_name='user_id') THEN
    ALTER TABLE "teams_chat_members" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_members' AND column_name='role') THEN
    ALTER TABLE "teams_chat_members" ADD COLUMN "role" TEXT DEFAULT 'member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_members' AND column_name='added_by') THEN
    ALTER TABLE "teams_chat_members" ADD COLUMN "added_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_members' AND column_name='added_at') THEN
    ALTER TABLE "teams_chat_members" ADD COLUMN "added_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='group_id') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "group_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='sender_user_id') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "sender_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='sender_name') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "sender_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='content') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "content" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='teams_message_id') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "teams_message_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='is_from_teams') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "is_from_teams" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='file_name') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='file_path') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "file_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='file_size') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "file_size" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='file_type') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "file_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams_chat_messages' AND column_name='created_at') THEN
    ALTER TABLE "teams_chat_messages" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='name') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='signature_json') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "signature_json" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='is_default') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "is_default" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='created_by') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='created_at') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='template_profiles' AND column_name='updated_at') THEN
    ALTER TABLE "template_profiles" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='tr_item_id') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "tr_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='project_id') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='auto_created_pm_task_id') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "auto_created_pm_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='link_status') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "link_status" tr_link_status DEFAULT 'Linked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='created_at') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='created_by') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='updated_at') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_project_links' AND column_name='updated_by') THEN
    ALTER TABLE "tr_item_project_links" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='tr_item_id') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "tr_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='project_id') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='decision') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "decision" tr_suggestion_decision DEFAULT 'Suggested';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='score') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "score" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='rationale') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "rationale" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='decided_at') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "decided_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_item_suggestion_decisions' AND column_name='decided_by') THEN
    ALTER TABLE "tr_item_suggestion_decisions" ADD COLUMN "decided_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='tr_id') THEN
    ALTER TABLE "tr_items" ADD COLUMN "tr_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='department') THEN
    ALTER TABLE "tr_items" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='action_description') THEN
    ALTER TABLE "tr_items" ADD COLUMN "action_description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='rag_status') THEN
    ALTER TABLE "tr_items" ADD COLUMN "rag_status" tr_rag_status DEFAULT 'Green';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='owners') THEN
    ALTER TABLE "tr_items" ADD COLUMN "owners" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='owner_user_ids') THEN
    ALTER TABLE "tr_items" ADD COLUMN "owner_user_ids" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='support') THEN
    ALTER TABLE "tr_items" ADD COLUMN "support" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='date_raised') THEN
    ALTER TABLE "tr_items" ADD COLUMN "date_raised" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='due_date') THEN
    ALTER TABLE "tr_items" ADD COLUMN "due_date" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='status') THEN
    ALTER TABLE "tr_items" ADD COLUMN "status" tr_status DEFAULT 'Active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='date_completed') THEN
    ALTER TABLE "tr_items" ADD COLUMN "date_completed" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='outcome_comments') THEN
    ALTER TABLE "tr_items" ADD COLUMN "outcome_comments" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='supporting_info') THEN
    ALTER TABLE "tr_items" ADD COLUMN "supporting_info" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='created_at') THEN
    ALTER TABLE "tr_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='created_by') THEN
    ALTER TABLE "tr_items" ADD COLUMN "created_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='updated_at') THEN
    ALTER TABLE "tr_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='updated_by') THEN
    ALTER TABLE "tr_items" ADD COLUMN "updated_by" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='scheduled_date') THEN
    ALTER TABLE "tr_items" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "tr_items" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tr_items' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "tr_items" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='tracker_type') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "tracker_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='month_key') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "month_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='realised') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "realised" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='outstanding') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "outstanding" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='budget') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "budget" NUMERIC(15,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracker_monthly_manual' AND column_name='updated_at') THEN
    ALTER TABLE "tracker_monthly_manual" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triage_rules' AND column_name='owner_user_id') THEN
    ALTER TABLE "triage_rules" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triage_rules' AND column_name='rule_type') THEN
    ALTER TABLE "triage_rules" ADD COLUMN "rule_type" triage_rule_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triage_rules' AND column_name='value') THEN
    ALTER TABLE "triage_rules" ADD COLUMN "value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triage_rules' AND column_name='enabled') THEN
    ALTER TABLE "triage_rules" ADD COLUMN "enabled" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triage_rules' AND column_name='created_at') THEN
    ALTER TABLE "triage_rules" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='file_name') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "file_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='file_path') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "file_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='uploaded_by') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "uploaded_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='uploaded_at') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "uploaded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='records_processed') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "records_processed" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='validation_errors') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "validation_errors" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upload_metadata' AND column_name='status') THEN
    ALTER TABLE "upload_metadata" ADD COLUMN "status" TEXT DEFAULT 'success';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_badges' AND column_name='user_id') THEN
    ALTER TABLE "user_badges" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_badges' AND column_name='badge_key') THEN
    ALTER TABLE "user_badges" ADD COLUMN "badge_key" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_badges' AND column_name='awarded_at') THEN
    ALTER TABLE "user_badges" ADD COLUMN "awarded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_badges' AND column_name='meta') THEN
    ALTER TABLE "user_badges" ADD COLUMN "meta" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='user_id') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='entity') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "entity" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='action') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "action" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='allowed') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "allowed" BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='scope') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "scope" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='granted_by') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "granted_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='reason') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='expires_at') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "expires_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permission_overrides' AND column_name='created_at') THEN
    ALTER TABLE "user_permission_overrides" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_points' AND column_name='user_id') THEN
    ALTER TABLE "user_points" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_points' AND column_name='points') THEN
    ALTER TABLE "user_points" ADD COLUMN "points" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_points' AND column_name='category') THEN
    ALTER TABLE "user_points" ADD COLUMN "category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_points' AND column_name='description') THEN
    ALTER TABLE "user_points" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_points' AND column_name='awarded_at') THEN
    ALTER TABLE "user_points" ADD COLUMN "awarded_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='user_id') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='project_name') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='project_id') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='folder_name') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "folder_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='folder_path') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "folder_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_project_folders' AND column_name='updated_at') THEN
    ALTER TABLE "user_project_folders" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN
    ALTER TABLE "users" ADD COLUMN "username" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN
    ALTER TABLE "users" ADD COLUMN "email" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password') THEN
    ALTER TABLE "users" ADD COLUMN "password" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='name') THEN
    ALTER TABLE "users" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    ALTER TABLE "users" ADD COLUMN "role" TEXT DEFAULT 'member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='department') THEN
    ALTER TABLE "users" ADD COLUMN "department" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='microsoft_id') THEN
    ALTER TABLE "users" ADD COLUMN "microsoft_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') THEN
    ALTER TABLE "users" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='project_name') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='project_id') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='week_starting') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "week_starting" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='reviewed_by') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "reviewed_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='status') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "status" TEXT DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_schedule') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_schedule" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_budget') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_budget" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_risks') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_risks" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_quality') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_quality" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_actions') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_actions" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='step_summary') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "step_summary" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='snapshot_metrics') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "snapshot_metrics" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='created_at') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='weekly_reviews' AND column_name='completed_at') THEN
    ALTER TABLE "weekly_reviews" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_assignments' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_assignments" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_assignments' AND column_name='user_id') THEN
    ALTER TABLE "work_item_assignments" ADD COLUMN "user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_assignments' AND column_name='role') THEN
    ALTER TABLE "work_item_assignments" ADD COLUMN "role" work_item_assignment_role DEFAULT 'ASSIGNEE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_assignments' AND column_name='allocation_pct') THEN
    ALTER TABLE "work_item_assignments" ADD COLUMN "allocation_pct" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_assignments' AND column_name='created_at') THEN
    ALTER TABLE "work_item_assignments" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_dependencies' AND column_name='predecessor_id') THEN
    ALTER TABLE "work_item_dependencies" ADD COLUMN "predecessor_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_dependencies' AND column_name='successor_id') THEN
    ALTER TABLE "work_item_dependencies" ADD COLUMN "successor_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_dependencies' AND column_name='dep_type') THEN
    ALTER TABLE "work_item_dependencies" ADD COLUMN "dep_type" work_item_dep_type DEFAULT 'FS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_dependencies' AND column_name='lag_days') THEN
    ALTER TABLE "work_item_dependencies" ADD COLUMN "lag_days" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='wbs_code') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "wbs_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='outline_number') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "outline_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='legacy_table') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "legacy_table" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='legacy_id') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "legacy_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='source_row') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='source_sheet') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "source_sheet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_engineering' AND column_name='import_run_id') THEN
    ALTER TABLE "work_item_engineering" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='duration') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='percent_complete') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "percent_complete" REAL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='expected_pct_complete') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "expected_pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='phase') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='is_milestone') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "is_milestone" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='indent_level') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "indent_level" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='owner_name') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "owner_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='is_shared') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "is_shared" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='hold_reason') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "hold_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='blocked_type') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "blocked_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='blocker_reason') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "blocker_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='approval_required') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "approval_required" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='tracking_rag') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "tracking_rag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='task_type_tag') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "task_type_tag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='sub_project_name') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='completed_at') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='linked_plan_item_id') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "linked_plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='linked_deliverable_id') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "linked_deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_pm' AND column_name='linked_quality_item_instance_id') THEN
    ALTER TABLE "work_item_pm" ADD COLUMN "linked_quality_item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='scheduled_date') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='estimate_minutes') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "estimate_minutes" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='task_category') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "task_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='baseline_start') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "baseline_start" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='baseline_end') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "baseline_end" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='baseline_duration') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "baseline_duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='task_mode') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "task_mode" TEXT DEFAULT 'auto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='actual_start') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "actual_start" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='actual_end') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "actual_end" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='actual_duration') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "actual_duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='is_recurring') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "is_recurring" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='recurrence_frequency') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "recurrence_frequency" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='recurrence_interval') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "recurrence_interval" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='recurrence_days_of_week') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "recurrence_days_of_week" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='recurrence_end_date') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "recurrence_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_scheduling' AND column_name='recurrence_parent_id') THEN
    ALTER TABLE "work_item_scheduling" ADD COLUMN "recurrence_parent_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='old_status') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "old_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='new_status') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "new_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='changed_by') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "changed_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='changed_at') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "changed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_status_history' AND column_name='reason') THEN
    ALTER TABLE "work_item_status_history" ADD COLUMN "reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_tags' AND column_name='work_item_id') THEN
    ALTER TABLE "work_item_tags" ADD COLUMN "work_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_tags' AND column_name='tag_id') THEN
    ALTER TABLE "work_item_tags" ADD COLUMN "tag_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_item_tags' AND column_name='created_at') THEN
    ALTER TABLE "work_item_tags" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='client_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "client_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='project_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='workstream') THEN
    ALTER TABLE "work_items" ADD COLUMN "workstream" work_item_workstream;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='type') THEN
    ALTER TABLE "work_items" ADD COLUMN "type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='source') THEN
    ALTER TABLE "work_items" ADD COLUMN "source" work_item_source DEFAULT 'UI';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='title') THEN
    ALTER TABLE "work_items" ADD COLUMN "title" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='description') THEN
    ALTER TABLE "work_items" ADD COLUMN "description" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='status') THEN
    ALTER TABLE "work_items" ADD COLUMN "status" TEXT DEFAULT 'Not Started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='priority') THEN
    ALTER TABLE "work_items" ADD COLUMN "priority" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='start_date') THEN
    ALTER TABLE "work_items" ADD COLUMN "start_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='end_date') THEN
    ALTER TABLE "work_items" ADD COLUMN "end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='duration') THEN
    ALTER TABLE "work_items" ADD COLUMN "duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='percent_complete') THEN
    ALTER TABLE "work_items" ADD COLUMN "percent_complete" REAL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='expected_pct_complete') THEN
    ALTER TABLE "work_items" ADD COLUMN "expected_pct_complete" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='wbs_code') THEN
    ALTER TABLE "work_items" ADD COLUMN "wbs_code" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='outline_number') THEN
    ALTER TABLE "work_items" ADD COLUMN "outline_number" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='indent_level') THEN
    ALTER TABLE "work_items" ADD COLUMN "indent_level" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='parent_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "parent_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='is_milestone') THEN
    ALTER TABLE "work_items" ADD COLUMN "is_milestone" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='phase') THEN
    ALTER TABLE "work_items" ADD COLUMN "phase" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='owner_user_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "owner_user_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='owner_name') THEN
    ALTER TABLE "work_items" ADD COLUMN "owner_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='is_shared') THEN
    ALTER TABLE "work_items" ADD COLUMN "is_shared" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='external_ref') THEN
    ALTER TABLE "work_items" ADD COLUMN "external_ref" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='legacy_table') THEN
    ALTER TABLE "work_items" ADD COLUMN "legacy_table" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='legacy_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "legacy_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='source_row') THEN
    ALTER TABLE "work_items" ADD COLUMN "source_row" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='source_sheet') THEN
    ALTER TABLE "work_items" ADD COLUMN "source_sheet" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='import_run_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "import_run_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='created_by') THEN
    ALTER TABLE "work_items" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='created_at') THEN
    ALTER TABLE "work_items" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='updated_at') THEN
    ALTER TABLE "work_items" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='deleted_at') THEN
    ALTER TABLE "work_items" ADD COLUMN "deleted_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='scheduled_date') THEN
    ALTER TABLE "work_items" ADD COLUMN "scheduled_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='scheduled_start_time') THEN
    ALTER TABLE "work_items" ADD COLUMN "scheduled_start_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='scheduled_end_time') THEN
    ALTER TABLE "work_items" ADD COLUMN "scheduled_end_time" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='baseline_start') THEN
    ALTER TABLE "work_items" ADD COLUMN "baseline_start" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='baseline_end') THEN
    ALTER TABLE "work_items" ADD COLUMN "baseline_end" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='baseline_duration') THEN
    ALTER TABLE "work_items" ADD COLUMN "baseline_duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='task_mode') THEN
    ALTER TABLE "work_items" ADD COLUMN "task_mode" TEXT DEFAULT 'auto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='actual_start') THEN
    ALTER TABLE "work_items" ADD COLUMN "actual_start" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='actual_end') THEN
    ALTER TABLE "work_items" ADD COLUMN "actual_end" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='actual_duration') THEN
    ALTER TABLE "work_items" ADD COLUMN "actual_duration" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='sort_order') THEN
    ALTER TABLE "work_items" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='estimate_minutes') THEN
    ALTER TABLE "work_items" ADD COLUMN "estimate_minutes" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='task_category') THEN
    ALTER TABLE "work_items" ADD COLUMN "task_category" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='is_recurring') THEN
    ALTER TABLE "work_items" ADD COLUMN "is_recurring" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='recurrence_frequency') THEN
    ALTER TABLE "work_items" ADD COLUMN "recurrence_frequency" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='recurrence_interval') THEN
    ALTER TABLE "work_items" ADD COLUMN "recurrence_interval" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='recurrence_days_of_week') THEN
    ALTER TABLE "work_items" ADD COLUMN "recurrence_days_of_week" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='recurrence_end_date') THEN
    ALTER TABLE "work_items" ADD COLUMN "recurrence_end_date" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='recurrence_parent_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "recurrence_parent_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='sub_project_name') THEN
    ALTER TABLE "work_items" ADD COLUMN "sub_project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='hold_reason') THEN
    ALTER TABLE "work_items" ADD COLUMN "hold_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='blocked_type') THEN
    ALTER TABLE "work_items" ADD COLUMN "blocked_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='approval_required') THEN
    ALTER TABLE "work_items" ADD COLUMN "approval_required" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='linked_plan_item_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "linked_plan_item_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='linked_deliverable_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "linked_deliverable_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='linked_quality_item_instance_id') THEN
    ALTER TABLE "work_items" ADD COLUMN "linked_quality_item_instance_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='completed_at') THEN
    ALTER TABLE "work_items" ADD COLUMN "completed_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='tracking_rag') THEN
    ALTER TABLE "work_items" ADD COLUMN "tracking_rag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='task_type_tag') THEN
    ALTER TABLE "work_items" ADD COLUMN "task_type_tag" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='blocker_reason') THEN
    ALTER TABLE "work_items" ADD COLUMN "blocker_reason" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='scenario_id') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "scenario_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='imported_dependency_id') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "imported_dependency_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='predecessor_task_id') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "predecessor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='successor_task_id') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "successor_task_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='dependency_type') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "dependency_type" TEXT DEFAULT 'FS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='lag_days') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "lag_days" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='deleted_flag') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "deleted_flag" INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='created_at') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_dependency_override' AND column_name='updated_at') THEN
    ALTER TABLE "working_plan_dependency_override" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='project_name') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='project_id') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='name') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "name" TEXT DEFAULT 'Working Plan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='is_active') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "is_active" INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='created_at') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='working_plan_scenario' AND column_name='updated_at') THEN
    ALTER TABLE "working_plan_scenario" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='mapping_id') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "mapping_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='workbook_path') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "workbook_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='sheet_name') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "sheet_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='cell_address') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "cell_address" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='previous_value') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "previous_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='new_value') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "new_value" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='status') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "status" TEXT DEFAULT 'applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='project_id') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "project_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='actor_id') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "actor_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='error_message') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "error_message" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='applied_at') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "applied_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_audit_log' AND column_name='rolled_back_at') THEN
    ALTER TABLE "writeback_audit_log" ADD COLUMN "rolled_back_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='name') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='project_name') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "project_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='project_id') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "project_id" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='workbook_path') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "workbook_path" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='sheet_name') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "sheet_name" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='cell_address') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "cell_address" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='source_field') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "source_field" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='entity_type') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "entity_type" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='data_transform') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "data_transform" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='validation_rule') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "validation_rule" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='allowed_roles') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "allowed_roles" TEXT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='created_by') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "created_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='created_at') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "created_at" TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='writeback_mappings' AND column_name='updated_at') THEN
    ALTER TABLE "writeback_mappings" ADD COLUMN "updated_at" TIMESTAMP;
  END IF;
  -- GAP 4b: Add hours tracking columns to work_items
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='planned_hours') THEN
    ALTER TABLE "work_items" ADD COLUMN "planned_hours" REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_items' AND column_name='actual_hours') THEN
    ALTER TABLE "work_items" ADD COLUMN "actual_hours" REAL DEFAULT 0;
  END IF;
  -- Monthly Report Snapshots columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='report_type') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "report_type" VARCHAR(20) NOT NULL DEFAULT 'pm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='report_month') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "report_month" VARCHAR(7) NOT NULL DEFAULT '2026-01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='status') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='data') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "data" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='generated_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "generated_at" TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='regenerated_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "regenerated_at" TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='reviewed_by') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "reviewed_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='reviewed_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "reviewed_at" TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='published_by') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "published_by" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='published_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "published_at" TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='created_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "created_at" TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monthly_report_snapshots' AND column_name='updated_at') THEN
    ALTER TABLE "monthly_report_snapshots" ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Unique constraint for monthly_report_snapshots
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_report_snapshots_type_month_unique') THEN
    ALTER TABLE "monthly_report_snapshots" ADD CONSTRAINT "monthly_report_snapshots_type_month_unique" UNIQUE (report_type, report_month);
  END IF;
END $$;