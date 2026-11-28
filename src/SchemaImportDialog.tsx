import { useState } from "react";
import { ImportDialog, type ImportSource } from "../shared/FileDialogs.tsx";
import { importDDL } from "./ddl-import.ts";
import { importMermaid } from "./mermaid-import.ts";
import { decode, MAX_JSON_BYTES, projectDocument } from "./model.ts";
import {
  applyDefinitionCsv,
  importTableDefinition,
} from "./table-definition-import.ts";
import { appendDiagram, erFormat } from "./file-import.ts";
import { titleFromFile } from "./export.ts";
import { untitled } from "./library.ts";
import type { Diagram } from "./types.ts";

export function SchemaImportDialog({
  state,
  initialText,
  onApply,
  onClose,
}: {
  state: Diagram;
  initialText: string;
  onApply: (
    diagram: Diagram,
    separate: boolean,
    message: string,
    undoable: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [commentTarget, setCommentTarget] = useState<"logicalName" | "note">(
    "logicalName",
  );
  const hasSchema = !!(state.tables.length || state.enums?.length);
  function prepare({ text, filename, target }: ImportSource) {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_JSON_BYTES) throw new Error("ファイルの上限は16MBです。");
    const format = erFormat(text, filename);
    const separate = target === "new";
    const title =
      format === "JSON"
        ? titleFromFile(filename)
        : filename.replace(/\.[^.]*$/, "").slice(0, 200);
    if (target === "labels") {
      const diagram = applyDefinitionCsv(text, state);
      return {
        apply: () =>
          onApply(diagram, false, "論理名と説明を反映しました。", true),
      };
    }
    if (format === "JSON" || format.startsWith("定義書")) {
      const doc =
        format === "JSON"
          ? decode(text.trimStart())
          : projectDocument(importTableDefinition(text.trimStart()));
      doc.title ||= title;
      const diagram = separate
        ? doc
        : !hasSchema && !state.unresolvedEdges?.length
          ? { ...doc, title: state.title }
          : appendDiagram(state, doc);
      if (!separate && !hasSchema) {
        diagram.ddlDialect = doc.ddlDialect ?? state.ddlDialect;
        diagram.ddlAnnotations = doc.ddlAnnotations ?? state.ddlAnnotations;
        if (state.title === untitled) diagram.title = doc.title || state.title;
      }
      return {
        apply: () =>
          onApply(diagram, separate, format + " を読み込みました。", false),
      };
    }
    if (!format)
      throw new Error(
        "形式を判定できません。JSON、DDL、Mermaid、定義書を選んでください。",
      );
    if (bytes > 2_000_000) throw new Error(format + " は2MBまで読み込めます。");
    const base = separate ? undefined : state;
    const result: ReturnType<typeof importMermaid> &
      Partial<Pick<ReturnType<typeof importDDL>, "database" | "ignoredCount">> =
      format === "DDL"
        ? importDDL(text, base, commentTarget)
        : importMermaid(text, base);
    const { diagram, issues, applied, tableCount } = result;
    const ignored = result.ignoredCount
      ? "図に関係しない文を" + result.ignoredCount + "件読み飛ばしました。"
      : "";
    if (separate || !hasSchema) {
      diagram.ddlDialect ??= state.ddlDialect;
      if (separate || !diagram.title || diagram.title === untitled)
        diagram.title =
          result.database ||
          (format === "Mermaid" &&
            diagram.title !== untitled &&
            diagram.title) ||
          title ||
          diagram.title;
    }
    const warnings = issues.map(
      (issue) => issue.line + "行目：" + issue.message,
    );
    if (!applied || warnings.length)
      warnings.unshift(
        (applied
          ? tableCount
            ? tableCount + "個のテーブルを読み込めます。"
            : "読み込める変更があります。"
          : "読み込める定義がありません。") + ignored,
      );
    return {
      warnings,
      blocked: !applied,
      apply: () =>
        onApply(
          diagram,
          separate,
          (tableCount ? tableCount + "個のテーブル" : format) +
            "を読み込みました。" +
            ignored,
          true,
        ),
    };
  }
  return (
    <ImportDialog
      initialText={initialText}
      formats="JSON · DDL · Mermaid · 定義書（Markdown / CSV）"
      accept=".json,.sql,.ddl,.mmd,.mermaid,.md,.csv,.txt"
      maxBytes={MAX_JSON_BYTES}
      detect={erFormat}
      defaultNew={!initialText && hasSchema}
      canApplyLabels={(format) =>
        format === "定義書（CSV）" && !!state.tables.length
      }
      options={(format) =>
        format === "DDL" && (
          <fieldset>
            <legend>コメントの読み込み方</legend>
            {(["logicalName", "note"] as const).map((target) => (
              <label key={target}>
                <input
                  type="radio"
                  name="ddl-comments"
                  checked={target === commentTarget}
                  onChange={() => setCommentTarget(target)}
                />
                {target === "logicalName"
                  ? "短いコメントを論理名にする"
                  : "すべて説明にする"}
              </label>
            ))}
            <small>
              81文字以上、または改行を含むコメントは説明に入ります。
            </small>
          </fieldset>
        )
      }
      prepare={prepare}
      onClose={onClose}
    />
  );
}
