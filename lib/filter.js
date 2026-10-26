const { Emitter, CompositeDisposable } = require("lumine");
const RowRanges = require("./row-ranges");
const { literalRows, regexRows } = require("./text-matches");

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Hides lines by folding them away: every row that fails the active filters is
// collected, consecutive rows are merged into ranges, and each range is folded.
class Filter {
  constructor(textEditor) {
    this.textEditor = textEditor;
    this.emitter = new Emitter();

    // Rows hidden by the text query and by the severity buttons, kept apart so
    // either filter can be recomputed without rerunning the other.
    this.hiddenRows = { text: new RowRanges(), levels: new RowRanges() };
    this.work = new Set();
    this.reportedFailures = new Map();
    this.errors = new Map();
    this.subscriptions = new CompositeDisposable(
      textEditor.getBuffer().onDidChangeText(() => {
        this.textController?.abort();
        this.levelController?.abort();
        this.foldGeneration = (this.foldGeneration ?? 0) + 1;
        this.hiddenRows = { text: new RowRanges(), levels: new RowRanges() };
        this.textRevision = this.levelRevision = null;
        this.work.clear();
        this.unfold();
        this.emitter.emit("did-finish-filter");
      }),
      textEditor.onDidStopChanging(() => {
        const revision = textEditor.getBuffer().getTextRevision();
        if (this.lastQuery && this.textRevision !== revision) this.filterText(this.lastQuery);
        if (this.lastScopes?.length && this.levelRevision !== revision)
          this.filterLevels(this.lastScopes);
      }),
    );
    this.caseInsensitive = true;
    this.regexEnabled = false;
  }

  destroy() {
    this.destroyed = true;
    this.textController?.abort();
    this.levelController?.abort();
    this.timestampController?.abort();
    this.foldGeneration = (this.foldGeneration ?? 0) + 1;
    this.subscriptions.dispose();
    this.unfold();
    this.emitter.dispose();
  }

  onDidFinishFilter(callback) {
    return this.emitter.on("did-finish-filter", callback);
  }

  setCaseInsensitive(caseInsensitive) {
    if (this.caseInsensitive !== caseInsensitive) this.textController?.abort();
    this.caseInsensitive = caseInsensitive;
  }

  setRegexEnabled(regexEnabled) {
    if (this.regexEnabled !== regexEnabled) this.textController?.abort();
    this.regexEnabled = regexEnabled;
  }

  onDidChangeStatus(callback) {
    return this.emitter.on("did-change-status", callback);
  }
  get status() {
    return [...this.errors.values()].join("; ") || null;
  }
  getHiddenRowRanges() {
    return this.hiddenRows.text.union(this.hiddenRows.levels).ranges.map((range) => range.slice());
  }
  getHiddenRows() {
    return this.hiddenRows.text.union(this.hiddenRows.levels).toArray();
  }
  getHiddenCount() {
    return this.hiddenRows.text.union(this.hiddenRows.levels).length;
  }
  setWorking(kind, working) {
    if (working) this.work.add(kind);
    else this.work.delete(kind);
    if (!this.destroyed) this.emitter.emit("did-change-status");
  }
  publish(kind, rows) {
    rows.union(this.hiddenRows[kind === "text" ? "levels" : "text"]);
    this.hiddenRows[kind] = rows;
    this.errors.delete(kind);
    this.reportedFailures.delete(kind);
    return this.refold();
  }
  failed(kind, error, controller) {
    if (this.destroyed || controller.signal.aborted) return false;
    this.hiddenRows[kind] = new RowRanges();
    this.errors.set(kind, error.message);
    const previous = this.reportedFailures.get(kind);
    const state = {
      message: error.message,
      query: this.lastQuery,
      regex: this.regexEnabled,
      scopes: this.lastScopes?.join("|"),
    };
    if (!previous || Object.keys(state).some((key) => previous[key] !== state[key])) {
      this.reportedFailures.set(kind, state);
      lumine.notifications.addWarning("Log Filter", { detail: error.message, dismissable: true });
    }
    this.refold();
    return false;
  }

