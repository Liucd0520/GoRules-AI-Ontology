import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PlayCircleOutlined, RocketOutlined, DatabaseOutlined } from '@ant-design/icons';
import '@gorules/jdm-editor/dist/style.css';
import {
  DecisionGraph,
  GraphSimulator,
  JdmConfigProvider,
  type DecisionGraphType,
  type Simulation,
} from '@gorules/jdm-editor';
import { AiDrawer, type LastSimError } from './AiDrawer';
import { OntologyDrawer } from './OntologyDrawer';
import { decisionNodeSpec } from './SubDecision';

type RuleFile = { name: string };

const safeParse = (val?: string) => {
  try {
    return JSON.parse(val ?? '');
  } catch {
    return val;
  }
};

const mapSimulateError = (graph: DecisionGraphType, error: any): Simulation | undefined => {
  const data = error?.data ?? {};
  return {
    error: {
      title: data.type ?? '求值出错',
      message: safeParse(data.source) ?? error?.message ?? String(error),
      data: { nodeId: data.nodeId },
    },
    result: data.trace
      ? {
          trace: data.trace,
          result: { error: data.source ?? String(error) },
          performance: '',
          snapshot: graph,
        }
      : undefined,
  };
};

const emptyGraph = (): DecisionGraphType => ({ nodes: [], edges: [] });

