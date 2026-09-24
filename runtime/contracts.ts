import type {
  ActiveContext,
  MissingContext,
  Provenance,
  Violation,
} from './types';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
  return value as JsonRecord;
}

function assertOnlyKeys(
  record: JsonRecord,
  allowed: readonly string[],
  label: string
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new Error(label + ' contains unexpected field: ' + key);
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(label + ' must be a non-empty string');
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(label + ' must be a positive safe integer');
  }
  return value as number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(label + ' must be a string array');
  }
  return [...value];
}

export function validateMissingContexts(
  value: unknown,
  label = 'missing'
): MissingContext[] {
  if (!Array.isArray(value)) {
    throw new Error(label + ' must be an array');
  }

  return value.map((raw, index) => {
    const item = asRecord(raw, label + '[' + index + ']');
    assertOnlyKeys(item, ['type', 'subject', 'question'], label + '[' + index + ']');
    const result: MissingContext = {
      type: nonEmptyString(item.type, label + '[' + index + '].type'),
      question: nonEmptyString(item.question, label + '[' + index + '].question'),
    };
    if (item.subject !== undefined) {
      result.subject = nonEmptyString(
        item.subject,
        label + '[' + index + '].subject'
      );
    }
    return result;
  });
}

export function validateActiveContextShape(value: unknown): ActiveContext {
  const context = asRecord(value, 'ACTIVE_CONTEXT');
  assertOnlyKeys(
    context,
    [
      'version',
      'facts',
      'constraints',
      'unknowns',
      'inference_barriers',
      'open_dimensions',
    ],
    'ACTIVE_CONTEXT'
  );
  if (context.version !== '0.5') {
    throw new Error('ACTIVE_CONTEXT version must be 0.5');
  }

  if (!Array.isArray(context.facts)) {
    throw new Error('ACTIVE_CONTEXT facts must be an array');
  }
  const facts = context.facts.map((raw, index) => {
    const item = asRecord(raw, 'ACTIVE_CONTEXT.facts[' + index + ']');
    assertOnlyKeys(item, ['id', 'type', 'proposition'], 'ACTIVE_CONTEXT.facts[' + index + ']');
    return {
      id: nonEmptyString(item.id, 'ACTIVE_CONTEXT.facts[' + index + '].id'),
      type: nonEmptyString(item.type, 'ACTIVE_CONTEXT.facts[' + index + '].type'),
      proposition: nonEmptyString(
        item.proposition,
        'ACTIVE_CONTEXT.facts[' + index + '].proposition'
      ),
    };
  });

  if (!Array.isArray(context.constraints)) {
    throw new Error('ACTIVE_CONTEXT constraints must be an array');
  }
  const constraints = context.constraints.map((raw, index) => {
    const item = asRecord(raw, 'ACTIVE_CONTEXT.constraints[' + index + ']');
    assertOnlyKeys(
      item,
      ['id', 'type', 'proposition', 'severity'],
      'ACTIVE_CONTEXT.constraints[' + index + ']'
    );
    if (item.severity !== 'hard' && item.severity !== 'soft') {
      throw new Error(
        'ACTIVE_CONTEXT.constraints[' + index + '].severity must be hard or soft'
      );
    }
    return {
      id: nonEmptyString(item.id, 'ACTIVE_CONTEXT.constraints[' + index + '].id'),
      type: nonEmptyString(item.type, 'ACTIVE_CONTEXT.constraints[' + index + '].type'),
      proposition: nonEmptyString(
        item.proposition,
        'ACTIVE_CONTEXT.constraints[' + index + '].proposition'
      ),
      severity: item.severity,
    };
  });

  if (!Array.isArray(context.unknowns)) {
    throw new Error('ACTIVE_CONTEXT unknowns must be an array');
  }
  const unknowns = context.unknowns.map((raw, index) => {
    const item = asRecord(raw, 'ACTIVE_CONTEXT.unknowns[' + index + ']');
    assertOnlyKeys(
      item,
      ['id', 'question', 'blocking'],
      'ACTIVE_CONTEXT.unknowns[' + index + ']'
    );
    if (typeof item.blocking !== 'boolean') {
      throw new Error(
        'ACTIVE_CONTEXT.unknowns[' + index + '].blocking must be boolean'
      );
    }
    return {
      id: nonEmptyString(item.id, 'ACTIVE_CONTEXT.unknowns[' + index + '].id'),
      question: nonEmptyString(
        item.question,
        'ACTIVE_CONTEXT.unknowns[' + index + '].question'
      ),
      blocking: item.blocking,
    };
  });

  if (!Array.isArray(context.inference_barriers)) {
    throw new Error('ACTIVE_CONTEXT inference_barriers must be an array');
  }
  const inferenceBarriers = context.inference_barriers.map((raw, index) => {
    const item = asRecord(
      raw,
      'ACTIVE_CONTEXT.inference_barriers[' + index + ']'
    );
    assertOnlyKeys(
      item,
      ['id', 'rule'],
      'ACTIVE_CONTEXT.inference_barriers[' + index + ']'
    );
    return {
      id: nonEmptyString(
        item.id,
        'ACTIVE_CONTEXT.inference_barriers[' + index + '].id'
      ),
      rule: nonEmptyString(
        item.rule,
        'ACTIVE_CONTEXT.inference_barriers[' + index + '].rule'
      ),
    };
  });

  const openDimensions = asRecord(
    context.open_dimensions,
    'ACTIVE_CONTEXT.open_dimensions'
  );
  const dimensionKeys = [
    'action_selection',
    'dialogue_realization',
    'pacing',
    'nonverbal_behavior',
    'emotional_expression',
  ] as const;
  assertOnlyKeys(openDimensions, dimensionKeys, 'ACTIVE_CONTEXT.open_dimensions');
  for (const key of dimensionKeys) {
    if (typeof openDimensions[key] !== 'boolean') {
      throw new Error('ACTIVE_CONTEXT.open_dimensions.' + key + ' must be boolean');
    }
  }

  return {
    version: '0.5',
    facts,
    constraints,
    unknowns,
    inference_barriers: inferenceBarriers,
    open_dimensions: {
      action_selection: openDimensions.action_selection as boolean,
      dialogue_realization: openDimensions.dialogue_realization as boolean,
      pacing: openDimensions.pacing as boolean,
      nonverbal_behavior: openDimensions.nonverbal_behavior as boolean,
      emotional_expression: openDimensions.emotional_expression as boolean,
    },
  };
}

