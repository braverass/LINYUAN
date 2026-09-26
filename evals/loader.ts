import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import type { EvalCase } from './types';

async function walkYaml(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkYaml(resolved)));
      continue;
    }
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      files.push(resolved);
    }
  }

  return files.sort();
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Eval case field ${field} must be string[]`);
  }
}

function validateCase(value: unknown, source: string): EvalCase {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid eval case: ${source}`);
  }

  const item = value as Record<string, unknown>;
  if (item.version !== '0.6') {
    throw new Error(`Eval case ${source} must use version 0.6`);
  }
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error(`Eval case ${source} is missing id`);
  }
  if (typeof item.request !== 'string') {
    throw new Error(`Eval case ${source} is missing request`);
  }

  assertStringArray(item.required_sources, 'required_sources');
  if (item.allowed_sources !== undefined) {
    assertStringArray(item.allowed_sources, 'allowed_sources');
  }
  assertStringArray(item.expected_need_context, 'expected_need_context');

  return item as unknown as EvalCase;
}

export async function loadEvalCases(
  roots = ['evals/cases', 'evals/adversarial']
): Promise<EvalCase[]> {
  const files: string[] = [];
  for (const root of roots) {
    files.push(...(await walkYaml(root)));
  }

  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  for (const file of files.sort()) {
    const parsed = parse(await readFile(file, 'utf8'));
    const testCase = validateCase(parsed, file);
    if (seen.has(testCase.id)) {
      throw new Error(`Duplicate eval case id: ${testCase.id}`);
    }
    seen.add(testCase.id);
    cases.push(testCase);
  }

  return cases;
}