  filterText(query) {
    this.textController?.abort();
    this.setWorking("text", false);
    const controller = (this.textController = new AbortController());
    this.lastQuery = query;
    this.textRevision = this.textEditor.getBuffer().getTextRevision();
    if (!query) {
      this.errors.delete("text");
      this.hiddenRows.text = new RowRanges();
      return this.refold();
    }
    if (query.length > 65536)
      return this.failed(
        "text",
        new Error("Filter queries are limited to 65536 UTF-16 units."),
        controller,
      );
    const expression = this.getRegexFromText(query);
    if (!expression) {
      this.hiddenRows.text = new RowRanges();
      return this.refold();
    }
    const buffer = this.textEditor.getBuffer(),
      revision = buffer.getTextRevision(),
      source = buffer.getTextSnapshot();
    const check = () => {
      controller.signal.throwIfAborted();
      if (
        this.destroyed ||
        buffer.getTextRevision() !== revision ||
        this.textController !== controller
      )
        throw Object.assign(new Error("Log filter superseded"), { name: "AbortError" });
    };
    const adjacent = Math.max(0, lumine.config.get("log-filter.adjacentLines") || 0);
    const finish = (visible) => {
      check();
      return this.publish("text", visible.complement(source.lineCount));
    };
    this.errors.delete("text");
    try {
      const result = this.regexEnabled
        ? regexRows(source, expression, adjacent, check, controller.signal)
        : literalRows(source, expression, query, adjacent, check);
      if (!result?.then) return finish(result);
      this.setWorking("text", true);
      return result
        .then(finish)
        .catch((error) => this.failed("text", error, controller))
        .finally(() => {
          if (this.textController === controller) this.setWorking("text", false);
        });
    } catch (error) {
      return this.failed("text", error, controller);
    }
  }

  filterLevels(scopes) {
    this.levelController?.abort();
    this.setWorking("levels", false);
    const controller = (this.levelController = new AbortController());
    scopes = scopes.slice();
    this.lastScopes = scopes;
    this.levelRevision = this.textEditor.getBuffer().getTextRevision();
    if (!scopes.length) {
      this.errors.delete("levels");
      this.hiddenRows.levels = new RowRanges();
      return this.refold();
    }
    const rows = new RowRanges();
    this.setWorking("levels", true);
    return this.textEditor
      .analyzeSyntax(
        require.resolve("./syntax-analysis"),
        "levels",
        { scopes },
        {
          signal: controller.signal,
          onChunk: (packet) => {
            if (controller.signal.aborted || this.destroyed) return;
            for (const [start, end] of packet) rows.add(start, end);
          },
        },
      )
      .then((summary) => {
        if (controller.signal.aborted || this.destroyed) return;
        if (!summary) return this.publish("levels", new RowRanges());
        if (summary.count !== rows.length) throw new Error("Incomplete severity filter stream");
        return this.publish("levels", rows);
      })
      .catch((error) => this.failed("levels", error, controller))
      .finally(() => {
        if (this.levelController === controller) this.setWorking("levels", false);
      });
  }

  refold() {
    const ranges = this.getHiddenRowRanges();
    const generation = (this.foldGeneration = (this.foldGeneration ?? 0) + 1);
    this.setWorking("folds", false);
    this.unfold();
    if (ranges.length <= 128) {
      for (const [start, end] of ranges) this.foldRows(start, end);
      this.emitter.emit("did-finish-filter");
      return;
    }
    this.setWorking("folds", true);
    return (async () => {
      let deadline = performance.now() + 4;
      for (const [start, end] of ranges) {
        if (this.destroyed || this.foldGeneration !== generation) return;
        this.foldRows(start, end);
        if (performance.now() >= deadline) {
          await new Promise((resolve) => setImmediate(resolve));
          deadline = performance.now() + 4;
        }
      }
      if (this.foldGeneration === generation) this.emitter.emit("did-finish-filter");
    })().finally(() => {
      if (this.foldGeneration === generation) this.setWorking("folds", false);
    });
  }

  foldRows(startRow, endRow) {
    const buffer = this.textEditor.getBuffer();
    let foldStart = [startRow, 0];

    // Anchoring the fold at the end of the preceding line keeps the fold marker
    // on a visible line instead of pushing a blank row between the neighbours.
    if (lumine.config.get("log-filter.foldPosition") === "end-of-line" && startRow > 0) {
      foldStart = [startRow - 1, buffer.lineLengthForRow(startRow - 1)];
    }

    this.textEditor.foldBufferRange([foldStart, [endRow, buffer.lineLengthForRow(endRow)]]);
  }

