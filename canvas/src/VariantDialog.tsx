import { useEffect, useRef, useState } from "react";
import { decisionSummary } from "./types";
import { openDiagram, type DiagramEntry } from "./library";

export function DecisionRecords({ entry }: { entry: DiagramEntry }) {
  const records = openDiagram(entry.key, entry.raw).doc.decisions;
  if (!records?.length) return null;
  return (
    <div className="decision-records">
      <strong>決定の記録</strong>
      {records.map((d, i) => (
        <p key={i}>{decisionSummary(d)}</p>
      ))}
    </div>
  );
}

type Props = {
  defaultName: string;
  archiveName?: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
};
export function VariantDialog({
  defaultName,
  archiveName,
  onCancel,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(archiveName ? "" : defaultName);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector("input")?.select();
  }, []);
  return (
    <dialog
      className="help-dialog variant-form"
      ref={ref}
      aria-labelledby="variant-form-title"
      onClose={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onSubmit(value.trim());
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <h2 id="variant-form-title">
          {archiveName ? "「" + defaultName + "」に決めますか？" : "案を作る"}
        </h2>
        {archiveName && (
          <p>
            今の図は「{archiveName}
            」として残ります。戻すときは「案を比べる」で選んでください。
          </p>
        )}
        <label className="field">
          <span>{archiveName ? "決めた理由（任意）" : "案の名前"}</span>
          <input
            autoFocus
            maxLength={archiveName ? 500 : 200}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button className="primary" disabled={!archiveName && !value.trim()}>
            {archiveName ? "決定する" : "作る"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
