import type { RefObject } from "react";
import { Icon } from "./Icons";

const FEATURES = [
  [
    "図の一覧",
    "メニューから保存済みの図を開いたり、新しい図を作ったりできます。",
  ],
  [
    "案を比べる",
    "「案を作る」で図を複製し、「図の一覧」から元の図と並べて見られます。",
  ],
  [
    "メモ",
    "図形の「メモ」に理由を書きます。「メモの一覧」では未決・決定・懸念で絞れます。",
  ],
  [
    "線の種類",
    "線を選ぶと矢印（片方向・双方向・なし）や破線に切り替えられます。ダブルクリックでラベルを書けます。",
  ],
  [
    "Mermaid",
    "flowchart を ⌘ V で貼り付けると図になります。メニューから Mermaid のコピーや保存もできます。",
  ],
  [
    "画像を保存・コピー",
    "SVG・PNG で保存できます。⌘ Shift C で選択部分を、何も選んでいないときは図全体をコピーします。",
  ],
  [
    "図とメモを書き出す",
    "メニューの「Markdownで保存（図付き）」か「閲覧用HTMLで保存」を選びます。",
  ],
];

const SHORTCUTS = [
  ["図形 / テキストを追加", "B / N（カーソルの位置）"],
  ["文字を編集", "ダブルクリック / Enter"],
  ["編集を確定", "Esc / ⌘ Enter"],
  ["接続", "C"],
  ["複数選択", "Shift＋クリック / 余白をドラッグ"],
  ["囲む", "⌘ G"],
  ["選んだものを移動", "矢印キー（Shift で大きく）"],
  ["複製 / コピー / 貼り付け", "⌘ D / ⌘ C / ⌘ V"],
  ["キャンバスを移動", "2本指スクロール / Space＋ドラッグ"],
  ["拡大・縮小", "ピンチ / Ctrl＋ホイール"],
  ["全体を表示", "1"],
  ["元に戻す / やり直す", "⌘ Z / ⌘ Shift Z"],
  ["ファイルに保存", "⌘ S"],
];

function helpRow([label, value]: string[]) {
  return (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function HelpDialog({
  dialog,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
}) {
  return (
    <dialog
      ref={dialog}
      aria-labelledby="canvas-help-title"
      className="help-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="canvas-help-title">使い方</h2>
        <button
          className="icon-button"
          aria-label="使い方を閉じる"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <ol className="help-steps">
        <li>
          <strong>図形を置く</strong>
          左の「箱」を選び、方眼の置きたい場所をクリックします。
        </li>
        <li>
          <strong>書く</strong>名前を入力します。Enter で説明に移り、Esc
          で確定します。
        </li>
        <li>
          <strong>つなぐ</strong>
          図形の端の矢印をクリックすると、次の図形がつながります。すでに置いた図形には、矢印をそこまでドラッグします。
        </li>
      </ol>
      <dl>{FEATURES.map(helpRow)}</dl>
      <details className="help-keys">
        <summary>キーボードとマウスの操作</summary>
        <dl>{SHORTCUTS.map(helpRow)}</dl>
      </details>
      <p className="field-help">
        変更はこのブラウザに自動保存されます。ほかの端末で編集するには「ファイルに保存」を使います。Windows
        では ⌘ を Ctrl に読み替えてください。
      </p>
      <button className="primary" onClick={() => dialog.current?.close()}>
        閉じる
      </button>
    </dialog>
  );
}
