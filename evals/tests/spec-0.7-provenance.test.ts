import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertBaselineProvenance,
  type BaselineProvenanceSnapshot,
} from '../baseline-provenance';
import type { RealEvalManifest } from '../run-manifest';

const current: BaselineProvenanceSnapshot = {
  case_set_hash: 'cases-current',
  prompt_template_hashes: {
    compiler: 'prompt-compiler',
    generator: 'prompt-generator',
  },
  source_hashes: {
    'CANON.A': 'source-a',
    'CANON.B': 'source-b',
  },
};

function manifest(): RealEvalManifest {
  return {
    version: '0.7',
    created_at: '2026-09-18T00:00:00.000Z',
    commit_sha: 'abc123',
    case_set_hash: current.case_set_hash,
    report_hash: 'report',
    stage_models: {},
    prompt_template_hashes: { ...current.prompt_template_hashes },
    source_hashes: { ...current.source_hashes },
    calls: [],
  };
}

test('baseline provenance accepts matching repository state', () => {
  assert.doesNotThrow(() =>
    assertBaselineProvenance(manifest(), current, 'abc123')
  );
});

test('baseline provenance rejects a different case set', () => {
  const changed = manifest();
  changed.case_set_hash = 'old-cases';

  assert.throws(
    () => assertBaselineProvenance(changed, current),
    /case_set_hash/
  );
});

test('baseline provenance rejects changed prompt templates', () => {
  const changed = manifest();
  changed.prompt_template_hashes.compiler = 'old-prompt';

  assert.throws(
    () => assertBaselineProvenance(changed, current),
    /prompt_template_hashes/
  );
});

test('baseline provenance rejects changed Canon source content', () => {
  const changed = manifest();
  changed.source_hashes['CANON.B'] = 'old-source';

  assert.throws(
    () => assertBaselineProvenance(changed, current),
    /source_hashes/
  );
});

test('baseline provenance requires a known experiment commit', () => {
  const changed = manifest();
  changed.commit_sha = 'UNKNOWN';

  assert.throws(
    () => assertBaselineProvenance(changed, current),
    /commit_sha is UNKNOWN/
  );
});

test('baseline provenance can pin an exact experiment commit', () => {
  assert.throws(
    () => assertBaselineProvenance(manifest(), current, 'def456'),
    /does not match expected commit/
  );
});
