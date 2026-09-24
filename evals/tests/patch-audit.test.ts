import test from 'node:test';
import assert from 'node:assert/strict';

import { countPatchChangesOutsideScope } from '../patch-locality';

const before =
  '第一段第一句。第一段第二句。\n\n' +
  '第二段第一句。第二段第二句。第二段第三句。\n\n' +
  '第三段第一句。';

function patchCall(replacement: string) {
  return {
    payload: {
      draft: before,
      violation: {
        id: 'V1',
        severity: 'hard' as const,
        location: {
          paragraph: 2,
          sentence_start: 2,
          sentence_end: 2,
        },
        actual: { semantic_claim: 'fixture' },
        required_state: {},
        patch_contract: {
          allowed_scope: {
            paragraph: 2,
            sentences: [2, 2] as [number, number],
          },
          preserve: [],
          required_change: ['fix'],
        },
      },
    },
    output: { replacement },
  };
}

test('patch-locality audit accepts the observed local replacement transition', () => {
  const finalOutput =
    '第一段第一句。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  assert.equal(
    countPatchChangesOutsideScope(
      [patchCall('第二段第二句已修正。')],
      finalOutput
    ),
    0
  );
});

test('patch-locality audit detects an observed transition outside scope', () => {
  const tamperedOutput =
    '第一段被偷偷修改。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  assert.equal(
    countPatchChangesOutsideScope(
      [patchCall('第二段第二句已修正。')],
      tamperedOutput
    ),
    1
  );
});

test('patch-locality audit checks every transition in a multi-patch chain', () => {
  const first = patchCall('第二段第二句已修正。');
  const afterFirst =
    '第一段第一句。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  const second = {
    ...patchCall('第一段第一句已修正。'),
    payload: {
      ...patchCall('第一段第一句已修正。').payload,
      draft: afterFirst,
      violation: {
        ...patchCall('第一段第一句已修正。').payload.violation,
        location: {
          paragraph: 1,
          sentence_start: 1,
          sentence_end: 1,
        },
        patch_contract: {
          ...patchCall('第一段第一句已修正。').payload.violation.patch_contract,
          allowed_scope: {
            paragraph: 1,
            sentences: [1, 1] as [number, number],
          },
        },
      },
    },
  };

  const finalOutput =
    '第一段第一句已修正。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  assert.equal(
    countPatchChangesOutsideScope([first, second], finalOutput),
    0
  );
});
