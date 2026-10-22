// Icons a box can carry beside its name. Drawn in the same line weight as
// the interface, so a box stays quiet; exports reuse the same paths.
const ICON_PATHS = {
  "icon-server": "M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01",
  "icon-cpu":
    "M7 7h10v10H7Z M10 10h4v4h-4Z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4",
  "icon-clock": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 7v5l3 2",
  "icon-queue": "M3 8h18v8H3Z M8 8v8 M13 8v8",
  "icon-bolt": "M13 3 5 14h6l-1 7 8-11h-6l1-7Z",
  "icon-archive": "M3 5h18v4H3Z M5 9v10h14V9 M10 13h4",
  "icon-search":
    "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13 M15.5 15.5 20 20",
  "icon-api":
    "M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1 M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1",
  "icon-mail": "M3 6h18v12H3Z M3 7l9 6 9-6",
  "icon-bell": "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4Z M10 20a2 2 0 0 0 4 0",
  "icon-link":
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  "icon-key": "M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M12 11h9 M18 11v3 M21 11v2",
  "icon-lock": "M6 11h12v9H6Z M8 11V8a4 4 0 0 1 8 0v3",
  "icon-card": "M3 6h18v12H3Z M3 10h18 M7 15h3",
  "icon-phone": "M7 3h10v18H7Z M11 18h2",
  "icon-browser": "M3 5h18v14H3Z M3 9h18 M6 7h.01 M9 7h.01",
  "icon-log": "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
  "icon-gear":
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9 7 7 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1",
  "icon-user": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M5 20a7 7 0 0 1 14 0",
} as const;
export const NODE_ICONS = [
  { id: "server", label: "サーバー" },
  { id: "cpu", label: "処理" },
  { id: "clock", label: "バッチ" },
  { id: "queue", label: "キュー" },
  { id: "bolt", label: "キャッシュ" },
  { id: "archive", label: "ストレージ" },
  { id: "search", label: "検索" },
  { id: "api", label: "API" },
  { id: "mail", label: "メール" },
  { id: "bell", label: "通知" },
  { id: "link", label: "Webhook" },
  { id: "key", label: "認証" },
  { id: "lock", label: "セキュリティ" },
  { id: "card", label: "決済" },
  { id: "phone", label: "スマホ" },
  { id: "browser", label: "ブラウザ" },
  { id: "log", label: "ログ" },
  { id: "gear", label: "設定" },
  { id: "user", label: "人" },
] as const;
export const iconPath = (id: string) =>
  ICON_PATHS[("icon-" + id) as keyof typeof ICON_PATHS];
const paths = {
  box: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  ellipse: "M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0Z",
  diamond: "m12 2 10 10-10 10L2 12Z",
  cylinder: "M4 6a8 3 0 0 1 16 0v12a8 3 0 0 1-16 0Z M4 6a8 3 0 0 0 16 0",
  note: "M6 3h9l4 4v14H6Z M14 3v5h5 M9 12h7 M9 16h7",
  connect: "M4 18h5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h5 M16 2l4 4-4 4",
  group: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
  select: "m5 3 14 9-7 1-4 7Z",
  pan: "M6 12V7a2 2 0 0 1 4 0v4-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v6a7 7 0 0 1-7 7h-2c-3 0-4-2-5-4l-4-5a2 2 0 0 1 2-3l4 4",
  undo: "m9 5-5 5 5 5 M4 10h10a6 6 0 0 1 6 6v3",
  redo: "m15 5 5 5-5 5 M20 10H10a6 6 0 0 0-6 6v3",
  trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  duplicate: "M8 8h12v12H8Z M4 16V4h12",
  close: "m6 6 12 12 M6 18 18 6",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  text: "M5 7V5h14v2 M12 5v14 M9 19h6",
  more: "M6 12h.01 M12 12h.01 M18 12h.01",
  label: "M4 7h11l5 5-5 5H4Z",
  dashed: "M3 12h3 M10 12h4 M18 12h3",
  swap: "M4 9h14 M14 5l4 4-4 4 M20 15H6 M10 11l-4 4 4 4",
  fit: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8Z",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M9 8a3 3 0 0 1 6 0c0 3-3 2-3 6 M12 17v1",
  arrow: "M4 12h16 M15 7l5 5-5 5",
  arrange: "M3 4h7v5H3Z M14 4h7v5h-7Z M3 15h7v5H3Z M14 15h7v5h-7Z",
  person:
    "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M12 8v7 M7 11h10 M12 15l-4 6 M12 15l4 6",
  cloud: "M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.5A4 4 0 0 1 17 18Z",
  screen: "M3 4h18v16H3Z M3 8h18",
  document: "M6 3h9l4 4v14H6Z M15 3v4h4",
  shapes:
    "M4 4h7v7H4Z M17.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7 M4 20l3.5-6 3.5 6Z M14 14h7v6h-7Z",
  ...ICON_PATHS,
} as const;
export function NodeIcon({ id }: { id: string }) {
  const d = iconPath(id);
  if (!d) return null;
  return (
    <svg
      className="node-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
