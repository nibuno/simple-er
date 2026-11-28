const charWidth = (char: string, size: number) =>
  char.codePointAt(0)! > 255 ? size : size * 0.61;

export function textWidth(text: string, size: number) {
  let width = 0;
  for (const char of text) width += charWidth(char, size);
  return width;
}

// Opening brackets stay with what follows. Closing punctuation and small
// kana stay with what precedes them, even in a run such as 「えっ！」.
const noLineEnd = new Set("（〔［｛〈《「『【〖〘〚([{｟｢“‘");
const noLineStart = new Set(
  "、。，．・：；？！ー々〻ゝゞヽヾ゛゜）〕］｝〉》」』】〗〙〛｠､｡･｣,.!?;:)]}”’" +
    "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿｧｨｩｪｫｯｬｭｮｰﾞﾟ",
);

export function wrapText(text: string, width: number, size: number): string[] {
  return text.split("\n").flatMap((line) => {
    const chars = Array.from(line);
    const rows: string[] = [];
    let rowStart = 0,
      rowWidth = 0;
    for (let i = 0; i < chars.length;) {
      const start = i;
      let unitWidth = 0;
      // Keep a unit intact even when the column is narrower than the unit.
      do {
        unitWidth += charWidth(chars[i++], size);
      } while (
        i < chars.length &&
        (noLineEnd.has(chars[i - 1]) || noLineStart.has(chars[i]))
      );
      if (start > rowStart && rowWidth + unitWidth > width) {
        rows.push(chars.slice(rowStart, start).join(""));
        rowStart = start;
        rowWidth = 0;
      }
      rowWidth += unitWidth;
    }
    rows.push(chars.slice(rowStart).join(""));
    return rows;
  });
}
