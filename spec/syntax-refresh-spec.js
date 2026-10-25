const fs = require("node:fs");
const path = require("node:path");

describe("Log Filter timestamp refresh after worker edits", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let execution, editor, main, file;
  beforeEach(async () => {
    jasmine.useRealClock();
    execution = lumine.grammars.syntaxExecution;
    lumine.grammars.syntaxExecution = "worker";
    await lumine.packages.activatePackage("language-log");
    main = (await lumine.packages.activatePackage("log-filter")).mainModule;
    file = path.join(lumine.getConfigDirPath(), "owned-timestamp-refresh.log");
    fs.writeFileSync(file, "2026-01-01 10:00:00 INFO first\n2026-01-01 10:00:01 INFO last");
    editor = await lumine.workspace.open(file);
    await editor.whenGrammarSettled();
    main.showPanel(editor);
    await main.view.updateTimestamps();
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("log-filter");
    lumine.grammars.syntaxExecution = execution;
    if (file) fs.rmSync(file, { force: true });
  });

  for (const change of ["append", "external reload"])
    it(`refreshes the last timestamp after ${change} without another initial tokenization`, async () => {
      const view = main.view;
      expect(editor.getBuffer().getLanguageMode().asynchronousSyntax).toBeTrue();
      expect(view.timestampEnd.textContent).toBe("01-01-2026 10:00:01");
      const update = spyOn(view, "updateTimestamps").and.callThrough();
      let subscription;
      const stopped = new Promise((resolve) => {
        subscription = editor.onDidStopChanging(resolve);
      });
      try {
        if (change === "append") editor.getBuffer().append("\n2026-01-01 10:00:02 ERROR newest");
        else {
          fs.writeFileSync(
            file,
            "2026-01-01 10:00:00 INFO first\n2026-01-01 10:00:02 ERROR regenerated",
          );
          await editor.getBuffer().load({ internal: true });
        }
        await stopped;
        expect(update).toHaveBeenCalled();
        await update.calls.mostRecent()?.returnValue;
        expect(view.timestampEnd.textContent).toBe("01-01-2026 10:00:02");
      } finally {
        subscription.dispose();
      }
    });
});