  // Folds are owned by the panel, so clearing them clears everything: a log
  // buffer is not a place where hand-made folds are expected to survive.
  unfold() {
    if (!this.textEditor.isDestroyed()) this.textEditor.unfoldAll();
  }

  getRegexFromText(text) {
    try {
      const pattern = this.regexEnabled ? text : escapeRegExp(text);
      return new RegExp(pattern, this.caseInsensitive ? "i" : "");
    } catch {
      lumine.notifications.addWarning("Log Filter", { detail: "Invalid filter regex" });
      return null;
    }
  }

  getFirstTimestamp() {
    return this.getRowTimestamp(0);
  }
  getLastTimestamp() {
    const result = this.getTimestamps();
    return result?.then ? result.then((value) => value?.end) : result?.end;
  }
  timestampRows(rows) {
    this.timestampController?.abort();
    const controller = (this.timestampController = new AbortController());
    const result = this.textEditor.getBuffer().getLanguageMode().asynchronousSyntax
      ? this.textEditor.analyzeSyntax(
          require.resolve("./syntax-analysis"),
          "timestamps",
          { rows },
          { signal: controller.signal },
        )
      : require("./timestamp-candidates")(this.textEditor, rows, { signal: controller.signal });
    const parse = (values) =>
      !values || controller.signal.aborted || this.destroyed
        ? null
        : values.map((candidates) =>
            candidates.map((value) => this.parseTimestamp(value)).find(Boolean),
          );
    return result?.then
      ? result.then(parse).catch((error) => {
          if (error.name === "AbortError") return null;
          throw error;
        })
      : parse(result);
  }
  getTimestamps() {
    const last = this.textEditor.getLastBufferRow();
    const result = this.timestampRows([0, last, last - 1, last - 2]);
    const finish = (values) =>
      values ? { start: values[0], end: values.slice(1).find(Boolean) } : null;
    return result?.then ? result.then(finish) : finish(result);
  }
  getRowTimestamp(row) {
    const result = this.timestampRows([row]);
    return result?.then ? result.then((values) => values?.[0]) : result?.[0];
  }

  parseTimestamp(timestamp) {
    const regexes = [/^\d{6}[-\s]/, /[0-9]{4}:[0-9]{2}/, /[0-9]T[0-9]/];
    const yearless =
      /^\[?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?\]?$/i.test(
        timestamp.trim(),
      );

    timestamp = timestamp.replace(/[[\]]?/g, "");
    timestamp = timestamp.replace(/,/g, ".");

    // An explicit zone identifies an instant. Normalize it to ISO before the
    // legacy local-time path strips suffixes or changes the date separator.
    const zoned = timestamp
      .trim()
      .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/i);
    if (zoned) {
      const zone = zoned[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2").toUpperCase();
      const time = new Date(`${zoned[1]}T${zoned[2]}${zone}`);
      return isNaN(time.getTime()) ? false : time;
    }

    timestamp = timestamp.replace(/([A-Za-z]*|[-+][0-9]{4}|[-+][0-9]{2}:[0-9]{2})$/, "");

    let part;
    const match = timestamp.match(regexes[0]);
    if ((part = match != null ? match[0] : undefined)) {
      part = `20${part.substr(0, 2)}-${part.substr(2, 2)}-${part.substr(4, 2)} `;
      timestamp = timestamp.replace(regexes[0], part);
    }
    if (timestamp.match(regexes[1])) {
      timestamp = timestamp.replace(":", " ");
    }

    if (timestamp.match(regexes[2])) {
      timestamp = timestamp.replace(/([0-9])T([0-9])/, "$1 $2");
    }

    if (timestamp.length < 8) {
      return false;
    }

    const time = new Date(timestamp);
    if (isNaN(time.getTime())) {
      return false;
    }
    // Date strings without a year (e.g. syslog "Dec 25 13:00") parse to 2001;
    // assume such timestamps belong to the current year.
    if (yearless && time.getFullYear() === 2001) {
      time.setFullYear(new Date().getFullYear());
    }
    return time;
  }
}

module.exports = Filter;
