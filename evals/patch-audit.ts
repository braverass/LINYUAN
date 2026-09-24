import type { PatchApplication } from '../runtime/orchestrator';
import type { PatchScope } from '../runtime/types';

interface Range {
  start: number;
  end: number;
}

function paragraphRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  const separator = /\n[ \t]*\n/g;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    if (match.index > start && text.slice(start, match.index).trim().length > 0) {
      ranges.push({ start, end: match.index });
    }
    start = separator.lastIndex;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    ranges.push({ start, end: text.length });
  }
  return ranges;
}

function sentenceRanges(text: string, base: number): Range[] {
  const ranges: Range[] = [];
  const terminal = /[。！？!?]/;
  const closers = new Set(['”', '’', '"', "'", '』', '」', '】', ')', '）']);
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!char || !terminal.test(char)) continue;

    let end = index + 1;
    while (end < text.length && closers.has(text[end] as string)) {
      end += 1;
    }
    ranges.push({ start: base + start, end: base + end });
    start = end;
    index = end - 1;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    ranges.push({ start: base + start, end: base + text.length });
  }
  return ranges;
}

function locateScope(text: string, scope: PatchScope): Range | null {
  if (
    !Number.isSafeInteger(scope.paragraph) ||
    scope.paragraph < 1 ||
    !Array.isArray(scope.sentences) ||
    scope.sentences.length !== 2
  ) {
    return null;
  }

  const [firstIndex, lastIndex] = scope.sentences;
  if (
    !Number.isSafeInteger(firstIndex) ||
    !Number.isSafeInteger(lastIndex) ||
    firstIndex < 1 ||
    lastIndex < firstIndex
  ) {
    return null;
  }

  const paragraph = paragraphRanges(text)[scope.paragraph - 1];
  if (!paragraph) return null;
  const sentences = sentenceRanges(
    text.slice(paragraph.start, paragraph.end),
    paragraph.start
  );
  const first = sentences[firstIndex - 1];
  const last = sentences[lastIndex - 1];
  if (!first || !last) return null;
  return { start: first.start, end: last.end };
}

export function patchChangedOutsideScope(
  application: PatchApplication
): boolean {
  const range = locateScope(application.before, application.scope);
  if (!range) return true;

  const expectedPrefix = application.before.slice(0, range.start);
  const expectedSuffix = application.before.slice(range.end);
  return (
    !application.after.startsWith(expectedPrefix) ||
    !application.after.endsWith(expectedSuffix)
  );
}

export function countPatchesOutsideScope(
  applications: PatchApplication[]
): number {
  return applications.filter(patchChangedOutsideScope).length;
}
