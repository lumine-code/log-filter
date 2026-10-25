describe("Log Filter short timestamp ranges", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, editor;
  beforeEach(async () => {
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    await lumine.packages.activatePackage("language-log");
    main = (await lumine.packages.activatePackage("log-filter")).mainModule;
    editor = await lumine.workspace.open("owned-short.log");
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("log-filter");
  });
  for (const trailing of ["", "\n"]) {
    it(`shows both ends of a single log entry with ${trailing ? "a trailing newline" : "no newline"}`, async () => {
      editor.setText("2026-01-01 10:00:00 INFO single entry" + trailing);
      await editor.languageMode.ready;
      await editor.getBuffer().getLanguageMode().atTransactionEnd();
      main.showPanel(editor);
      await main.view.updateTimestamps();
      expect(main.view.timestamps.style.display).toBe("");
      expect(main.view.timestampStart.textContent).toBe("01-01-2026 10:00:00");
      expect(main.view.timestampEnd.textContent).toBe("01-01-2026 10:00:00");
    });
  }
  it("keeps an explicit local year 2001 in the displayed range", async () => {
    editor.setText("2001-03-04 05:06:07 INFO first\n2001-03-04 05:06:08 INFO last");
    await editor.languageMode.ready;
    await editor.getBuffer().getLanguageMode().atTransactionEnd();
    main.showPanel(editor);
    await main.view.updateTimestamps();
    expect(main.view.timestampStart.textContent).toBe("04-03-2001 05:06:07");
    expect(main.view.timestampEnd.textContent).toBe("04-03-2001 05:06:08");
  });
});
