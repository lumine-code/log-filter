const Filter = require("../lib/filter");
const { formatTimestamp } = require("../lib/util");

const LINES = [
  "2026-01-01 10:00:00 INFO server started",
  "2026-01-01 10:00:01 WARNING disk almost full",
  "2026-01-01 10:00:02 ERROR connection lost",
  "2026-01-01 10:00:03 INFO retrying",
  "2026-01-01 10:00:04 ERROR gave up",
];

describe("log-filter", () => {
  let workspaceElement, mainModule, editor;

  const getPanel = () =>
    lumine.workspace.getBottomPanels().find((panel) => panel.className === "log-filter-panel");

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    await lumine.packages.activatePackage("language-log");

    const pack = await lumine.packages.activatePackage("log-filter");
    mainModule = pack.mainModule;

    editor = await lumine.workspace.open("sample.log");
    editor.setText(LINES.join("\n"));
    await editor.languageMode.ready;
    await editor.getBuffer().getLanguageMode().atTransactionEnd();
  });

  describe("the filter engine", () => {
    let filter;

    beforeEach(() => {
      filter = new Filter(editor);
    });

    afterEach(() => filter.destroy());

    it("hides the lines a query does not match", () => {
      filter.filterText("ERROR");
      expect(filter.getHiddenRows()).toEqual([0, 1, 3]);
    });

    it("matches the query literally unless regex mode is enabled", () => {
      filter.filterText("10:00:0.");
      expect(filter.getHiddenRows()).toEqual([0, 1, 2, 3, 4]);

      filter.setRegexEnabled(true);
      filter.filterText("10:00:0.");
      expect(filter.getHiddenRows()).toEqual([]);
    });

    it("ignores case until case sensitivity is enabled", () => {
      filter.filterText("error");
      expect(filter.getHiddenRows()).toEqual([0, 1, 3]);

      filter.setCaseInsensitive(false);
      filter.filterText("error");
      expect(filter.getHiddenRows()).toEqual([0, 1, 2, 3, 4]);
    });

    it("warns instead of throwing on an invalid regex", () => {
      spyOn(lumine.notifications, "addWarning");
      filter.setRegexEnabled(true);
      filter.filterText("([unclosed");

      expect(lumine.notifications.addWarning).toHaveBeenCalled();
      expect(filter.getHiddenRows()).toEqual([]);
    });

    it("keeps the configured number of lines around each match visible", () => {
      lumine.config.set("log-filter.adjacentLines", 1);
      filter.filterText("ERROR");
      // Rows 1 and 3 neighbour a match, row 0 does not.
      expect(filter.getHiddenRows()).toEqual([0]);

      lumine.config.set("log-filter.adjacentLines", 2);
      filter.filterText("ERROR");
      expect(filter.getHiddenRows()).toEqual([]);
    });

    it("hides the lines carrying a filtered severity scope", () => {
      filter.filterLevels(["keyword.other.log.log-error"]);
      expect(filter.getHiddenRows()).toEqual([2, 4]);

      filter.filterLevels(["keyword.other.log.log-info", "keyword.other.log.log-warning"]);
      expect(filter.getHiddenRows()).toEqual([0, 1, 3]);
    });

    it("merges the rows hidden by the query and by the severities", () => {
      filter.filterText("ERROR");
      filter.filterLevels(["keyword.other.log.log-error"]);
      expect(filter.getHiddenRows()).toEqual([0, 1, 2, 3, 4]);
      expect(filter.getHiddenCount()).toBe(5);
    });

    it("folds the hidden rows away and restores them when the query is cleared", () => {
      expect(editor.getScreenLineCount()).toBe(5);

      filter.filterText("ERROR");
      // Rows 0-1 collapse into one screen row, row 3 folds into row 2.
      expect(editor.getScreenLineCount()).toBe(3);

      filter.filterText("");
      expect(editor.getScreenLineCount()).toBe(5);
    });

    it("anchors the fold between the lines when configured to", () => {
      lumine.config.set("log-filter.foldPosition", "between-lines");
      filter.filterText("ERROR");

      // Row 3 now folds onto itself instead of onto row 2, so it keeps its own
      // screen row and only its text is collapsed.
      expect(editor.getScreenLineCount()).toBe(4);
      expect(editor.lineTextForScreenRow(1)).toBe(LINES[2]);
    });
  });

  describe("the panel", () => {
    it("tolerates package teardown while the grammar changes", () => {
      spyOn(lumine.config, "get").and.returnValue(undefined);

      expect(() => mainModule.isLogEditor(editor)).not.toThrow();
      expect(mainModule.isLogEditor(editor)).toBe(false);
    });

    it("opens for a log grammar and closes again on toggle", () => {
      expect(getPanel()).toBeTruthy();

      lumine.commands.dispatch(workspaceElement, "log-filter:toggle");
      expect(getPanel()).toBeFalsy();

      lumine.commands.dispatch(workspaceElement, "log-filter:toggle");
      expect(getPanel()).toBeTruthy();
    });

    it("does not open on its own for other grammars", async () => {
      const plain = await lumine.workspace.open("notes.txt");
      expect(plain.getGrammar().scopeName).not.toBe("source.log");
      expect(getPanel()).toBeFalsy();

      // ...but the command still opens it, without the severity buttons.
      lumine.commands.dispatch(workspaceElement, "log-filter:toggle");
      expect(getPanel()).toBeTruthy();
      expect(mainModule.view.levelButtonGroup.style.display).toBe("none");
    });

    it("stays closed when the automatic panel is disabled", async () => {
      lumine.config.set("log-filter.autoShow", false);
      expect(getPanel()).toBeFalsy();

      const other = await lumine.workspace.open("other.log");
      other.setText(LINES.join("\n"));
      expect(getPanel()).toBeFalsy();
    });

    it("filters the editor when the query is confirmed", () => {
      const view = mainModule.view;
      view.filterBuffer.setText("ERROR");
      lumine.commands.dispatch(view.filterEditorElement, "core:confirm");

      expect(editor.getScreenLineCount()).toBe(3);
      expect(view.descriptionLabel.textContent).toBe("Showing 2 of 5 log lines");
    });

    it("filters the editor when a severity button is clicked", () => {
      const view = mainModule.view;
      view.levelButtons.get("error").click();

      expect(editor.getScreenLineCount()).toBe(3);
      expect(view.levelButtons.get("error").classList.contains("selected")).toBe(true);
    });

    it("restores every line when the panel is closed", () => {
      const view = mainModule.view;
      view.filterBuffer.setText("ERROR");
      lumine.commands.dispatch(view.filterEditorElement, "core:confirm");
      expect(editor.getScreenLineCount()).toBe(3);

      view.closeButton.click();
      expect(getPanel()).toBeFalsy();
      expect(editor.getScreenLineCount()).toBe(5);
    });

    it("reapplies the filter of an editor it is reopened on", () => {
      const view = mainModule.view;
      view.filterBuffer.setText("ERROR");
      lumine.commands.dispatch(view.filterEditorElement, "core:confirm");
      // The state is stored when the filter input settles.
      advanceClock(1000);

      lumine.commands.dispatch(workspaceElement, "log-filter:toggle");
      expect(editor.getScreenLineCount()).toBe(5);

      lumine.commands.dispatch(workspaceElement, "log-filter:toggle");
      expect(mainModule.view.filterBuffer.getText()).toBe("ERROR");
      expect(editor.getScreenLineCount()).toBe(3);
    });

    it("closes when the editor it filters is destroyed", () => {
      editor.destroy();
      expect(getPanel()).toBeFalsy();
      expect(mainModule.view).toBeNull();
    });
  });

  describe("timestamps", () => {
    it("formats timestamps as DD-MM-YYYY HH:mm:ss", () => {
      expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("02-01-2026 03:04:05");
    });

    it("parses ISO-like timestamps", () => {
      const filter = new Filter(editor);
      const time = filter.parseTimestamp("2026-03-04 05:06:07");

      expect(time instanceof Date).toBe(true);
      expect(time.getFullYear()).toBe(2026);
      expect(time.getMonth()).toBe(2);
      expect(time.getDate()).toBe(4);
      filter.destroy();
    });

    it("assumes the current year for year-less timestamps", () => {
      const filter = new Filter(editor);
      const time = filter.parseTimestamp("Dec 25 13:00:00");

      expect(time instanceof Date).toBe(true);
      expect(time.getFullYear()).toBe(new Date().getFullYear());
      filter.destroy();
    });

    it("rejects unparsable timestamps", () => {
      const filter = new Filter(editor);
      expect(filter.parseTimestamp("not a timestamp")).toBe(false);
      filter.destroy();
    });
  });
});
