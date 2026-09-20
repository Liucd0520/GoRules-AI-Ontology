import React, { useState } from 'react';
import { CloseOutlined, LoadingOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { DecisionGraphType } from '@gorules/jdm-editor';
import { MiniMarkdown } from './markdown';

type Tab = 'generate' | 'explain' | 'testdata' | 'diagnose';

type GenResult = { graph: DecisionGraphType; sampleContext: any; summary: string; attempts: number; unknownFields?: string[] };
type TestItem = { name: string; context: any; runnable: boolean; error: string };
export type LastSimError = { graph: DecisionGraphType; context: any; error: any } | null;

interface Props {
  open: boolean;
  onClose: () => void;
  graph: DecisionGraphType;
  lastSimError: LastSimError;
  onApplyGraph: (graph: DecisionGraphType) => void;
  onApplyContext: (context: any) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'generate', label: '生成规则' },
  { key: 'explain', label: '解释规则' },
  { key: 'testdata', label: '测试数据' },
  { key: 'diagnose', label: '模拟诊断' },
];

export const AiDrawer: React.FC<Props> = ({ open, onClose, graph, lastSimError, onApplyGraph, onApplyContext }) => {
  const [tab, setTab] = useState<Tab>('generate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needment, setNeedment] = useState('');
  const [genResult, setGenResult] = useState<GenResult>();
  const [explain, setExplain] = useState('');
  const [tests, setTests] = useState<TestItem[]>([]);
  const [diagnose, setDiagnose] = useState('');

  const call = async <T,>(action: string, body: any): Promise<T> => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/ai/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || `请求失败 (${res.status})`);
      return data as T;
    } finally {
      setBusy(false);
    }
  };

  const runGenerate = async () => {
    if (!needment.trim()) return;
    try {
      const data = await call<GenResult & { ok: boolean }>('generate', { requirement: needment });
      setGenResult(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const runExplain = async () => {
    try {
      const data = await call<{ markdown: string }>('explain', { graph });
      setExplain(data.markdown);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const runTestdata = async () => {
    try {
      const data = await call<{ tests: TestItem[] }>('testdata', { graph });
      setTests(data.tests);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const runDiagnose = async () => {
    if (!lastSimError) return;
    try {
      const data = await call<{ markdown: string }>('diagnose', {
        graph: lastSimError.graph,
        context: lastSimError.context,
        error: typeof lastSimError.error === 'string' ? lastSimError.error : JSON.stringify(lastSimError.error),
      });
      setDiagnose(data.markdown);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  if (!open) return null;

  return (
    <div className="ai-drawer">
      <div className="ai-header">
        <span className="ai-title">✦ AI 助手</span>
        <button className="ai-close" onClick={onClose}>
          <CloseOutlined />
        </button>
      </div>
      <div className="ai-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ai-body">
        {error && <div className="ai-error">{error}</div>}
        {busy && (
          <div className="ai-busy">
            <LoadingOutlined /> AI 正在思考，可能需要十几秒…
          </div>
        )}

        {tab === 'generate' && (
          <div className="ai-section">
            <p className="ai-hint">用一句业务需求描述，AI 自动生成决策规则（自动校验 + 模拟试跑，通过后才可应用）</p>
            <textarea
              className="ai-textarea"
              placeholder="例：生成订单促销规则——满 99 元减 10 元；VIP 用户额外 95 折；运费超过 50 元免运费"
              value={needment}
              onChange={(e) => setNeedment(e.target.value)}
              rows={4}
            />
            <button className="ai-run" onClick={runGenerate} disabled={busy || !needment.trim()}>
              {busy ? '生成中…' : '生成规则'}
            </button>
            {genResult && (
              <div className="ai-result">
                <div className="ai-ok">
                  <CheckCircleFilled /> {genResult.summary || '生成成功'}
                  <span className="ai-meta">（第 {genResult.attempts} 次尝试通过校验，已模拟运行成功）</span>
                </div>
                {genResult.unknownFields && genResult.unknownFields.length > 0 && (
                  <div className="ai-error">
                    注意：规则引用了本体之外的字段 {genResult.unknownFields.map((f) => `"${f}"`).join('、')}。
                    建议在「变量本体」中补充定义，或修改规则的字段引用。
                  </div>
                )}
                <details>
                  <summary>示例请求数据</summary>
                  <pre>{JSON.stringify(genResult.sampleContext, null, 2)}</pre>
                </details>
                <div className="ai-actions">
                  <button
                    className="ai-primary"
                    onClick={() => {
                      onApplyGraph(genResult.graph);
                      setDiagnose('');
                      setExplain('');
                    }}
                  >
                    应用到画布
                  </button>
                  <button className="ai-run" onClick={() => onApplyContext(genResult.sampleContext)}>
                    示例数据发送模拟器
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'explain' && (
          <div className="ai-section">
            <p className="ai-hint">把当前画布上的规则翻译成业务人员能看懂的说明</p>
            <button className="ai-run" onClick={runExplain} disabled={busy}>
              {busy ? '解读中…' : '解释当前规则'}
            </button>
            {explain && (
              <div className="ai-result md-wrap">
                <MiniMarkdown text={explain} />
              </div>
            )}
          </div>
        )}

        {tab === 'testdata' && (
          <div className="ai-section">
            <p className="ai-hint">分析当前规则的分支，生成覆盖各分支的测试数据（已逐组试跑验证）</p>
            <button className="ai-run" onClick={runTestdata} disabled={busy}>
              {busy ? '生成中…' : '生成测试数据'}
            </button>
            {tests.length > 0 && (
              <div className="ai-result">
                {tests.map((t, i) => (
                  <div key={i} className="test-card">
                    <div className="test-head">
                      {t.runnable ? (
                        <CheckCircleFilled style={{ color: '#52c41a' }} />
                      ) : (
                        <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                      )}
                      <span className="test-name">{t.name}</span>
                      <button className="test-use" onClick={() => onApplyContext(t.context)}>
                        发送模拟器
                      </button>
                    </div>
                    <pre>{JSON.stringify(t.context)}</pre>
                    {!t.runnable && <div className="test-err">{t.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'diagnose' && (
          <div className="ai-section">
            {!lastSimError ? (
              <p className="ai-hint">还没有失败记录。先在模拟器里点 Run，如果求值失败，这里会出现「诊断」按钮。</p>
            ) : (
              <>
                <div className="ai-error">最近一次模拟失败：{String(lastSimError.error?.data?.type ?? '求值出错')}</div>
                <button className="ai-run" onClick={runDiagnose} disabled={busy}>
                  {busy ? '诊断中…' : 'AI 诊断失败原因'}
                </button>
              </>
            )}
            {diagnose && (
              <div className="ai-result md-wrap">
                <MiniMarkdown text={diagnose} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
