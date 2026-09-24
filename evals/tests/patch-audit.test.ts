import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countPatchesOutsideScope,
  patchChangedOutsideScope,
} from '../patch-audit';

const before =
  '第一段第一句。第一段第二句。\n\n' +
  '第二段第一句。第二段第二句。第二段第三句。\n\n' +
  '第三段第一句。';

test('patch audit accepts a replacement confined to the declared sentence scope', () => {
  const after =
    '第一段第一句。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  assert.equal(
    patchChangedOutsideScope({
      before,
      after,
      scope: { paragraph: 2, sentences: [2, 2] },
    }),
    false
  );
});

test('patch audit detects changes outside the declared scope', () => {
  const after =
    '第一段被偷偷修改。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句已修正。第二段第三句。\n\n' +
    '第三段第一句。';

  assert.equal(
    patchChangedOutsideScope({
      before,
      after,
      scope: { paragraph: 2, sentences: [2, 2] },
    }),
    true
  );
});

test('patch audit counts invalid or out-of-scope applications instead of assuming locality', () => {
  assert.equal(
    countPatchesOutsideScope([
      {
        before,
        after: before,
        scope: { paragraph: 99, sentences: [1, 1] },
      },
      {
        before,
        after: before.replace('第三段第一句。', '第三段被改。'),
        scope: { paragraph: 2, sentences: [2, 2] },
      },
    ]),
    2
  );
});