export function validateProvenance(value: unknown): Provenance {
  const provenance = asRecord(value, 'PROVENANCE');
  const result: Provenance = {};

  for (const [key, raw] of Object.entries(provenance)) {
    const item = asRecord(raw, 'PROVENANCE.' + key);
    assertOnlyKeys(item, ['source_id', 'evidence'], 'PROVENANCE.' + key);
    const record = {
      source_id: nonEmptyString(item.source_id, 'PROVENANCE.' + key + '.source_id'),
    } as Provenance[string];
    if (item.evidence !== undefined) {
      if (!Array.isArray(item.evidence)) {
        throw new Error('PROVENANCE.' + key + '.evidence must be an array');
      }
      record.evidence = item.evidence.map((rawEvidence, index) => {
        const evidence = asRecord(
          rawEvidence,
          'PROVENANCE.' + key + '.evidence[' + index + ']'
        );
        assertOnlyKeys(
          evidence,
          ['section', 'locator', 'hash'],
          'PROVENANCE.' + key + '.evidence[' + index + ']'
        );
        const normalized: { section?: string; locator?: string; hash?: string } = {};
        for (const field of ['section', 'locator', 'hash'] as const) {
          if (evidence[field] !== undefined) {
            normalized[field] = nonEmptyString(
              evidence[field],
              'PROVENANCE.' + key + '.evidence[' + index + '].' + field
            );
          }
        }
        return normalized;
      });
    }
    result[key] = record;
  }
  return result;
}

