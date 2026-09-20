import React from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import {
  GraphNode,
  nodeSpecification,
  useDecisionGraphActions,
  useDecisionGraphState,
  type NodeSpecification,
} from '@gorules/jdm-editor';

/** 画布上的子决策节点渲染 */
const SubDecisionNode: React.FC<{ id: string; data: any; selected?: boolean; specification?: any }> = ({
  id,
  data,
  selected,
  specification,
}) => {
  const key = data?.content?.key ?? '';
  return (
    <GraphNode
      id={id}
      specification={specification}
      name={data?.name ?? '子决策'}
      icon={<ApartmentOutlined />}
      type={<span style={{ fontSize: 11 }}>{key ? `调用 ${key}` : '未设置引用规则'}</span>}
      handleLeft
      handleRight
      isSelected={selected}
      status={key ? undefined : 'warning'}
    />
  );
};

/** 子决策节点设置面板 */
const SubDecisionSettings: React.FC<{ id: string }> = ({ id }) => {
  const actions = useDecisionGraphActions();
  const node = useDecisionGraphState((s) => s.decisionGraph.nodes.find((n) => n.id === id));
  const content = (node as any)?.content ?? { key: '' };
  const update = (patch: Record<string, unknown>) =>
    actions.updateNode(id, (draft: any) => {
      draft.content = { ...draft.content, ...patch };
      return draft;
    });
  return (
    <div style={{ padding: 16, display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.7 }}>
        子决策：引用 rules 目录下的另一套规则，执行到该节点时自动加载求值，其输出字段作为本节点的输出向下游传递。
      </div>
      <label style={{ fontSize: 13 }}>
        引用的规则文件（key）
        <input
          style={{ width: '100%', marginTop: 6, padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 13 }}
          value={content.key ?? ''}
          placeholder="例如 customer-score.json"
          onChange={(e) => update({ key: e.target.value })}
        />
      </label>
    </div>
  );
};

/** 子决策节点的规格定义 */
export const decisionNodeSpec: NodeSpecification<any> = {
  type: 'decisionNode',
  displayName: '子决策',
  shortDescription: '调用另一套规则，其结果作为本节点输出',
  icon: <ApartmentOutlined />,
  group: 'Components',
  generateNode: ({ index }) => ({
    name: `子决策 ${index + 1}`,
    content: { key: '' },
  }),
  renderNode: SubDecisionNode as any,
  renderSettings: SubDecisionSettings as any,
};

/** 完整组件列表 = 官方 6 种内置 + 子决策 */
export const graphComponents: NodeSpecification<any>[] = [
  ...Object.values(nodeSpecification),
  decisionNodeSpec,
];
