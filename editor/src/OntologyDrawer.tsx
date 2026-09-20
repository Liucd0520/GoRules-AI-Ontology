import React, { useCallback, useEffect, useState } from 'react';
import { CloseOutlined, PlusOutlined, DeleteOutlined, DatabaseOutlined } from '@ant-design/icons';

type Property = { name: string; label: string; type: string; example?: string | number | boolean };
type OntoObject = { name: string; label: string; properties: Property[] };
type Ontology = { objects: OntoObject[] };

const emptyProp = (): Property => ({ name: '', label: '', type: 'string', example: '' });

const propValue = (p: Property): unknown => {
  if (p.example !== undefined && p.example !== '') return p.example;
  if (p.type === 'number') return 0;
  if (p.type === 'boolean') return false;
  return '';
};

/** 按本体生成输入骨架：每个对象用 example（或类型默认值）组装 */
export const buildSkeleton = (ontology: Ontology): Record<string, unknown> => {
  const ctx: Record<string, unknown> = {};
  for (const obj of ontology.objects ?? []) {
    const o: Record<string, unknown> = {};
    for (const p of obj.properties ?? []) o[p.name] = propValue(p);
    ctx[obj.name] = o;
  }
  return ctx;
};

interface Props {
  open: boolean;
  onClose: () => void;
  onApplyContext: (ctx: any) => void;
}

export const OntologyDrawer: React.FC<Props> = ({ open, onClose, onApplyContext }) => {
  const [data, setData] = useState<Ontology>({ objects: [] });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ontology');
      setData(await res.json());
    } catch {
      setStatus('加载失败');
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const setObjects = (fn: (objs: OntoObject[]) => OntoObject[]) => setData((d) => ({ ...d, objects: fn(d.objects ?? []) }));

  const updateObject = (idx: number, patch: Partial<OntoObject>) =>
    setObjects((objs) => objs.map((o, i) => (i === idx ? { ...o, ...patch } : o)));

  const updateProp = (oi: number, pi: number, patch: Partial<Property>) =>
    setObjects((objs) =>
      objs.map((o, i) =>
        i === oi ? { ...o, properties: (o.properties ?? []).map((p, j) => (j === pi ? { ...p, ...patch } : p)) } : o,
      ),
    );

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const res = await fetch('/api/ontology', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data, null, 2),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      setStatus(`已保存 ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="ai-drawer onto-drawer">
      <div className="ai-header">
        <span className="ai-title">
          <DatabaseOutlined /> 变量本体
        </span>
        <button className="ai-close" onClick={onClose}>
          <CloseOutlined />
        </button>
      </div>
      <div className="ai-body">
        <p className="ai-hint">
          定义输入数据的对象与属性（唯一事实来源）。AI 生成规则、生成测试数据、输入骨架都以这里的定义为准；AI 无法引用本体之外的字段。
        </p>
        <div className="onto-toolbar">
          <button className="ai-run" onClick={() => setObjects((objs) => [...objs, { name: '', label: '', properties: [emptyProp()] }])}>
            <PlusOutlined /> 添加对象
          </button>
          <button className="ai-primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存本体'}
          </button>
          <button
            className="ai-run"
            onClick={() => {
              onApplyContext(buildSkeleton(data));
              onClose();
            }}
          >
            输入骨架发送模拟器
          </button>
        </div>
        {status && <div className={status.includes('已保存') ? 'ai-ok' : 'ai-error'}>{status}</div>}
        {(data.objects ?? []).map((obj, oi) => (
          <div key={oi} className="onto-obj">
            <div className="onto-obj-head">
              <input
                className="onto-input onto-name"
                value={obj.name}
                placeholder="对象名(英文)"
                onChange={(e) => updateObject(oi, { name: e.target.value })}
              />
              <input
                className="onto-input"
                value={obj.label}
                placeholder="中文名"
                onChange={(e) => updateObject(oi, { label: e.target.value })}
              />
              <button className="test-use onto-del" onClick={() => setObjects((objs) => objs.filter((_, i) => i !== oi))}>
                <DeleteOutlined />
              </button>
            </div>
            <table className="onto-table">
              <thead>
                <tr>
                  <th>属性名</th>
                  <th>中文名</th>
                  <th>类型</th>
                  <th>示例值</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(obj.properties ?? []).map((p, pi) => (
                  <tr key={pi}>
                    <td>
                      <input className="onto-input" value={p.name} placeholder="如 tier" onChange={(e) => updateProp(oi, pi, { name: e.target.value })} />
                    </td>
                    <td>
                      <input className="onto-input" value={p.label} placeholder="如 客户等级" onChange={(e) => updateProp(oi, pi, { label: e.target.value })} />
                    </td>
                    <td>
                      <select className="onto-input" value={p.type} onChange={(e) => updateProp(oi, pi, { type: e.target.value })}>
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="onto-input"
                        value={String(p.example ?? '')}
                        placeholder="如 vip"
                        onChange={(e) => {
                          const raw = e.target.value;
                          const val = p.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
                          updateProp(oi, pi, { example: val as any });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="test-use onto-del"
                        onClick={() => updateObject(oi, { properties: (obj.properties ?? []).filter((_, j) => j !== pi) })}
                      >
                        <DeleteOutlined />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="ai-run onto-add-prop" onClick={() => updateObject(oi, { properties: [...(obj.properties ?? []), emptyProp()] })}>
              <PlusOutlined /> 添加属性
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
