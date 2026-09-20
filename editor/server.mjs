import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZenEngine } from '@gorules/zen-engine';
import { generateRule, explainRule, genTestDatas, diagnoseFailure, aiConfigError } from './ai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.resolve(__dirname, '..', 'rules');
const ONTOLOGY_PATH = path.join(RULES_DIR, 'ontology.json');
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 8700);

const app = express();
app.use(express.json({ limit: '32mb' }));

// loader: 支持 decisionNode 子决策——按 key 从 rules 目录加载被引用的规则
const engine = new ZenEngine({ loader: { type: 'fs', path: RULES_DIR } });

const safeName = (name) => {
  const n = String(name || '');
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5.]+$/.test(n) || !n.endsWith('.json') || n.includes('..')) {
    return null;
  }
  return n;
};

const rulePath = (name) => path.join(RULES_DIR, name);

app.get('/api/rules', async (_req, res) => {
  try {
    await fs.mkdir(RULES_DIR, { recursive: true });
    const files = await fs.readdir(RULES_DIR);
    const list = files.filter((f) => f.endsWith('.json') && f !== 'ontology.json').map((name) => ({ name }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

app.get('/api/ontology', async (_req, res) => {
  try {
    const content = await fs.readFile(ONTOLOGY_PATH, 'utf-8');
    res.type('application/json').send(content);
  } catch {
    res.json({ objects: [] });
  }
});

app.put('/api/ontology', async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed.objects)) throw new Error('本体格式错误：缺少 objects 数组');
    for (const obj of parsed.objects) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(String(obj.name ?? ''))) throw new Error(`对象名不合法: ${obj.name}`);
      if (!Array.isArray(obj.properties)) throw new Error(`对象 ${obj.name} 缺少 properties 数组`);
      for (const p of obj.properties) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(String(p.name ?? ''))) throw new Error(`${obj.name} 的属性名不合法: ${p.name}`);
      }
    }
    await fs.mkdir(RULES_DIR, { recursive: true });
    await fs.writeFile(ONTOLOGY_PATH, body.endsWith('\n') ? body : body + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: `保存本体失败: ${String(err?.message ?? err)}` });
  }
});

app.get('/api/rules/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ message: '非法文件名' });
  try {
    const content = await fs.readFile(rulePath(name), 'utf-8');
    res.type('application/json').send(content);
  } catch {
    res.status(404).json({ message: '文件不存在' });
  }
});

app.put('/api/rules/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ message: '非法文件名' });
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    JSON.parse(body);
    await fs.mkdir(RULES_DIR, { recursive: true });
    await fs.writeFile(rulePath(name), body.endsWith('\n') ? body : body + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: `保存失败: ${String(err?.message ?? err)}` });
  }
});

app.delete('/api/rules/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ message: '非法文件名' });
  try {
    await fs.rm(rulePath(name), { force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

app.post('/api/simulate', async (req, res) => {
  const { content, context } = req.body ?? {};
  if (!content) return res.status(400).json({ data: { type: '请求错误', source: '缺少规则内容' } });
  let decision;
  try {
    decision = engine.createDecision(typeof content === 'string' ? JSON.parse(content) : content);
  } catch (err) {
    return res.status(400).json({ data: { type: '解析错误', source: String(err?.message ?? err) } });
  }
  try {
    const response = await decision.evaluate(context ?? {}, { trace: true });
    res.json(response);
  } catch (err) {
    const payload = {
      type: '求值错误',
      source: String(err?.message ?? err),
      nodeId: err?.nodeId ?? err?.data?.nodeId,
      trace: err?.trace ?? err?.data?.trace,
    };
    try {
      const parsed = JSON.parse(String(err?.message ?? ''));
      if (parsed && typeof parsed === 'object') {
        payload.type = parsed.type ?? payload.type;
        payload.source = parsed.source ?? parsed.message ?? payload.source;
        payload.nodeId = parsed.nodeId ?? payload.nodeId;
        payload.trace = parsed.trace ?? payload.trace;
      }
    } catch {
      /* message 不是 JSON，保持原样 */
    }
    res.status(400).json({ data: payload });
  }
});

app.post('/api/ai/:action', async (req, res) => {
  const action = req.params.action;
  const cfgErr = aiConfigError();
  if (cfgErr) return res.status(503).json({ message: cfgErr });
  const handlers = {
    generate: generateRule,
    explain: explainRule,
    testdata: genTestDatas,
    diagnose: diagnoseFailure,
  };
  const handler = handlers[action];
  if (!handler) return res.status(404).json({ message: `未知的 AI 功能: ${action}` });
  try {
    const result = await handler(req.body ?? {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ message: String(err?.message ?? err) });
  }
});

app.use(express.static(DIST_DIR));

app.listen(PORT, () => {
  console.log(`[editor-server] http://localhost:${PORT}`);
  console.log(`[editor-server] 规则目录: ${RULES_DIR}`);
  if (!existsSync(DIST_DIR)) {
    console.log('[editor-server] 提示: dist 不存在，请先 npm run build；开发模式请运行 npm run dev (vite:5173)');
  }
});
