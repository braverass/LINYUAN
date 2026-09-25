import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import type {
  EvalCase,
  EvalCategory,
  EvalForbiddenItem,
  EvalRequirement,
} from './types';

const EVAL_CATEGORIES: ReadonlySet<string> = new Set([
  'personality',
  'behavior',
  'knowledge',
  'ability',
  'continuity',
  'adversarial',
]);

const REQUIREMENT_KINDS: ReadonlySet<string> = new Set([
  'fact',
  'constraint',
  'inference_barrier',
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertStringArray(
  value: unknown,
  field: string,
  source: string
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(
      'Eval case ' + source + ' field ' + field + ' must be string[]'
    );
  }
}

function requireString(
  value: unknown,
  field: string,
  source: string,
  allowEmpty = true
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(
      'Eval case ' +
        source +
        ' field ' +
        field +
        ' must be ' +
        (allowEmpty ? 'a string' : 'a non-empty string')
    );
  }
  return value;
}

function requireNullableString(
  value: unknown,
  field: string,
  source: string
): string | null {
  if (value === null) return null;
  return requireString(value, field, source);
}

function requireNonNegativeInteger(
  value: unknown,
  field: string,
  source: string
): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      'Eval case ' +
        source +
        ' field ' +
        field +
        ' must be a non-negative integer'
    );
  }
  return value as number;
}

function validateRequirements(
  value: unknown,
  field: string,
  source: string
): EvalRequirement[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'Eval case ' + source + ' field ' + field + ' must be an array'
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        'Eval case ' +
          source +
          ' field ' +
          field +
          '[' +
          index +
          '] must be an object'
      );
    }

    const kind = entry.kind;
    if (typeof kind !== 'string' || !REQUIREMENT_KINDS.has(kind)) {
      throw new Error(
        'Eval case ' +
          source +
          ' field ' +
          field +
          '[' +
          index +
          '].kind is invalid'
      );
    }

    return {
      id: requireString(
        entry.id,
        field + '[' + index + '].id',
        source,
        false
      ),
      kind: kind as EvalRequirement['kind'],
      description: requireString(
        entry.description,
        field + '[' + index + '].description',
        source
      ),
    };
  });
}

function validateForbiddenItems(
  value: unknown,
  field: string,
  source: string
): EvalForbiddenItem[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'Eval case ' + source + ' field ' + field + ' must be an array'
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        'Eval case ' +
          source +
          ' field ' +
          field +
          '[' +
          index +
          '] must be an object'
      );
    }

    return {
      id: requireString(
        entry.id,
        field + '[' + index + '].id',
        source,
        false
      ),
      description: requireString(
        entry.description,
        field + '[' + index + '].description',
        source
      ),
    };
  });
}

function validateCase(value: unknown, source: string): EvalCase {
  if (!isRecord(value)) {
    throw new Error('Invalid eval case: ' + source);
  }

  if (value.version !== '0.6') {
    throw new Error('Eval case ' + source + ' must use version 0.6');
  }

  const id = requireString(value.id, 'id', source, false);
  const category = value.category;
  if (typeof category !== 'string' || !EVAL_CATEGORIES.has(category)) {
    throw new Error('Eval case ' + source + ' field category is invalid');
  }

  const description = requireString(value.description, 'description', source);
  const request = requireString(value.request, 'request', source);

  if (!isRecord(value.scene_state)) {
    throw new Error(
      'Eval case ' + source + ' field scene_state must be an object'
    );
  }

  assertStringArray(value.required_sources, 'required_sources', source);
  assertStringArray(
    value.expected_need_context,
    'expected_need_context',
    source
  );

  const requirements = validateRequirements(
    value.requirements,
    'requirements',
    source
  );
  const forbiddenInferences = validateForbiddenItems(
    value.forbidden_inferences,
    'forbidden_inferences',
    source
  );
  const forbiddenOverconstraints = validateForbiddenItems(
    value.forbidden_overconstraints,
    'forbidden_overconstraints',
    source
  );

  if (!isRecord(value.behavioral_diversity)) {
    throw new Error(
      'Eval case ' +
        source +
        ' field behavioral_diversity must be an object'
    );
  }
  const sampleCount = requireNonNegativeInteger(
    value.behavioral_diversity.sample_count,
    'behavioral_diversity.sample_count',
    source
  );
  const minimumUniqueSignatures = requireNonNegativeInteger(
    value.behavioral_diversity.minimum_unique_signatures,
    'behavioral_diversity.minimum_unique_signatures',
    source
  );
  if (minimumUniqueSignatures > sampleCount) {
    throw new Error(
      'Eval case ' +
        source +
        ' field behavioral_diversity.minimum_unique_signatures cannot exceed sample_count'
    );
  }

  if (!isRecord(value.validator)) {
    throw new Error(
      'Eval case ' + source + ' field validator must be an object'
    );
  }
  assertStringArray(
    value.validator.gold_violations,
    'validator.gold_violations',
    source
  );
  assertStringArray(
    value.validator.gold_non_violations,
    'validator.gold_non_violations',
    source
  );

  return {
    version: '0.6',
    id,
    category: category as EvalCategory,
    description,
    request,
    scene_state: value.scene_state,
    required_sources: [...value.required_sources],
    requirements,
    forbidden_inferences: forbiddenInferences,
    forbidden_overconstraints: forbiddenOverconstraints,
    expected_need_context: [...value.expected_need_context],
    behavioral_diversity: {
      sample_count: sampleCount,
      minimum_unique_signatures: minimumUniqueSignatures,
    },
    validator: {
      gold_violations: [...value.validator.gold_violations],
      gold_non_violations: [...value.validator.gold_non_violations],
    },
    metamorphic_group: requireNullableString(
      value.metamorphic_group,
      'metamorphic_group',
      source
    ),
    synthetic_canon: requireNullableString(
      value.synthetic_canon,
      'synthetic_canon',
      source
    ),
  };
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
    const parsed = parse(await readFile(file, 'utf8')) as unknown;
    const testCase = validateCase(parsed, file);
    if (seen.has(testCase.id)) {
      throw new Error('Duplicate eval case id: ' + testCase.id);
    }
    seen.add(testCase.id);
    cases.push(testCase);
  }

  return cases;
}
