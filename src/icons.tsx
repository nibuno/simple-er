/** Stroke icons drawn on a 16px grid; size follows the surrounding font. */
const paths = {
  plus: "M8 3v10M3 8h10",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1",
  tidy: "M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z",
  table:
    "M2.5 3h11a.5.5 0 01.5.5v9a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5zM2 6.5h12M6 6.5V13",
  close: "M4 4l8 8M12 4l-8 8",
  fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  minus: "M3.5 8h9",
  search: "M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.3 10.3L14 14",
  copy: "M5.5 5.5h8v8h-8zM3 10.5v-8h8",
  more: "",
  external: "M9.5 2.5h4v4M13.5 2.5L8 8M6.5 3.5h-3v9h9v-3",
  check: "M3 8.5l3 3 7-7",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "more" ? (
        <g fill="currentColor" stroke="none">
          <circle cx="3.5" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="12.5" cy="8" r="1.2" />
        </g>
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}
export function Logo() {
  return (
    <svg
      className="logo-mark"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="2.5" width="8" height="6" rx="1.5" fill="currentColor" />
      <rect
        x="10.5"
        y="11.5"
        width="8"
        height="6"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5.5 8.5v5.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
