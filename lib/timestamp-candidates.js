const { contentEnd } = require("./text-matches");
const PATTERN =
  /(?:\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\b\d{6}[-\s]\d{6}(?:\.\d+)?)/i;

module.exports = function timestampCandidates(editor, rows, { signal } = {}) {
  const buffer = editor.getBuffer(),
    revision = buffer.getTextRevision();
  const source = buffer.getTextSnapshot(),
    result = [];
  let units = 0;
  for (const row of rows)
    if (row >= 0 && row < source.lineCount)
      units += contentEnd(source, row) - source.lineStart(row);
  const check = () => {
    signal?.throwIfAborted();
    if (editor.isDestroyed?.() || buffer.getTextRevision() !== revision)
      throw Object.assign(new Error("Timestamp source changed"), { name: "AbortError" });
  };
  function* steps() {
    for (const row of rows) {
      const candidates = [];
      result.push(candidates);
      if (row < 0 || row >= source.lineCount) continue;
      for (let column = 0; column <= 30; column += 10) {
        yield;
        const range = editor.bufferRangeForScopeAtPosition("timestamp", { row, column });
        if (!range) continue;
        const start = source.offsetAt(range.start),
          end = source.offsetAt(range.end);
        if (end - start <= 256) candidates.push(source.slice(start, end));
      }
      const first = source.lineStart(row),
        last = contentEnd(source, row);
      for (let offset = first; offset < last; offset += 32768) {
        yield;
        const boundary = Math.min(last, offset + 32768),
          start = Math.max(first, offset - 1);
        const text = source.slice(start, Math.min(last, boundary + 256));
        const match = PATTERN.exec(text);
        if (!match || start + match.index >= boundary) continue;
        if (match[0].length <= 256) candidates.push(match[0]);
        break;
      }
    }
  }
  const iterator = steps();
  const step = () => {
    check();
    return iterator.next();
  };
  if (units <= 32768) {
    while (!step().done) {
      /* bounded synchronous compatibility */
    }
    return result;
  }
  return (async () => {
    await new Promise((resolve) => setImmediate(resolve));
    let deadline = performance.now() + 4;
    while (!step().done)
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    return result;
  })();
};
