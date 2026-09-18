import {
  PatchContract,
  PatchScope,
  Violation,
} from './types';

export interface PatcherPayload {
  draft: string;
  violation: Omit<Violation, 'evidence_refs'>;
}

export interface PatchModelOutput {
  replacement: string;
}

export type PatchAdapter = (
  payload: PatcherPayload
) => Promise<PatchModelOutput>;

const FORBIDDEN_PATCH_KEYS = new Set([
  'rawCanon',
  'raw_canon',
  'provenance',
  'evidence_refs',
  'evidenceRefs',
  'source_id',
  'sourceId',
  'source_path',
  'sourcePath',
]);

export function assertNoEvidenceLeak(value: unknown, path = 'patcher_payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoEvidenceLeak(item, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      throw new Error(`PATCHER EVIDENCE LEAK at ${path}.${key}`);
    }
    assertNoEvidenceLeak(child, `${path}.${key}`);
  }
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

  return ranges.filter(({ start, end }) => text.slice(start, end).trim().length > 0);
}

function sentenceRanges(text: string, baseOffset: number): Range[] {
  const ranges: Range[] = [];
  const terminal = new Set(['。', '！', '？', '!', '?']);
  const closers = new Set(['”', '’', '"', "'", '』', '」', '】', ')', '）']);
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === undefined || !terminal.has(char)) {
      continue;
    }

    let end = i + 1;
    while (end < text.length) {
      const closer = text[end];
      if (closer === undefined || !closers.has(closer)) {
        break;
      }
      end += 1;
    }

    ranges.push({
      start: baseOffset + start,
      end: baseOffset + end,
    });
    start = end;
    i = end - 1;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    ranges.push({
      start: baseOffset + start,
      end: baseOffset + text.length,
    });
  }

  return ranges;
}

export function locatePatchScope(draft: string, scope: PatchScope): Range {
  if (!Number.isInteger(scope.paragraph) || scope.paragraph < 1) {
    throw new Error('Patch paragraph must be a 1-based positive integer');
  }

  const [sentenceStart, sentenceEnd] = scope.sentences;
  if (
    !Number.isInteger(sentenceStart) ||
    !Number.isInteger(sentenceEnd) ||
    sentenceStart < 1 ||
    sentenceEnd < sentenceStart
  ) {
    throw new Error('Patch sentence range is invalid');
  }

  const paragraphs = paragraphRanges(draft);
  const paragraph = paragraphs[scope.paragraph - 1];
  if (!paragraph) {
    throw new Error(`Patch paragraph ${scope.paragraph} does not exist`);
  }

  const paragraphText = draft.slice(paragraph.start, paragraph.end);
  const sentences = sentenceRanges(paragraphText, paragraph.start);
  const first = sentences[sentenceStart - 1];
  const last = sentences[sentenceEnd - 1];

  if (!first || !last) {
    throw new Error(
      `Patch sentences ${sentenceStart}-${sentenceEnd} do not exist in paragraph ${scope.paragraph}`
    );
  }

  return { start: first.start, end: last.end };
}

export function applyLocalReplacement(
  draft: string,
  contract: PatchContract,
  replacement: string
): string {
  const range = locatePatchScope(draft, contract.allowed_scope);
  const before = draft.slice(0, range.start);
  const after = draft.slice(range.end);
  const patched = before + replacement + after;

  if (!patched.startsWith(before) || !patched.endsWith(after)) {
    throw new Error('PATCH LOCALITY VIOLATION');
  }

  return patched;
}

export async function patchWithAdapter(
  adapter: PatchAdapter,
  draft: string,
  violation: Omit<Violation, 'evidence_refs'>
): Promise<string> {
  const payload: PatcherPayload = {
    draft,
    violation: structuredClone(violation),
  };

  assertNoEvidenceLeak(payload);
  const output = await adapter(payload);

  if (typeof output.replacement !== 'string') {
    throw new Error('Patcher must return a replacement string');
  }

  return applyLocalReplacement(
    draft,
    violation.patch_contract,
    output.replacement
  );
}
