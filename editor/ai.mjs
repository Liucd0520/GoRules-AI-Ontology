/**
 * AI 助手模块（OpenAI 兼容接口）
 * - chat()            LLM 调用封装
 * - generateRule()    自然语言 -> JDM JSON（带结构校验 + 模拟试跑的自动返修闭环）
 * - explainRule()     JDM JSON -> 业务化中文说明
 * - genTestDatas()    JDM JSON -> 覆盖各分支的测试数据集
 * - diagnoseFailure() 模拟失败 trace -> 诊断结论
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZenEngine } from '@gorules/zen-engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.resolve(__dirname, '..', 'rules');
const CONFIG_PATH = path.join(__dirname, 'ai-config.json');

export function loadAiConfig() {
  const env = process.env;
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    /* 配置文件不存在时退回环境变量 */
  }
  return {
    baseUrl: (env.AI_BASE_URL || file.baseUrl || '').replace(/\/+$/, ''),
    apiKey: env.AI_API_KEY || file.apiKey || '',
    model: env.AI_MODEL || file.model || '',
    temperature: Number(env.AI_TEMPERATURE ?? file.temperature ?? 0.3),
  };
}

export function aiConfigError() {
  const cfg = loadAiConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return 'AI 未配置：请在 editor/ai-config.json 中填写 baseUrl / apiKey / model（或设置环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL），然后重启服务';
  }
  return null;
}

async function chat(messages, { jsonMode = false } = {}) {
  const cfg = loadAiConfig();
  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 接口错误 ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空');
  return content;
}

/* ---------------- JDM 提示词规范包 ---------------- */

const JDM_SPEC = `你是一个 GoRules ZEN 决策模型（JDM JSON）专家。输出必须是严格的 JDM JSON。

## 格式总则
顶层结构: { "edges": [...], "nodes": [...] }
- 恰好一个 inputNode（id 常用 "input-1"，无入边）和一个 outputNode（id 常用 "output-1"，无出边）
- 中间节点用 edges 链成有向无环图，从 input 可达 output
- 每个节点必须有唯一 id、type、name（中文）、position {x,y}（x 每级 +340 左右，y 250 附近，分支上下错开 150）

## 节点类型
1. inputNode / outputNode:
   { "id": "...", "type": "inputNode", "name": "请求", "position": {...}, "content": { "schema": "" } }

2. decisionTableNode（决策表）:
   { "id": "...", "type": "decisionTableNode", "name": "...", "position": {...},
     "content": {
       "hitPolicy": "first",            // 首次命中
       "inputs":  [{ "id": "i1", "name": "中文列名", "field": "a.b" }],   // field 为点路径，取自请求上下文
       "outputs": [{ "id": "o1", "name": "中文列名", "field": "resultKey" }],
       "rules":  [{ "_id": "r1", "i1": "<条件表达式>", "o1": "<输出表达式>" }],
       "passThrough": true, "inputField": null, "outputPath": null, "executionMode": "single"
     } }
   条件单元格语法（重要！）: 空字符串表示任意；否则是 "操作符 值" 或裸表达式字面量：
     ">= 5"  "<= 3"  "> 20"  "< 100"  "\\"vip\\""  "[1,2,3]"（in 集合）  ">= 5 and <= 10"
   输出单元格: JS 风格表达式字面量，如 "0.1"  "\\"gold\\""  "score + 5"  "\\"¥\\" + string(fee)"
   最后一行建议留空条件作兜底。

3. expressionNode（表达式）:
   { "id": "...", "type": "expressionNode", "name": "...", "position": {...},
     "content": {
       "expressions": [{ "id": "ex1", "key": "输出字段名", "value": "zen 表达式" }],
       "passThrough": true, "inputField": null, "outputPath": null, "executionMode": "single"
     } }
   表达式语法为 zen-expression（类 JS 子集）：支持 三元/算术/比较/逻辑运算、字符串拼接、string()、in 等；
   上游节点的输出字段直接用变量名引用（如 shippingFee）。
   注意：同一表达式节点内的多个表达式不能互相引用（各自独立求值），需要引用时拆成两个串联的表达式节点。

4. switchNode（分支）:
   { "id": "...", "type": "switchNode", "name": "...", "position": {...},
     "content": { "hitPolicy": "first",
       "statements": [
         { "id": "s1", "condition": "level == \\"gold\\"", "isDefault": false },
         { "id": "s2", "condition": "", "isDefault": true }
       ] } }
   switch 的每条出边必须带 "sourceHandle" 等于对应 statement 的 id。

5. decisionNode（子决策，调用另一套规则文件）:
   { "id": "...", "type": "decisionNode", "name": "...", "position": {...},
     "content": { "key": "<被引用的规则文件名，如 customer-score.json>" } }
   执行到该节点时，引擎自动加载并求值被引用的规则，其输出结果（如 score/level 等字段）会合并进本图上下文向下游传递。
   仅当用户需求中明确提到"调用/复用已有规则"时才使用。

## edge 结构
{ "id": "e1", "type": "edge", "sourceId": "<节点id>", "targetId": "<节点id>" }
switch 出边额外带 "sourceHandle": "<statement id>"。

## 参考示例（真实可运行的 JDM 文件）
{{EXAMPLES}}`;