const App: React.FC = () => {
  const [files, setFiles] = useState<RuleFile[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [graph, setGraph] = useState<DecisionGraphType>(emptyGraph);
  const [loadedJson, setLoadedJson] = useState<string>('');
  const [simulation, setSimulation] = useState<Simulation>();
  const [mode, setMode] = useState<'dev' | 'business'>('dev');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [aiOpen, setAiOpen] = useState(false);
  const [ontoOpen, setOntoOpen] = useState(false);
  const [simRequest, setSimRequest] = useState(
    '{\n  "customer": { "tier": "vip", "years": 3, "monthlySpend": 1500 },\n  "order": { "total": 800 },\n  "cart": { "weight": 12 }\n}',
  );
  const [simKey, setSimKey] = useState(0);
  const [lastSimError, setLastSimError] = useState<LastSimError>(null);

  const dirty = useMemo(
    () => !!current && JSON.stringify(graph) !== loadedJson,
    [current, graph, loadedJson],
  );

  const refreshFiles = useCallback(async (keepCurrent?: string) => {
    const res = await fetch('/api/rules');
    const list: RuleFile[] = await res.json();
    setFiles(list);
    const names = list.map((f) => f.name);
    const target = keepCurrent && names.includes(keepCurrent) ? keepCurrent : names[0] ?? '';
    if (target && target !== keepCurrent) {
      await openFile(target);
    } else if (!target) {
      setCurrent('');
      setGraph(emptyGraph());
      setLoadedJson('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFile = useCallback(async (name: string) => {
    const res = await fetch(`/api/rules/${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const content = await res.text();
    setCurrent(name);
    setLoadedJson(content);
    setSimulation(undefined);
    try {
      setGraph(JSON.parse(content));
    } catch {
      setGraph(emptyGraph());
    }
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const save = useCallback(async () => {
    if (!current) return;
    setSaving(true);
    setStatus('');
    try {
      const body = JSON.stringify(graph, null, 2);
      const res = await fetch(`/api/rules/${encodeURIComponent(current)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`保存失败 (${res.status})`);
      setLoadedJson(body);
      setStatus(`已保存 ${new Date().toLocaleTimeString()}`);
    } catch (err: any) {
      setStatus(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }, [current, graph]);

  const createFile = useCallback(async () => {
    let name = window.prompt('新规则文件名（.json 结尾）', 'new-rule.json');
    if (!name) return;
    if (!name.endsWith('.json')) name += '.json';
    const starter = JSON.stringify(
      {
        edges: [
          { id: 'e1', type: 'edge', sourceId: 'input-1', targetId: 'table-1' },
          { id: 'e2', type: 'edge', sourceId: 'table-1', targetId: 'output-1' },
        ],
        nodes: [
          { id: 'input-1', type: 'inputNode', name: '请求', position: { x: 100, y: 250 }, content: { schema: '' } },
          {
            id: 'table-1',
            type: 'decisionTableNode',
            name: '决策表',
            position: { x: 420, y: 250 },
            content: {
              hitPolicy: 'first',
              inputs: [{ id: 'i1', name: '条件1', field: 'input.value' }],
              outputs: [{ id: 'o1', name: '结果', field: 'result' }],
              rules: [{ _id: 'r1', i1: '', o1: 'true' }],
            },
          },
          { id: 'output-1', type: 'outputNode', name: '响应', position: { x: 740, y: 250 }, content: { schema: '' } },
        ],
      },
      null,
      2,
    );
    const res = await fetch(`/api/rules/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: starter,
    });
    if (!res.ok) {
      setStatus('创建失败：文件名需为合法的 .json 文件名');
      return;
    }
    await refreshFiles(name);
  }, [refreshFiles]);

  const deleteFile = useCallback(async () => {
    if (!current || files.length === 0) return;
    if (!window.confirm(`确定删除 ${current} 吗？`)) return;
    await fetch(`/api/rules/${encodeURIComponent(current)}`, { method: 'DELETE' });
    await refreshFiles();
  }, [current, files.length, refreshFiles]);

  const applyContext = useCallback((ctx: any) => {
    setSimRequest(JSON.stringify(ctx, null, 2));
    setSimKey((k) => k + 1);
    setAiOpen(false);
    setStatus('测试数据已填入模拟器');
  }, []);

  const panels = useMemo(
    () => [
      {
        id: 'simulator',
        title: '模拟器',
        icon: <PlayCircleOutlined />,
        hideHeader: true,
        renderPanel: () => (
          <GraphSimulator
            key={simKey}
            defaultRequest={simRequest}
            onRun={async ({ graph: runGraph, context }) => {
              try {
                const res = await fetch('/api/simulate', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ content: runGraph, context }),
                });
                const body = await res.json();
                if (!res.ok) throw body;
                setSimulation({ result: { ...body, snapshot: runGraph } });
                setLastSimError(null);
              } catch (err) {
                setSimulation(mapSimulateError(runGraph, err));
                setLastSimError({ graph: runGraph, context, error: err });
              }
            }}
            onClear={() => setSimulation(undefined)}
          />
        ),
      },
    ],
    [simRequest, simKey],
  );

  return (
    <JdmConfigProvider>
      <div className="app-shell">
        <div className="app-header">
          <span className="app-title">本体规则智能引擎</span>
          <select value={current} onChange={(e) => openFile(e.target.value)}>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="primary" onClick={save} disabled={!current || saving || !dirty}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={createFile}>新建</button>
          <button className="danger" onClick={deleteFile} disabled={!current}>
            删除
          </button>
          <button className="primary ai-entry" onClick={() => { setAiOpen(true); setOntoOpen(false); }}>
            <RocketOutlined /> AI 助手
          </button>
          <button className="primary onto-entry" onClick={() => { setOntoOpen(true); setAiOpen(false); }}>
            <DatabaseOutlined /> 变量本体
          </button>
          <div className="mode-switch">
            <button className={mode === 'dev' ? 'active' : ''} onClick={() => setMode('dev')}>
              开发模式
            </button>
            <button className={mode === 'business' ? 'active' : ''} onClick={() => setMode('business')}>
              业务模式
            </button>
          </div>
          {dirty && <span className="dirty-dot" title="有未保存的修改" />}
          <span className="status-text">{status}</span>
        </div>
        <div className="graph-container">
          {current ? (
            <DecisionGraph
              key={current}
              value={graph}
              onChange={(val) => setGraph(val as DecisionGraphType)}
              mode={mode}
              simulate={simulation}
              components={[decisionNodeSpec] as any}
              panels={panels as any}
              defaultActivePanel="simulator"
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
              rules 目录下还没有规则文件，点击「新建」创建一个
            </div>
          )}
        </div>
        <AiDrawer
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          graph={graph}
          lastSimError={lastSimError}
          onApplyGraph={(g) => {
            setGraph(g);
            setAiOpen(false);
            setStatus('AI 规则已应用到画布（未保存，请确认后点「保存」）');
          }}
          onApplyContext={applyContext}
        />
        <OntologyDrawer open={ontoOpen} onClose={() => setOntoOpen(false)} onApplyContext={applyContext} />
      </div>
    </JdmConfigProvider>
  );
};

export default App;
