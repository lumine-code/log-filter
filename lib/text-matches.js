const RowRanges = require("./row-ranges");
const WINDOW = 32768;
const ROW_LIMIT = 1024 * 1024;

function contentEnd(source, row) {
  let end = row + 1 < source.lineCount ? source.lineStart(row + 1) - 1 : source.length;
  if (
    row + 1 < source.lineCount &&
    end > source.lineStart(row) &&
    source.charCodeAt(end - 1) === 13
  )
    end--;
  return end;
}

function literalRows(source, expression, query, adjacent, check) {
  const visible = new RowRanges();
  if (query.includes("\n")) return visible;
  function* steps() {
    for (let offset = 0; offset < source.length;) {
      yield;
      const boundary = Math.min(source.length, offset + WINDOW);
      const text = source.slice(offset, Math.min(source.length, boundary + query.length - 1));
      const match = expression.exec(text);
      if (!match) {
        offset = boundary;
        continue;
      }
      const start = offset + match.index;
      const row = source.positionAt(start).row;
      if (start + match[0].length <= contentEnd(source, row))
        visible.add(Math.max(0, row - adjacent), Math.min(source.lineCount - 1, row + adjacent));
      offset = row + 1 < source.lineCount ? source.lineStart(row + 1) : source.length;
    }
  }
  const iterator = steps();
  const step = () => {
    check();
    return iterator.next();
  };
  if (source.length <= WINDOW) {
    while (!step().done) {
      /* bounded fast path */
    }
    return visible;
  }
  return (async () => {
    await new Promise((resolve) => setImmediate(resolve));
    let deadline = performance.now() + 4;
    while (!step().done)
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    return visible;
  })();
}

async function regexRows(source, expression, adjacent, check, signal) {
  const RegexWorker = require("./regex-worker-client");
  const worker = new RegexWorker(signal),
    visible = new RowRanges();
  try {
    if (source.length === source.lineCount - 1) {
      const matches = await worker.request({
        source: expression.source,
        flags: expression.flags,
        rows: [""],
      });
      check();
      if (matches[0]) visible.add(0, source.lineCount - 1);
      return visible;
    }
    let row = 0;
    while (row < source.lineCount) {
      check();
      const first = row,
        rows = [];
      let units = 0;
      while (row < source.lineCount && rows.length < 1024) {
        const start = source.lineStart(row),
          end = contentEnd(source, row),
          length = end - start;
        if (length > ROW_LIMIT)
          throw new Error(
            "A log row exceeds the 1 Mi UTF-16 regular-expression input budget. Use literal filtering for giant rows.",
          );
        if (rows.length && units + length > ROW_LIMIT) break;
        rows.push(source.slice(start, end));
        units += length;
        row++;
      }
      const matches = await worker.request({
        source: expression.source,
        flags: expression.flags,
        rows,
      });
      check();
      if (matches.length !== rows.length) throw new Error("Incomplete log filter response");
      for (let index = 0; index < matches.length; index++)
        if (matches[index])
          visible.add(
            Math.max(0, first + index - adjacent),
            Math.min(source.lineCount - 1, first + index + adjacent),
          );
    }
    return visible;
  } finally {
    worker.dispose();
  }
}

module.exports = { literalRows, regexRows, contentEnd };