export function validateViolations(value: unknown): Violation[] {
  if (!Array.isArray(value)) {
    throw new Error('Validator violations must be an array');
  }

  return value.map((raw, index) => {
    const label = 'violation[' + index + ']';
    const item = asRecord(raw, label);
    assertOnlyKeys(
      item,
      [
        'id',
        'severity',
        'location',
        'actual',
        'required_state',
        'patch_contract',
        'evidence_refs',
      ],
      label
    );

    if (item.severity !== 'hard' && item.severity !== 'soft') {
      throw new Error(label + '.severity must be hard or soft');
    }

    const location = asRecord(item.location, label + '.location');
    assertOnlyKeys(
      location,
      ['paragraph', 'sentence_start', 'sentence_end'],
      label + '.location'
    );
    const paragraph = positiveInteger(location.paragraph, label + '.location.paragraph');
    const sentenceStart = positiveInteger(
      location.sentence_start,
      label + '.location.sentence_start'
    );
    const sentenceEnd = positiveInteger(
      location.sentence_end,
      label + '.location.sentence_end'
    );
    if (sentenceEnd < sentenceStart) {
      throw new Error(label + '.location sentence range is reversed');
    }

    const actual = asRecord(item.actual, label + '.actual');
    assertOnlyKeys(actual, ['semantic_claim'], label + '.actual');
    const requiredState = asRecord(item.required_state, label + '.required_state');

    const patchContract = asRecord(item.patch_contract, label + '.patch_contract');
    assertOnlyKeys(
      patchContract,
      ['allowed_scope', 'preserve', 'required_change'],
      label + '.patch_contract'
    );
    const allowedScope = asRecord(
      patchContract.allowed_scope,
      label + '.patch_contract.allowed_scope'
    );
    assertOnlyKeys(
      allowedScope,
      ['paragraph', 'sentences'],
      label + '.patch_contract.allowed_scope'
    );
    const scopeParagraph = positiveInteger(
      allowedScope.paragraph,
      label + '.patch_contract.allowed_scope.paragraph'
    );
    if (
      !Array.isArray(allowedScope.sentences) ||
      allowedScope.sentences.length !== 2
    ) {
      throw new Error(
        label + '.patch_contract.allowed_scope.sentences must contain two integers'
      );
    }
    const scopeStart = positiveInteger(
      allowedScope.sentences[0],
      label + '.patch_contract.allowed_scope.sentences[0]'
    );
    const scopeEnd = positiveInteger(
      allowedScope.sentences[1],
      label + '.patch_contract.allowed_scope.sentences[1]'
    );
    if (scopeEnd < scopeStart) {
      throw new Error(label + '.patch_contract.allowed_scope sentence range is reversed');
    }

    const requiredChange = stringArray(
      patchContract.required_change,
      label + '.patch_contract.required_change'
    );
    if (requiredChange.length === 0) {
      throw new Error(label + '.patch_contract.required_change must not be empty');
    }

    const violation: Violation = {
      id: nonEmptyString(item.id, label + '.id'),
      severity: item.severity,
      location: {
        paragraph,
        sentence_start: sentenceStart,
        sentence_end: sentenceEnd,
      },
      actual: {
        semantic_claim: nonEmptyString(
          actual.semantic_claim,
          label + '.actual.semantic_claim'
        ),
      },
      required_state: structuredClone(requiredState),
      patch_contract: {
        allowed_scope: {
          paragraph: scopeParagraph,
          sentences: [scopeStart, scopeEnd],
        },
        preserve: stringArray(
          patchContract.preserve,
          label + '.patch_contract.preserve'
        ),
        required_change: requiredChange,
      },
    };

    if (item.evidence_refs !== undefined) {
      violation.evidence_refs = stringArray(
        item.evidence_refs,
        label + '.evidence_refs'
      );
    }
    return violation;
  });
}
