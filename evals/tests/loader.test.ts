import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadEvalCases } from '../loader';

test('Spec 0.6 golden corpus loads with unique ids and a metamorphic pair', async () => {
  const cases = await loadEvalCases();

  assert.ok(cases.length >= 7);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);

  const metamorphic = cases.filter(
    (item) => item.metamorphic_group === 'META_AFFECTION_NOT_ACTION'
  );
  assert.equal(metamorphic.length, 2);
  assert.notEqual(metamorphic[0]?.synthetic_canon, metamorphic[1]?.synthetic_canon);
});

test('loader rejects malformed nested eval fields instead of trusting YAML casts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'linyuan-eval-'));
  const casePath = path.join(dir, 'invalid.yaml');

  try {
    await writeFile(
      casePath,
      [
        'version: "0.6"',
        'id: "invalid.nested-field"',
        'category: "personality"',
        'description: "fixture"',
        'request: "write"',
        'scene_state: {}',
        'required_sources: []',
        'requirements: []',
        'forbidden_inferences: []',
        'forbidden_overconstraints: []',
        'expected_need_context: []',
        'behavioral_diversity:',
        '  sample_count: "6"',
        '  minimum_unique_signatures: 3',
        'validator:',
        '  gold_violations: []',
        '  gold_non_violations: []',
        'metamorphic_group: null',
        'synthetic_canon: null',
        '',
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(
      () => loadEvalCases([dir]),
      /behavioral_diversity\.sample_count must be a non-negative integer/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
