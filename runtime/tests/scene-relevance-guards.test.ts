import test from 'node:test';
import assert from 'node:assert/strict';

import { createModelBackedRuntime } from '../adapters/model-backed';
import type { ModelClient, ModelRequest } from '../model/types';
import { runFiction } from '../orchestrator';
import { loadRegistry, lintRegistry } from '../registry';
import { retrieveBySemanticIds } from '../retriever';

function plannerClient(select: (request: ModelRequest) => string[]): ModelClient {
  return {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request) {
      return {
        provider: 'openai', model: 'fixture-model', latencyMs: 1,
        text: JSON.stringify({ semantic_ids: select(request) }),
      };
    },
  };
}

function clients(planner: ModelClient) {
  return { retrievalPlanner: planner, compiler: planner, generator: planner,
    validator: planner, patcher: planner };
}

test('daily and childhood semantic sources retrieve only the relevant chapters', async () => {
  const fragments = await retrieveBySemanticIds([
    'WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD',
  ]);

  assert.equal(fragments.length, 2);
  assert.match(fragments[0]!.content, /^## 04-文化与日常-02-日常生活层/);
  assert.match(fragments[0]!.content, /## 第一部分：住房·通勤·邻里·家务/);
  assert.doesNotMatch(fragments[0]!.content, /## 第三部分：神经层摩擦/);
  assert.doesNotMatch(fragments[0]!.content, /## 04-文化与日常-35-/);
  assert.ok(fragments[0]!.content.length < 2_000);
  assert.match(fragments[1]!.content, /^## 05-孩子·代际·人群-01-儿童与童年/);
  assert.match(fragments[1]!.content, /## 一、儿童首先是不同的人/);
  assert.match(fragments[1]!.content, /## 三、家庭与照护/);
  assert.doesNotMatch(fragments[1]!.content, /## 五、儿童与零渊/);
  assert.doesNotMatch(fragments[1]!.content, /## 05-孩子·代际·人群-08-/);
  assert.ok(fragments[1]!.content.length < 900);
});

test('registry lint rejects a section selector that no longer exists in Canon', async () => {
  const registry = await loadRegistry();
  registry.sources['WORLD.CULTURE.DAILY'] = {
    ...registry.sources['WORLD.CULTURE.DAILY']!,
    section_heading: '04-文化与日常-99-不存在',
  };
  assert.match((await lintRegistry(registry)).join('\n'), /section heading not found/);
});

test('registry lint rejects a moved daily subsection instead of returning the whole chapter', async () => {
  const registry = await loadRegistry();
  registry.sources['WORLD.CULTURE.DAILY'] = {
    ...registry.sources['WORLD.CULTURE.DAILY']!,
    subsection_headings: ['不存在的小节'],
  };
  assert.match((await lintRegistry(registry)).join('\n'), /subsection heading not found/);
});

test('school, work and shopping routes exclude their unrelated lore sections', async () => {
  const fragments = await retrieveBySemanticIds([
    'WORLD.INSTITUTIONS.EDUCATION', 'WORLD.INSTITUTIONS.WORK',
    'WORLD.CULTURE.CONSUMPTION', 'WORLD.CULTURE.BRANDS',
    'WORLD.CULTURE.FOOD', 'WORLD.PEOPLE.SCHOOL_TEEN',
  ]);
  assert.match(fragments[0]!.content, /第二章　课程、评估与教师/);
  assert.doesNotMatch(fragments[0]!.content, /第五章　教材中的零渊/);
  assert.match(fragments[1]!.content, /二、劳动力市场与薪酬/);
  assert.doesNotMatch(fragments[1]!.content, /七、零渊相关事件/);
  assert.match(fragments[2]!.content, /第一章　消费的物质基础/);
  assert.doesNotMatch(fragments[2]!.content, /第五章　零渊相关商业活动/);
  assert.match(fragments[3]!.content, /第三章　品牌与声誉/);
  assert.match(fragments[4]!.content, /第二章　烹饪与家庭餐桌/);
  assert.doesNotMatch(fragments[4]!.content, /第四章　守护者菜单/);
  assert.doesNotMatch(fragments[5]!.content, /四、零渊在课程中的位置/);
});

test('model planner rejects excessive and overlapping broad sources', async () => {
  const excessive = await createModelBackedRuntime(clients(plannerClient(() => [
    'AUTHOR.ROUTER', 'WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD',
    'WORLD.INSTITUTIONS.EDUCATION', 'WORLD.CULTURE.FAMILY',
  ])));
  await assert.rejects(
    excessive.adapters.planInitialRetrieval!('孩子放学回家', {}),
    /at most 4/,
  );

  const overlapping = await createModelBackedRuntime(clients(plannerClient(() => [
    'WORLD.ALL', 'WORLD.CULTURE.DAILY',
  ])));
  await assert.rejects(
    overlapping.adapters.planInitialRetrieval!('孩子放学回家', {}),
    /WORLD\.ALL/,
  );

  const broad = await createModelBackedRuntime(clients(plannerClient(() => [
    'WORLD.CULTURE', 'WORLD.PEOPLE',
  ])));
  await assert.rejects(
    broad.adapters.planInitialRetrieval!('孩子放学回家', {}),
    /narrower section/,
  );
});

test('planner corrects an invalid broad first answer before retrieving Canon', async () => {
  let attempts = 0;
  const runtime = await createModelBackedRuntime(clients(plannerClient((request) => {
    attempts += 1;
    const payload = JSON.parse(request.prompt ?? '{}') as { correction?: string };
    if (attempts === 1) return ['WORLD.CULTURE', 'WORLD.PEOPLE'];
    assert.match(payload.correction ?? '', /narrower section/);
    return ['WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD'];
  })));
  const ids = await runtime.adapters.planInitialRetrieval!('孩子放学回家', {});
  assert.deepEqual(ids, ['WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD']);
  assert.equal(attempts, 2);
});

test('additional planner sees scene and already retrieved sources, and only adds missing sources', async () => {
  let seen: Record<string, unknown> = {};
  const runtime = await createModelBackedRuntime(clients(plannerClient((request) => {
    seen = JSON.parse(request.prompt ?? '{}') as Record<string, unknown>;
    return ['WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD'];
  })));
  const ids = await runtime.adapters.planAdditionalRetrieval(
    [{ type: 'childhood', question: 'How does pickup work?' }],
    '孩子放学回家',
    { location: '幼儿园' },
    ['WORLD.CULTURE.DAILY'],
  );
  assert.deepEqual(seen.scene_state, { location: '幼儿园' });
  assert.deepEqual(seen.retrieved_sources, ['WORLD.CULTURE.DAILY']);
  assert.deepEqual(ids, ['WORLD.PEOPLE.CHILDHOOD']);
});

test('ordinary scene can omit true lore without validator demanding exposition', async () => {
  const seen: ModelRequest[] = [];
  const fixture: ModelClient = {
    provider: 'openai', model: 'fixture-model', defaults: {},
    async complete(request) {
      seen.push(request);
      let value: unknown;
      switch (request.stage) {
        case 'retrieval_planner':
          value = { semantic_ids: ['WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD'] };
          break;
        case 'compiler':
          value = { status: 'READY', activeContext: {
            version: '0.5',
            facts: [
              { id: 'F1', type: 'fact', proposition: '儿童放学后常由亲人接回。' },
              { id: 'F2', type: 'fact', proposition: '远方存在星际航行。' },
              { id: 'F3', type: 'fact', proposition: '不存在的来源声称的政治规则。' },
            ],
            constraints: [], unknowns: [], inference_barriers: [],
            open_dimensions: { action_selection: true, dialogue_realization: true,
              pacing: true, nonverbal_behavior: true, emotional_expression: true },
          }, provenance: {
            F1: { source_id: 'WORLD.PEOPLE.CHILDHOOD', scene_relevance: 'material', scene_impact: 'The child is picked up by a parent.' },
            F2: { source_id: 'WORLD.CULTURE.DAILY', scene_relevance: 'background', scene_impact: 'Does not affect the school pickup.' },
            F3: { source_id: 'WORLD.SKELETON', scene_relevance: 'material', scene_impact: 'Unrelated political background.' },
          } };
          break;
        case 'generator':
          assert.deepEqual((JSON.parse(request.prompt ?? '{}') as {
            active_context: { facts: Array<{ id: string }> };
          }).active_context.facts.map((fact) => fact.id), ['F1']);
          value = { status: 'DRAFT', draft: '妈妈在校门口接过书包。孩子说今晚想吃面。' };
          break;
        case 'validator':
          value = { violations: [{
            id: 'V_MISSING_FTL', severity: 'soft',
            location: { paragraph: 1, sentence_start: 1, sentence_end: 1 },
            actual: { semantic_claim: '正文没有介绍星际航行' },
            required_state: { explain_ftl: true },
            patch_contract: { allowed_scope: { paragraph: 1, sentences: [1, 1] },
              preserve: [], required_change: ['补充FTL设定'] },
            evidence_refs: ['WORLD.SKELETON'],
          }, {
            id: 'V_WRONG_SCOPE', severity: 'soft',
            location: { paragraph: 1, sentence_start: 2, sentence_end: 2 },
            actual: { semantic_claim: 'quote from another sentence', draft_quote: '妈妈在校门口' },
            required_state: { explain_ftl: true },
            patch_contract: { allowed_scope: { paragraph: 1, sentences: [2, 2] },
              preserve: [], required_change: ['补充设定'] },
          }] };
          break;
        default:
          throw new Error(`Unexpected ${request.stage}`);
      }
      return { provider: 'openai', model: 'fixture-model', latencyMs: 1,
        text: JSON.stringify(value) };
    },
  };
  const runtime = await createModelBackedRuntime(clients(fixture));
  const result = await runFiction({
    system: 'MODE-FICTION', request: '写一个孩子放学回家的日常场景',
    sceneState: { location: '学校', characters: ['孩子', '妈妈'] },
  }, runtime.adapters);
  assert.equal(result.status, 'OUTPUT');
  if (result.status !== 'OUTPUT') return;
  assert.match(result.output, /妈妈在校门口/);
  assert.deepEqual(runtime.artifacts.compiler_rejections.map((item) => item.id), ['F2', 'F3']);
  assert.deepEqual(runtime.artifacts.validator_rejections.map((item) => item.id), [
    'V_MISSING_FTL', 'V_WRONG_SCOPE',
  ]);
  const compiler = JSON.parse(seen.find((item) => item.stage === 'compiler')!.prompt!) as {
    canon_fragments: Array<{ semanticId: string; content: string }>;
  };
  assert.deepEqual(compiler.canon_fragments.map((item) => item.semanticId), [
    'WORLD.CULTURE.DAILY', 'WORLD.PEOPLE.CHILDHOOD',
  ]);
  assert.ok(compiler.canon_fragments.reduce((total, item) => total + item.content.length, 0) < 3_000);
  const validator = JSON.parse(seen.find((item) => item.stage === 'validator')!.prompt!) as {
    request: string; scene_state: Record<string, unknown>;
  };
  assert.equal(validator.request, '写一个孩子放学回家的日常场景');
  assert.equal(validator.scene_state.location, '学校');
});
