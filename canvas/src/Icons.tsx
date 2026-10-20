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
  fit: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8Z",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M9 8a3 3 0 0 1 6 0c0 3-3 2-3 6 M12 17v1",
  arrow: "M4 12h16 M15 7l5 5-5 5",
  arrange: "M3 4h7v5H3Z M14 4h7v5h-7Z M3 15h7v5H3Z M14 15h7v5h-7Z",
} as const;
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
