/**
 * PR-C redesign — /api/my-queue endpoint contract.
 *
 * The endpoint backs both /my-queue (new dedicated page) and the
 * "What needs me" section on /now. Pin the public response shape +
 * the four loader rules so a refactor can't silently drop a bucket.
 *
 * Source-text assertions only — full integration tests would require
 * seeding POs / payment requests / CRs / stage exceptions which is
 * out of scope for a per-route shape gate.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../../server/routes/my-queue.routes.ts'),
  'utf8',
);

describe('/api/my-queue — endpoint contract', () => {
  it('exposes a single GET /api/my-queue', () => {
    expect(SOURCE).toMatch(/app\.get\(\s*["']\/api\/my-queue["']/);
  });

  it('returns the four canonical buckets', () => {
    // The MyQueueResponse type lists exactly these keys; if a future
    // refactor adds or removes a bucket, the page UI must follow.
    for (const bucket of ['pos', 'paymentRequests', 'changeRequests', 'stageExceptions']) {
      expect(SOURCE).toContain(`${bucket}: QueueBucket`);
    }
  });

  it('each bucket carries count + items + error (truth principle)', () => {
    expect(SOURCE).toMatch(/count:\s*number/);
    expect(SOURCE).toMatch(/items:\s*QueueItem\[\]/);
    // The `error` field is the load-fail signal — UI uses it to
    // render "couldn't load" rather than mistaking failure for empty.
    expect(SOURCE).toMatch(/error:\s*string\s*\|\s*null/);
  });
});

describe('/api/my-queue — per-loader rules', () => {
  it('PO loader filters to assigned reviewer + pending decision + non-delegated', () => {
    expect(SOURCE).toContain('pra.reviewer_user_id = ');
    expect(SOURCE).toContain("pra.decision = 'pending'");
    expect(SOURCE).toContain('pra.delegated_to_user_id IS NULL');
    // And the PO itself must be in an active state.
    expect(SOURCE).toContain("po.status IN ('submitted', 'in_review')");
  });

  it('CR loader includes both submitted (any reviewer) and under_review by me', () => {
    // status = 'submitted' OR (status = 'under_review' AND reviewer = me)
    expect(SOURCE).toMatch(/cr\.status\s*=\s*'submitted'/);
    expect(SOURCE).toMatch(/cr\.status\s*=\s*'under_review'/);
    expect(SOURCE).toContain('cr.reviewer_user_id = ');
  });

  it('stage-exception loader filters to REQUESTED + approver = me', () => {
    expect(SOURCE).toContain("pse.status = 'REQUESTED'");
    expect(SOURCE).toContain('pse.approver_user_id = ');
  });

  it('payment-request loader currently returns all in_review (no per-user assignment yet)', () => {
    // Note the limit-50 guard so the queue doesn't unbounded if many
    // PRs sit in review.
    expect(SOURCE).toContain("pr.status = 'in_review'");
    expect(SOURCE).toMatch(/LIMIT\s+50/);
  });

  it('each loader uses parameterised sql`...` templates (no sql.raw interpolation)', () => {
    // PR-A § 5 rule: parameterised queries only.
    // Strip header comments so the regex isn't tripped by docs.
    const codeOnly = SOURCE.replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/sql\.raw\s*\(/);
  });

  it('loaders run concurrently via Promise.all', () => {
    expect(SOURCE).toMatch(/Promise\.all\(/);
  });
});

describe('/api/my-queue — error isolation', () => {
  it('every loader wraps its body in try/catch (one failure must not blank the page)', () => {
    // Count of try blocks should be >= 4 (one per loader).
    const tryMatches = SOURCE.match(/try\s*\{/g) || [];
    expect(tryMatches.length).toBeGreaterThanOrEqual(4);
  });

  it('catch handlers surface a message string on the QueueBucket', () => {
    expect(SOURCE).toMatch(/error:\s*err instanceof Error\s*\?\s*err\.message/);
  });
});
