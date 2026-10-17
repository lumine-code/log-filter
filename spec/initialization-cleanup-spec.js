describe("log-filter recovery bootstrap", () => {
  it("unloads after external initialization before activation", async () => {
    if (lumine.packages.isPackageLoaded("log-filter"))
      await lumine.packages.unloadPackage("log-filter", { serialize: false });
    const pack = lumine.packages.loadPackage("log-filter");
    pack.requireMainModule();
    pack.initializeForExternalUse("workspace restoration");
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivated).toBe(false);
    await expectAsync(
      lumine.packages.unloadPackage("log-filter", { serialize: false }),
    ).toBeResolved();
  });
});
