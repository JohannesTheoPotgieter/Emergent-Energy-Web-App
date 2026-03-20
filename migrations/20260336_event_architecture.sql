-- ============================================================
-- Prompt 13: Event Architecture Schema
--
-- Creates domain_events, event_subscriptions, and
-- event_processing_log tables for event-driven updates.
-- ============================================================

-- Step 1: Enums
DO $$ BEGIN
  CREATE TYPE domain_event_status AS ENUM ('pending', 'processed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE event_processing_status AS ENUM ('success', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Domain events table
CREATE TABLE IF NOT EXISTS domain_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id INTEGER NOT NULL,
  project_id INTEGER REFERENCES project_info(id),
  triggered_by INTEGER REFERENCES users(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_events_event_type ON domain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_project_id ON domain_events(project_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_created_at ON domain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_unprocessed ON domain_events(processed_at) WHERE processed_at IS NULL;

-- Step 3: Event subscriptions table
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_subscriptions_event_type ON event_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_active ON event_subscriptions(is_active) WHERE is_active = true;

-- Step 4: Event processing log table
CREATE TABLE IF NOT EXISTS event_processing_log (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES domain_events(id),
  handler_name TEXT NOT NULL,
  status event_processing_status NOT NULL,
  error_message TEXT,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_event_processing_log_event_id ON event_processing_log(event_id);
CREATE INDEX IF NOT EXISTS idx_event_processing_log_status ON event_processing_log(status);
