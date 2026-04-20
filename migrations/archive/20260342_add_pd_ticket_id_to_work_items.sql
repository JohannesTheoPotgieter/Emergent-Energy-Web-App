-- Add pdTicketId column to work_items for PD ticket → task linkage
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS pd_ticket_id INTEGER REFERENCES pd_tickets(id);

-- Index for efficient lookup of work items by PD ticket
CREATE INDEX IF NOT EXISTS idx_work_items_pd_ticket_id ON work_items(pd_ticket_id) WHERE pd_ticket_id IS NOT NULL;
