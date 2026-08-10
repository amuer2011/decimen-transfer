function isCompletedDownload(state) {
  return state === "completed";
}

async function openTargetFolder(openPath, folderPath) {
  const error = await openPath(folderPath);
  if (error) throw new Error(error);
}

module.exports = { isCompletedDownload, openTargetFolder };