function loadExamples() {
  try {
    const files = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.json') && f !== 'ontology.json').slice(0, 2);
    return files
      .map((f) => `### ${f}\n${fs.readFileSync(path.join(RULES_DIR, f), 'utf-8').slice(0, 6000)}`)
      .join('\n\n');
  } catch {
    return '（rules 目录暂无示例）';
  }
}

/* ---------------- 变量本体 ---------------- */

export function loadOntology() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(RULES_DIR, 'ontology.json'), 'utf-8'));
    return Array.isArray(parsed.objects) ? parsed.objects : [];
  } catch {
    return [];
  }
}

function ontologyToPrompt(objects) {
  if (!objects.length) return '（本体未定义，可按需求合理设计字段，用小驼峰命名）';
  return objects
    .map((obj) => {
      const props = (obj.properties ?? [])
        .map((p) => `${p.name} ${p.label}(${p.type}${p.example !== undefined ? `, 例: ${JSON.stringify(p.example)}` : ''})`)
        .join('; ');
      return `- ${obj.name} ${obj.label}: ${props}`;
    })
    .join('\n');
}

function knownFieldSet(objects) {
  const set = new Set();
  for (const obj of objects) {
    set.add(obj.name);
    for (const p of obj.properties ?? []) set.add(`${obj.name}.${p.name}`);
  }
  return set;
}

/** 检查决策表 input field 是否越界（引用了本体之外的字段） */
function findUnknownFields(graph, objects) {
  if (!objects.length) return [];
  const known = knownFieldSet(objects);
  const unknown = new Set();
  for (const n of graph.nodes ?? []) {
    if (n.type !== 'decisionTableNode') continue;
    for (const input of n.content?.inputs ?? []) {
      const field = String(input.field ?? '').trim();
      if (field && !known.has(field)) unknown.add(field);
    }
  }
  return [...unknown];
}

function systemPrompt() {
  return JDM_SPEC.replace('{{EXAMPLES}}', loadExamples());
}

/* ---------------- 工具函数 ---------------- */

function extractJson(text) {
  const strip = (s) => {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (m ? m[1] : s).trim();
  };
  try {
    return { ok: true, value: JSON.parse(strip(text)) };
  } catch {
    return { ok: false, error: '无法解析为 JSON' };
  }
}

