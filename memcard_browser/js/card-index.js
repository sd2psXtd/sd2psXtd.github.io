export function buildCardIndex(parser) {
  const summary = parser.getSummary();
  const rootCluster = summary.rootDirCluster;
  const files = new Map();
  const dirs = new Set(["/"]);
  const entries = [];
  const queue = [{
    clusterRel: rootCluster,
    path: "/",
    stack: [{ name: "", clusterRel: rootCluster }],
  }];
  const seenDirs = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (seenDirs.has(cur.clusterRel)) continue;
    seenDirs.add(cur.clusterRel);

    let children = [];
    try {
      children = parser.parseDirectory(cur.clusterRel, false);
    } catch (_) {
      continue;
    }

    for (const entry of children) {
      const fullPath = `${cur.path}${entry.name}`;
      entries.push({
        ...entry,
        path: fullPath,
        parentClusterRel: cur.clusterRel,
        parentStack: cur.stack,
      });
      if (entry.type === "file") {
        files.set(fullPath, entry.length);
      } else if (entry.type === "directory") {
        const dirPath = `${fullPath}/`;
        dirs.add(dirPath);
        queue.push({
          clusterRel: entry.clusterRel,
          path: dirPath,
          stack: [...cur.stack, {
            name: entry.name,
            clusterRel: entry.clusterRel,
          }],
        });
      }
    }
  }

  return {
    files,
    dirs,
    usage: summary.usage,
    entries,
  };
}

export function buildGlobalSearchEntries(index, query) {
  if (!index) return [];
  const q = String(query || "").toLowerCase();
  const out = [];
  for (const item of index.entries) {
    if (!item.name.toLowerCase().includes(q)) continue;
    out.push({
      ...item,
      name: item.path,
      targetName: item.name,
      isSearchResult: true,
    });
  }
  return out;
}

export function summarizeIndexChanges(baseIndex, currentIndex) {
  if (!baseIndex || !currentIndex) {
    return {
      addedFiles: 0,
      removedFiles: 0,
      addedDirs: 0,
      removedDirs: 0,
      usedDelta: 0,
    };
  }

  const baseFiles = baseIndex.files;
  const curFiles = currentIndex.files;
  const baseDirs = baseIndex.dirs;
  const curDirs = currentIndex.dirs;

  let addedFiles = 0;
  let removedFiles = 0;
  let addedDirs = 0;
  let removedDirs = 0;

  for (const key of curFiles.keys()) {
    if (!baseFiles.has(key)) addedFiles += 1;
  }
  for (const key of baseFiles.keys()) {
    if (!curFiles.has(key)) removedFiles += 1;
  }
  for (const key of curDirs.keys()) {
    if (!baseDirs.has(key)) addedDirs += 1;
  }
  for (const key of baseDirs.keys()) {
    if (!curDirs.has(key)) removedDirs += 1;
  }

  return {
    addedFiles,
    removedFiles,
    addedDirs,
    removedDirs,
    usedDelta: currentIndex.usage.usedBytes - baseIndex.usage.usedBytes,
  };
}
