import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isCompletedDownload, openTargetFolder } = require("../desktop/downloads.cjs") as {
  isCompletedDownload: (state: string) => boolean;
  openTargetFolder: (
    openPath: (folderPath: string) => Promise<string>,
    folderPath: string,
  ) => Promise<void>;
};

test("only completed downloads unlock the target-folder action", () => {
  assert.equal(isCompletedDownload("completed"), true);
  assert.equal(isCompletedDownload("cancelled"), false);
  assert.equal(isCompletedDownload("interrupted"), false);
});

test("opens the configured target folder", async () => {
  const opened: string[] = [];

  await openTargetFolder(async (folderPath) => {
    opened.push(folderPath);
    return "";
  }, "C:\\Users\\changtaolei\\Downloads");

  assert.deepEqual(opened, ["C:\\Users\\changtaolei\\Downloads"]);
});

test("reports native folder-opening errors", async () => {
  await assert.rejects(
    openTargetFolder(async () => "The folder could not be opened.", "C:\\Downloads"),
    /The folder could not be opened\./,
  );
});
