INSERT INTO fiscal_years (name, start_date, end_date, is_current)
VALUES
  ('FY26', DATE '2025-09-01', DATE '2026-08-31', true),
  ('FY27', DATE '2026-09-01', DATE '2027-08-31', false)
ON CONFLICT (name) DO UPDATE
SET start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    is_current = EXCLUDED.is_current,
    updated_at = NOW();

WITH fy AS (
  SELECT id, name, start_date FROM fiscal_years WHERE name IN ('FY26', 'FY27')
)
INSERT INTO fiscal_periods (fiscal_year_id, period_name, start_date, end_date, sort_order)
SELECT fy.id,
       to_char((fy.start_date + ((n - 1) || ' month')::interval), 'Mon YYYY') AS period_name,
       (fy.start_date + ((n - 1) || ' month')::interval)::date AS start_date,
       (fy.start_date + (n || ' month')::interval - interval '1 day')::date AS end_date,
       n AS sort_order
FROM fy
CROSS JOIN generate_series(1, 12) AS n
ON CONFLICT DO NOTHING;
