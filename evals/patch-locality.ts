import type { PatchModelOutput, PatcherPayload } from '../runtime/patcher';

interface PatchCall {
  payload: PatcherPayload;
  output: PatchModelOutput;
}

interface Range {
  start: number;
  end: number;
}

function paragraphRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const separator = /\n[ \t]*\n/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    if (match.index > start) {
      ranges.push({ start, end: match.index });
    }
    start = separator.lastIndex;
  }

  if (start < text.length) {
    ranges.push({ start, end: text.length });
  }

  return ranges.filter(
    ({ start: from, end }) => text.slice(from, end).trim().length > 0
  );
}

function sentenceRanges(text: string, baseOffset: number): Range[] {
  const ranges: Range[] = [];
  const terminal = new Set(['。', '！', '？', '!', '?']);
  const closers = new Set(['”', '’', '"', "'", '』', '」', '】', ')', '）']);
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined || !terminal.has(char)) continue;

    let end = index + 1;
    while (end < text.length) {
      const closer = text[end];
      if (closer === undefined || !closers.has(closer)) break;
      end += 1;
    }

    ranges.push({
      start: baseOffset + start,
      end: baseOffset + end,
    });
    start = end;
    index = end - 1;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    ranges.push({
      start: baseOffset + start,
      end: baseOffset + text.length,
    });
  }

  return ranges;
}

function scopeRange(payload: PatcherPayload): Range | null {
  const scope = payload.violation.patch_contract.allowed_scope;
  const paragraphs = paragraphRanges(payload.draft);
  const paragraph = paragraphs[scope.paragraph - 1];
  if (!paragraph) return null;

  const sentences = sentenceRanges(
    payload.draft.slice(paragraph.start, paragraph.end),
    paragraph.start
  );
  const first = sentences[scope.sentences[0] - 1];
  const last = sentences[scope.sentences[1] - 1];
  if (!first || !last) return null;

  return { start: first.start, end: last.end };
}

export function countPatchChangesOutsideScope(
  calls: PatchCall[],
  finalOutput: string | null
): number {
  let outsideChanges = 0;

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (!call) continue;

    const range = scopeRange(call.payload);
    const nextDraft = calls[index + 1]?.payload.draft ?? finalOutput;

    if (!range || nextDraft === null) {
      outsideChanges += 1;
      continue;
    }

    const expectedPrefix = call.payload.draft.slice(0, range.start);
    const expectedSuffix = call.payload.draft.slice(range.end);
    const expected =
      expectedPrefix + call.output.replacement + expectedSuffix;

    if (nextDraft !== expected) {
      outsideChanges += 1;
    }
  }

  return outsideChanges;
}
