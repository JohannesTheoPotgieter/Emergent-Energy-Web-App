-- Monthly Report Snapshots table for persisting generated report data
CREATE TABLE IF NOT EXISTS monthly_report_snapshots (
    id SERIAL PRIMARY KEY,
    report_type VARCHAR(20) NOT NULL,                    -- 'pm' or 'engineering'
    report_month VARCHAR(7) NOT NULL,                    -- 'YYYY-MM'
    status VARCHAR(20) NOT NULL DEFAULT 'draft',         -- 'draft', 'reviewed', 'published'
    data JSONB NOT NULL,                                 -- full report payload (frozen at generation time)
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    regenerated_at TIMESTAMPTZ,                          -- last regeneration timestamp (drafts only)
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    published_by INTEGER REFERENCES users(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(report_type, report_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_report_snapshots_type_month ON monthly_report_snapshots(report_type, report_month);
CREATE INDEX IF NOT EXISTS idx_monthly_report_snapshots_status ON monthly_report_snapshots(status);
