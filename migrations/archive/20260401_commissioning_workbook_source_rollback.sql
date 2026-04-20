-- Rollback: Remove commissioning workbook source tables
-- Safe to run inside a transaction. No data loss to other tables.
-- WARNING: This drops all commissioning source configs and parsed snapshots.

DROP INDEX IF EXISTS idx_commissioning_snapshots_project;
DROP INDEX IF EXISTS idx_commissioning_sources_project;
DROP TABLE IF EXISTS commissioning_snapshots;
DROP TABLE IF EXISTS commissioning_sources;