function validateJdm(graph) {
  if (!graph || typeof graph !== 'object') return 'graph 必须是对象';
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) return 'nodes 必须是非空数组';
  if (!Array.isArray(graph.edges)) return 'edges 必须是数组';
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) return '节点 id 重复';
  for (const n of graph.nodes) {
    if (!n.id || !n.type || !n.name) return `节点缺少 id/type/name: ${JSON.stringify(n).slice(0, 80)}`;
    if (typeof n.position?.x !== 'number' || typeof n.position?.y !== 'number') {
      return `节点 ${n.id} 缺少 position`;
    }
  }
  for (const e of graph.edges) {
    if (!ids.has(e.sourceId) || !ids.has(e.targetId)) return `边引用了不存在的节点: ${JSON.stringify(e)}`;
  }
  const hasInput = graph.nodes.some((n) => n.type === 'inputNode');
  const hasOutput = graph.nodes.some((n) => n.type === 'outputNode');
  if (!hasInput) return '缺少 inputNode';
  if (!hasOutput) return '缺少 outputNode';
  const switchIds = new Set(graph.nodes.filter((n) => n.type === 'switchNode').map((n) => n.id));
  for (const n of graph.nodes.filter((n) => n.type === 'switchNode')) {
    const stmtIds = new Set((n.content?.statements ?? []).map((s) => s.id));
    for (const e of graph.edges.filter((e) => e.sourceId === n.id)) {
      if (!e.sourceHandle || !stmtIds.has(e.sourceHandle)) {
        return `switch 节点 ${n.id} 的出边缺少合法 sourceHandle（需等于 statement id）`;
      }
    }
  }
  return null;
}

// 与 server.mjs 一致：配置 loader 以支持 decisionNode 子决策
const simEngine = new ZenEngine({ loader: { type: 'fs', path: RULES_DIR } });

async function trySimulate(graph, context) {
  try {
    const decision = simEngine.createDecision(graph);
    await decision.evaluate(context ?? {}, { trace: true });
    return null;
  } catch (err) {
    return String(err?.message ?? err).slice(0, 500);
  }
}

/* ---------------- 四个功能 ---------------- */

export async function generateRule({ requirement, maxRetries = 3 }) {
  const ontology = loadOntology();
  const messages = [
    { role: 'system', content: systemPrompt() },
    {
      role: 'user',
      content: `请根据以下业务需求生成 JDM 决策规则 JSON。

## 输入变量本体（重要！）
请求上下文中的变量必须且只能使用以下对象和字段（点路径写法如 customer.tier）：
${ontologyToPrompt(ontology)}

要求：
1. 只输出一个 JSON 对象，不要输出任何解释文字
2. 顶层为 { "graph": <JDM 对象>, "sampleContext": <一组能命中主路径的示例请求数据对象>, "summary": "<一句话中文说明>" }
3. 决策表的条件列、表达式必须使用合法的 zen-expression 语法
4. 决策表 input 的 field 只能引用本体中定义的字段；sampleContext 的字段也必须来自本体
5. 如果需求涉及本体中没有的概念，使用最接近的本体字段实现，并在 summary 末尾附加"[建议扩充本体: xxx]"说明
6. 节点/字段名称用中文，便于业务人员阅读

业务需求：${requirement}`,
    },
  ];
  let lastError = '';
  for (let i = 0; i < maxRetries; i++) {
    const text = await chat(messages, { jsonMode: true });
    const parsed = extractJson(text);
    if (!parsed.ok) {
      lastError = parsed.error;
    } else {
      const { graph, sampleContext, summary } = parsed.value ?? {};
      const structErr = graph ? validateJdm(graph) : '缺少 graph 字段';
      if (!structErr) {
        const simErr = await trySimulate(graph, sampleContext);
        if (!simErr) {
          const unknownFields = findUnknownFields(graph, ontology);
          return {
            ok: true,
            graph,
            sampleContext: sampleContext ?? {},
            summary: summary ?? '',
            attempts: i + 1,
            unknownFields,
          };
        }
        lastError = `模拟运行失败: ${simErr}`;
      } else {
        lastError = `结构校验失败: ${structErr}`;
      }
      messages.push({ role: 'assistant', content: text });
    }
    messages.push({
      role: 'user',
      content: `你输出的 JSON 未通过校验：${lastError}。请修复问题，重新输出完整的 { "graph": ..., "sampleContext": ..., "summary": ... } JSON，不要输出其它内容。`,
    });
  }
  return { ok: false, error: `经过 ${maxRetries} 次尝试仍未生成合法规则，最后错误: ${lastError}` };
}

