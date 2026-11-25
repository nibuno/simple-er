import { useState } from "react";
import { Icon } from "./Icons";
import { memoNodes, memoOwnerName } from "./model";
import { memoStatusLabels } from "./types";
import type { CanvasDocument, CanvasNode } from "./types";

export function MemoList({
  doc,
  selectedId,
  onSelect,
  onClose,
}: {
  doc: CanvasDocument;
  selectedId?: string;
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const memos = memoNodes(doc);
  const visible =
    filter === "all"
      ? memos
      : memos.filter((node) => (node.memoStatus || "") === filter);
  return (
    <aside
      className="memo-list"
      aria-labelledby="memo-list-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <h2 id="memo-list-title">メモの一覧</h2>
        <button
          className="icon-button"
          aria-label="メモの一覧を閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <label className="field memo-status-field">
        <span>状態</span>
        <select
          aria-label="メモを状態で絞り込む"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        >
          <option value="all">すべて</option>
          {Object.entries(memoStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="">未設定</option>
        </select>
      </label>
      {visible.length ? (
        <ul>
          {visible.map((node, index) => (
            <li key={node.id}>
              <button
                className="memo-row"
                aria-current={node.id === selectedId || undefined}
                aria-labelledby={"memo-name-" + index}
                aria-describedby={"memo-body-" + index}
                onClick={() => onSelect(node)}
              >
                <span className="memo-row-heading" id={"memo-name-" + index}>
                  <strong>{memoOwnerName(node)}</strong>
                  <span data-memo-status={node.memoStatus}>
                    {node.memoStatus
                      ? memoStatusLabels[node.memoStatus]
                      : "未設定"}
                  </span>
                </span>
                <span className="memo-body" id={"memo-body-" + index}>
                  {node.body}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {memos.length
            ? "この状態のメモはありません。"
            : "この図にはメモがありません。"}
        </p>
      )}
    </aside>
  );
}
