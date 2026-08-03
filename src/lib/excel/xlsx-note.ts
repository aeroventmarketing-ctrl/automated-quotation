/**
 * Hard-wrap a "Note / Remarks" string into display lines that each fit within
 * `perLine` characters, so the printed job order can allocate exactly one row per
 * line. Excel does NOT auto-fit the height of a merged cell, so relying on its own
 * word-wrap clips long notes; by breaking the text ourselves the row count is
 * exact and nothing is hidden. Wraps on spaces where possible and hard-splits an
 * over-long unbroken run (e.g. "ffffff…"); preserves the author's own line breaks.
 */
export function wrapNote(text: string, perLine: number): string[] {
  const width = Math.max(8, Math.floor(perLine));
  const lines: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (let w of words) {
      // A single word longer than the line width — emit full-width chunks.
      while (w.length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += " " + w;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}