export async function explainRule({ graph }) {
  const text = await chat(
    [
      {
        role: 'system',
        content: `你是业务规则讲解专家。给你一个 JDM 决策规则 JSON，请用中文向业务人员讲解它。输出 Markdown，结构如下：
# 规则概述（一句话：这个规则解决什么业务问题）
# 执行流程（按输入→各节点→输出，说明数据怎么流动、分支怎么走）
# 决策逻辑明细（每个决策表用 Markdown 表格列出：条件→结果；每个关键表达式用大白话解释）
# 使用建议（如何调用、需要传哪些字段、有哪些注意点）
语言简洁，避免技术术语堆砌。`,
      },
      { role: 'user', content: `JDM 规则 JSON：\n${JSON.stringify(graph)}` },
    ],
    { jsonMode: false },
  );
  return { ok: true, markdown: text };
}

export async function genTestDatas({ graph, count = 4 }) {
  const ontology = loadOntology();
  const text = await chat(
    [
      {
        role: 'system',
        content: `你是决策规则测试专家。给你一个 JDM 决策规则 JSON，生成 ${count} 组测试请求数据，尽量覆盖决策表的每一行与 switch 的每条分支（含兜底）。

## 输入变量本体
测试数据的字段必须且只能使用以下对象和字段：
${ontologyToPrompt(ontology)}

只输出 JSON：{ "tests": [{ "name": "<中文用例名，如：VIP大额订单>", "context": {<请求数据对象>} }, ...] }
context 的字段路径必须与本体一致（如 customer.years），值要能触发规则的不同分支。`,
      },
      { role: 'user', content: `JDM 规则 JSON：\n${JSON.stringify(graph)}` },
    ],
    { jsonMode: true },
  );
  const parsed = extractJson(text);
  if (!parsed.ok) return { ok: false, error: 'LLM 返回的不是合法 JSON' };
  const tests = Array.isArray(parsed.value?.tests)
    ? parsed.value.tests
        .filter((t) => t && typeof t.context === 'object')
        .map((t) => ({ name: String(t.name ?? '用例'), context: t.context }))
    : [];
  if (!tests.length) return { ok: false, error: '未解析到有效测试数据' };
  const results = await Promise.all(
    tests.map(async (t) => {
      const err = await trySimulate(graph, t.context);
      return { ...t, runnable: !err, error: err ?? '' };
    }),
  );
  return { ok: true, tests: results };
}

export async function diagnoseFailure({ graph, context, error }) {
  let traceText = '';
  try {
    const decision = simEngine.createDecision(graph);
    const res = await decision.evaluate(context ?? {}, { trace: true });
    traceText = JSON.stringify(res.trace).slice(0, 4000);
  } catch (err) {
    traceText = `求值抛出错误: ${String(err?.message ?? err).slice(0, 1000)}`;
  }
  const text = await chat(
    [
      {
        role: 'system',
        content: `你是决策规则排错专家。用户在模拟一个 JDM 决策规则时遇到问题。给你规则 JSON、请求数据、错误信息与执行 trace，请用中文输出 Markdown 诊断：
# 问题定位（哪个节点/哪一行条件出了问题）
# 原因分析（为什么，例如字段缺失导致条件不命中、表达式引用了未定义变量等）
# 修复建议（具体怎么改：改规则、改数据，给出修改后的值）
注意：决策表条件里对 undefined 字段做比较会判为不成立并落入兜底行，这是常见坑。`,
      },
      {
        role: 'user',
        content: `规则 JSON：\n${JSON.stringify(graph)}\n\n请求数据：\n${JSON.stringify(context ?? {})}\n\n错误信息：\n${String(error ?? '(无，结果不符合预期)')}\n\n执行 trace：\n${traceText}`,
      },
    ],
    { jsonMode: false },
  );
  return { ok: true, markdown: text };
}
