const { Emitter, Point } = require("atom");

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
    this.hiddenRows = { text: [], levels: [] };
    this.caseInsensitive = true;
    this.regexEnabled = false;
  }

  destroy() {
    this.unfold();
    this.emitter.dispose();
  }

  onDidFinishFilter(callback) {
    return this.emitter.on("did-finish-filter", callback);
  }

  setCaseInsensitive(caseInsensitive) {
    this.caseInsensitive = caseInsensitive;
  }

  setRegexEnabled(regexEnabled) {
    this.regexEnabled = regexEnabled;
  }

  getHiddenRows() {
    const { text, levels } = this.hiddenRows;
    if (levels.length === 0) return text;
    if (text.length === 0) return levels;
    return [...new Set([...text, ...levels])].sort((a, b) => a - b);
  }

  getHiddenCount() {
    return this.getHiddenRows().length;
  }

  filterText(query) {
    if (query.length === 0) {
      this.hiddenRows.text = [];
      return this.refold();
    }

    const regex = this.getRegexFromText(query);
    if (!regex) return;

    const lines = this.textEditor.getBuffer().getLines();
    const rows = [];
    for (let row = 0; row < lines.length; row++) {
      if (!regex.test(lines[row])) rows.push(row);
    }

    this.hiddenRows.text = this.keepAdjacentLines(rows);
    return this.refold();
  }

  filterLevels(scopes) {
    if (scopes.length === 0) {
      this.hiddenRows.levels = [];
      return this.refold();
    }

    const grammar = this.textEditor.getGrammar();
    const lines = this.textEditor.getBuffer().getLines();
    const rows = [];
    for (let row = 0; row < lines.length; row++) {
      if (this.lineHasScope(grammar.tokenizeLine(lines[row]), scopes)) rows.push(row);
    }

    this.hiddenRows.levels = rows;
    return this.refold();
  }

  // `rows` are the lines the query did not match. A line stays visible when a
  // match sits within `adjacentLines` of it, so the surrounding context of every
  // match is kept.
  keepAdjacentLines(rows) {
    const adjacent = atom.config.get("log-filter.adjacentLines");
    if (!adjacent || rows.length === 0) return rows;

    const unmatched = new Set(rows);
    const lastRow = this.textEditor.getLastBufferRow();
    return rows.filter((row) => {
      for (let offset = -adjacent; offset <= adjacent; offset++) {
        const neighbour = row + offset;
        if (offset === 0 || neighbour < 0 || neighbour > lastRow) continue;
        // A neighbour missing from the set matched the query, so this row is
        // context around a match and stays visible.
        if (!unmatched.has(neighbour)) return false;
      }
      return true;
    });
  }

  lineHasScope(tokenized, scopes) {
    // Only TextMate grammars report per-token scopes here; with any other engine
    // the severity buttons simply match nothing.
    if (tokenized == null || tokenized.tags == null || tokenized.registry == null) return false;
    for (const tag of tokenized.tags) {
      const scope = tokenized.registry.scopeForId(tag);
      if (scope && scopes.includes(scope)) return true;
    }
    return false;
  }

  refold() {
    this.unfold();

    const rows = this.getHiddenRows();
    let start = null;
    let previous = null;
    for (const row of rows) {
      if (start === null) {
        start = row;
      } else if (row !== previous + 1) {
        this.foldRows(start, previous);
        start = row;
      }
      previous = row;
    }
    if (start !== null) this.foldRows(start, previous);

    return this.emitter.emit("did-finish-filter");
  }

  foldRows(startRow, endRow) {
    const buffer = this.textEditor.getBuffer();
    let foldStart = [startRow, 0];

    // Anchoring the fold at the end of the preceding line keeps the fold marker
    // on a visible line instead of pushing a blank row between the neighbours.
    if (atom.config.get("log-filter.foldPosition") === "end-of-line" && startRow > 0) {
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
      atom.notifications.addWarning("Log Filter", { detail: "Invalid filter regex" });
      return null;
    }
  }

  getFirstTimestamp() {
    return this.getRowTimestamp(0);
  }

  getLastTimestamp() {
    for (let offset = 1; offset <= 3; offset++) {
      const row = this.textEditor.getLineCount() - offset;
      if (row <= 0) return;

      const timestamp = this.getRowTimestamp(row);
      if (timestamp) return timestamp;
    }
  }

  getRowTimestamp(row) {
    for (let column = 0; column <= 30; column += 10) {
      const range = this.textEditor.bufferRangeForScopeAtPosition(
        "timestamp",
        new Point(row, column),
      );

      let timestamp;
      if (range && (timestamp = this.textEditor.getTextInRange(range))) {
        return this.parseTimestamp(timestamp);
      }
    }
  }

  parseTimestamp(timestamp) {
    const regexes = [/^\d{6}[-\s]/, /[0-9]{4}:[0-9]{2}/, /[0-9]T[0-9]/];

    timestamp = timestamp.replace(/[[\]]?/g, "");
    timestamp = timestamp.replace(/,/g, ".");
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
    if (time.getFullYear() === 2001) {
      time.setFullYear(new Date().getFullYear());
    }
    return time;
  }
}

module.exports = Filter;
