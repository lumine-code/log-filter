describe("Log Filter write completion ownership", () => {
  it("does not restore a retired write over a replacement activation's draft", async () => {
    lumine.config.set("log-filter.autoShow", true);
    await lumine.packages.activatePackage("language-log");
    let main = (await lumine.packages.activatePackage("log-filter")).mainModule;
    const editor = await lumine.workspace.open("sample.log");
    await editor.languageMode.ready;
    const view = main.view;
    const store = main.workspaceState;
    const mutate = store.mutate.bind(store);
    let release;
    let didCommit;
    const committed = new Promise((resolve) => (didCommit = resolve));
    spyOn(store, "mutate").and.callFake((...args) =>
      mutate(...args).then(
        (value) =>
          new Promise((resolve) => {
            release = () => resolve(value);
            didCommit();
          }),
      ),
    );
    view.filterBuffer.setText("ERROR");
    const saving = view.saveState();
    await committed;
    try {
      await lumine.packages.deactivatePackage("log-filter");
      main = (await lumine.packages.activatePackage("log-filter")).mainModule;
      const replacement = main.view;
      expect(replacement).not.toBe(view);
      replacement.filterBuffer.setText("new activation draft");
      const restore = spyOn(replacement, "restoreState").and.callThrough();
      release();
      await saving;

      expect(replacement.filterBuffer.getText()).toBe("new activation draft");
      expect(restore).not.toHaveBeenCalled();
    } finally {
      release();
      await saving;
      await lumine.packages.deactivatePackage("log-filter");
    }
  });
});
