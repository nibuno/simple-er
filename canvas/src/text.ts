export function textWidth(text: string, size: number) {
  return Array.from(text).reduce(
    (sum, char) => sum + (char.codePointAt(0)! > 255 ? size : size * 0.61),
    0,
  );
}
// Use the same wrapping estimate for sizes, routing labels and portable text.
export function wrapText(text: string, width: number, size: number): string[] {
  return text.split("\n").flatMap((line) => {
    const rows: string[] = [];
    let current = "",
      length = 0;
    for (const char of Array.from(line)) {
      const step = char.codePointAt(0)! > 255 ? size : size * 0.61;
      if (length + step > width && current) {
        rows.push(current);
        current = "";
        length = 0;
      }
      current += char;
      length += step;
    }
    rows.push(current);
    return rows;
  });
}
