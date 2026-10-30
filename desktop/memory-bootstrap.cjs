'use strict';

// Opens the local memory + architecture stores, degrading to read-only when
// either data file is corrupt or unreadable. A corrupt file is never
// overwritten: the underlying stores throw before persisting, and this wrapper
// only reports the failure instead of aborting the whole app.

const { MemoryStore } = require('./memory-store.cjs');
const { ArchitectureStore } = require('./architecture-store.cjs');

function openMemoryStores(memoryPath) {
  let memoryStore = null;
  let architectureStore = null;
  const errors = [];

  try {
    memoryStore = new MemoryStore(memoryPath);
  } catch (error) {
    errors.push(`记忆数据不可用（只读降级，原文件未改动）：${error.message}`);
  }

  const legacySpaceId = memoryStore ? memoryStore.snapshot().spaces[0]?.id : undefined;
  try {
    architectureStore = new ArchitectureStore(`${memoryPath}.architecture.json`, { legacySpaceId });
  } catch (error) {
    errors.push(`架构数据不可用（只读降级，原文件未改动）：${error.message}`);
  }

  return { memoryStore, architectureStore, error: errors.join('；') };
}

module.exports = { openMemoryStores };
