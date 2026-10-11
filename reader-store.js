/* Local snapshots, annotations and read state. No credentials, servers or sync storage. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const FORMAT = "chatgpt-conversation-archive";
  const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
  const listeners = new Set();
  const channel = globalThis.BroadcastChannel ? new BroadcastChannel("chatgpt-reader-v1") : null;
  let opening;
  function announce(key, topic) {
    for (const listener of listeners) listener(key, topic);
    channel?.postMessage({ key, topic });
  }
  if (channel) channel.onmessage = (event) => {
    if (typeof event.data?.key === "string") for (const listener of listeners) listener(event.data.key, event.data.topic);
  };
  function keyFor(url) {
    const target = globalThis.ChatGPTPdfSource.parseUrl(url);
    return target.kind + ":" + target.id;
  }
  function invalid() { throw new Error(t("readerInvalidBackup")); }
  function string(value, max = 10000000) {
    if (typeof value !== "string" || value.length > max) invalid();
    return value;
  }
  function date(value) {
    string(value, 100);
    if (!Number.isFinite(Date.parse(value))) invalid();
    return new Date(value).toISOString();
  }
  function storageBytes(value) {
    // Logical UTF-8 bytes, excluding this derived field. Disk compression and
    // IndexedDB index/engine overhead cannot be attributed to individual chats.
    const { byteSize, ...data } = value;
    return new TextEncoder().encode(JSON.stringify(data)).byteLength;
  }
  function cleanPayload(value) {
    if (!value || !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100000) invalid();
    const sourceUrl = globalThis.ChatGPTPdfSource.parseUrl(string(value.sourceUrl, 2000)).url;
    const ids = new Set();
    const messages = value.messages.map((message) => {
      const id = string(message.id, 200);
      if (!id || ids.has(id) || !["user", "assistant"].includes(message.role)) invalid();
      ids.add(id);
      const result = { id, role: message.role, text: string(message.text) };
      if (message.createdAt != null) result.createdAt = date(message.createdAt);
      if (message.layoutImages !== undefined) {
        if (!Array.isArray(message.layoutImages) || message.layoutImages.length > 10000) invalid();
        const slots = new Set();
        result.layoutImages = message.layoutImages.map(image => {
          if (!Number.isSafeInteger(image.slot) || image.slot < 0 || image.slot > 10000 || slots.has(image.slot)) invalid();
          slots.add(image.slot);
          const dataUrl = string(image.dataUrl, MAX_BACKUP_BYTES);
          if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/i.test(dataUrl)) invalid();
          return { slot: image.slot, query: string(image.query, 10000), dataUrl };
        });
      }
      if (message.sources !== undefined) {
        if (!Array.isArray(message.sources) || message.sources.length > 10000) invalid();
        result.sources = message.sources.map((source) => {
          const url = new URL(string(source.url, 10000));
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) invalid();
          return { url: url.href, title: string(source.title || "", 10000) };
        });
      }
      if (message.assets !== undefined) {
        if (!Array.isArray(message.assets) || message.assets.length > 10000) invalid();
        result.assets = message.assets.map((asset) => {
          const result = { label: string(asset.label || "", 10000) };
          if (asset.dataUrl !== undefined) {
            result.dataUrl = string(asset.dataUrl, MAX_BACKUP_BYTES);
            if (!/^data:[a-z0-9!#$&^_.+\-/]+(?:;[a-z0-9=._-]+)*;base64,[a-z0-9+/=\s]*$/i.test(result.dataUrl)) invalid();
          } else result.error = string(asset.error || "", 10000);
          return result;
        });
      }
      return result;
    });
    const questions = messages.filter((message) => message.role === "user").length;
    const verified = value.completeness;
    if (!verified?.verified || verified.count !== messages.length || verified.questions !== questions ||
        verified.firstMessageId !== messages[0].id || verified.lastMessageId !== messages.at(-1).id) invalid();
    return { title: string(value.title, 10000), sourceUrl, capturedAt: date(value.capturedAt), messages,
      completeness: { verified: true, count: messages.length, questions,
        firstMessageId: messages[0].id, lastMessageId: messages.at(-1).id } };
  }
  function cleanAnnotation(value) {
    if (!value || !value.anchor) invalid();
    const anchor = value.anchor;
    const exact = string(anchor.exact, 100000);
    if (!exact.trim() || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) ||
        anchor.start < 0 || anchor.end - anchor.start !== exact.length || !/^[a-f0-9]{64}$/.test(anchor.hash)) invalid();
    const result = {
      id: string(value.id, 200), conversationKey: string(value.conversationKey, 250),
      messageId: string(value.messageId, 200),
      anchor: { exact, prefix: string(anchor.prefix, 64), suffix: string(anchor.suffix, 64),
        start: anchor.start, end: anchor.end, hash: anchor.hash },
      comment: string(value.comment, 20000), createdAt: date(value.createdAt), updatedAt: date(value.updatedAt)
    };
    if (!result.id || !result.messageId || !result.conversationKey) invalid();
    if (value.deletedAt) result.deletedAt = date(value.deletedAt);
    return result;
  }
  function cleanRead(value) {
    if (!value || typeof value.read !== "boolean") invalid();
    const result = {
      conversationKey: string(value.conversationKey, 250), messageId: string(value.messageId, 200),
      read: value.read, textHash: string(value.textHash, 64), updatedAt: date(value.updatedAt)
    };
    if (!result.conversationKey || !result.messageId || !/^[a-f0-9]{64}$/.test(result.textHash)) invalid();
    return result;
  }
  function validateBackup(value) {
    if (value?.format !== FORMAT || value.version !== 1 || !Array.isArray(value.conversations) ||
        !Array.isArray(value.annotations) || value.conversations.length > 10000 || value.annotations.length > 100000) invalid();
    const keys = new Set(), ids = new Set();
    const conversations = value.conversations.map((entry) => {
      const payload = cleanPayload(entry.payload);
      const key = keyFor(payload.sourceUrl);
      if (entry.key !== key || keys.has(key)) invalid();
      keys.add(key);
      return { key, payload, savedAt: date(entry.savedAt) };
    });
    const annotations = value.annotations.map((entry) => {
      const annotation = cleanAnnotation(entry);
      if (!keys.has(annotation.conversationKey) || ids.has(annotation.id)) invalid();
      ids.add(annotation.id);
      return annotation;
    });
    // Missing reads keep version 1 backups restorable. An explicit false beats an older true.
    const readsInput = value.reads === undefined ? [] : value.reads;
    if (!Array.isArray(readsInput) || readsInput.length > 1000000) invalid();
    const readKeys = new Set();
    const messageIds = new Map(conversations.map((entry) => [entry.key, new Set(entry.payload.messages.map((message) => message.id))]));
    const reads = readsInput.map((entry) => {
      const read = cleanRead(entry);
      const identity = read.conversationKey + "\n" + read.messageId;
      if (!messageIds.get(read.conversationKey)?.has(read.messageId) || readKeys.has(identity)) invalid();
      readKeys.add(identity);
      return read;
    });
    return { conversations, annotations, reads };
  }
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error(t("readerStorageUnavailable")));
      const request = indexedDB.open("chatgpt-conversation-reader", 4);
      let failed = false;
      const fail = () => { failed = true; reject(new Error(t("readerStorageUnavailable"))); };
      request.onerror = fail;
      request.onblocked = fail;
      request.onupgradeneeded = () => {
        const db = request.result;
        const tx = request.transaction;
        const conversations = db.objectStoreNames.contains("conversations")
          ? tx.objectStore("conversations") : db.createObjectStore("conversations", { keyPath: "key" });
        if (conversations.indexNames.contains("summary")) conversations.deleteIndex("summary");
        conversations.createIndex("summary",
          ["savedAt", "payload.title", "payload.sourceUrl", "payload.capturedAt", "payload.completeness.count", "payload.completeness.questions", "key", "byteSize"]);
        const annotations = db.objectStoreNames.contains("annotations")
          ? tx.objectStore("annotations") : db.createObjectStore("annotations", { keyPath: "id" });
        if (!annotations.indexNames.contains("conversationKey")) annotations.createIndex("conversationKey", "conversationKey");
        if (!annotations.indexNames.contains("storageSize")) annotations.createIndex("storageSize", ["conversationKey", "byteSize"]);
        const reads = db.objectStoreNames.contains("reads")
          ? tx.objectStore("reads") : db.createObjectStore("reads", { keyPath: ["conversationKey", "messageId"] });
        if (!reads.indexNames.contains("conversationKey")) reads.createIndex("conversationKey", "conversationKey");
        // Existing snapshots are read once during the atomic schema upgrade.
        // Later library refreshes read metadata keys, never bodies or assets.
        for (const store of [conversations, annotations, reads]) {
          store.openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const entry = cursor.value;
            entry.byteSize = storageBytes(entry);
            cursor.update(entry); cursor.continue();
          };
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    }).catch((error) => { opening = undefined; throw error; });
    return opening;
  }
  async function transaction(stores, mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      const set = (value) => { result = value; };
      const fail = (error) => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error(t("readerStorageUnavailable")));
      try { run(tx, set, fail); } catch (error) { fail(error); }
    });
  }
  async function getConversation(key) {
    return transaction(["conversations"], "readonly", (tx, set) => {
      tx.objectStore("conversations").get(key).onsuccess = (event) => set(event.target.result || null);
    });
  }
  async function listConversations() {
    const entries = await transaction(["conversations", "annotations", "reads"], "readonly", (tx, set) => {
      // Only small metadata keys are read; the library never loads message bodies or assets.
      const result = [];
      const annotationSizes = new Map(), readSizes = new Map(), readCounts = new Map();
      let pending = 3;
      const finish = () => { if (--pending === 0) set({ result, annotationSizes, readSizes, readCounts }); };
      tx.objectStore("annotations").index("storageSize").openKeyCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { finish(); return; }
        const [key, bytes] = cursor.key;
        annotationSizes.set(key, (annotationSizes.get(key) || 0) + bytes);
        cursor.continue();
      };
      tx.objectStore("reads").openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { finish(); return; }
        const value = cursor.value;
        readSizes.set(value.conversationKey, (readSizes.get(value.conversationKey) || 0) + value.byteSize);
        if (value.read === true) readCounts.set(value.conversationKey, (readCounts.get(value.conversationKey) || 0) + 1);
        cursor.continue();
      };
      tx.objectStore("conversations").index("summary").openKeyCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { finish(); return; }
        const [savedAt, title, sourceUrl, capturedAt, count, questions, key, bytes] = cursor.key;
        result.push({ key, title, sourceUrl, capturedAt, savedAt, count, questions, bytes });
        cursor.continue();
      };
    });
    return entries.result.map((entry) => ({ ...entry,
      bytes: entry.bytes + (entries.annotationSizes.get(entry.key) || 0) + (entries.readSizes.get(entry.key) || 0),
      readCount: entries.readCounts.get(entry.key) || 0
    })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function saveConversation(value) {
    const payload = cleanPayload(value), key = keyFor(payload.sourceUrl);
    const entry = { key, payload, savedAt: new Date().toISOString() };
    entry.byteSize = storageBytes(entry);
    const messageIds = new Set(payload.messages.filter((message) => message.role === "assistant").map((message) => message.id));
    await transaction(["conversations", "reads"], "readwrite", (tx) => {
      const store = tx.objectStore("conversations");
      store.get(key).onsuccess = (event) => {
        const previous = event.target.result;
        if (!previous || payload.capturedAt >= previous.payload.capturedAt) {
          store.put(entry);
          const reads = tx.objectStore("reads");
          reads.index("conversationKey").openCursor(key).onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            if (!messageIds.has(cursor.value.messageId)) reads.delete(cursor.primaryKey);
            cursor.continue();
          };
        }
      };
    });
    announce(key);
    return entry;
  }
  async function getAnnotations(key) {
    const result = await transaction(["annotations"], "readonly", (tx, set) => {
      tx.objectStore("annotations").index("conversationKey").getAll(key).onsuccess = (event) => set(event.target.result);
    });
    return result.filter((entry) => !entry.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async function saveAnnotation(value, expected = null) {
    const annotation = cleanAnnotation(value);
    await transaction(["conversations", "annotations"], "readwrite", (tx, set, fail) => {
      tx.objectStore("conversations").get(annotation.conversationKey).onsuccess = (event) => {
        if (!event.target.result) { fail(new Error(t("readerSnapshotRequired"))); return; }
        const store = tx.objectStore("annotations");
        store.get(annotation.id).onsuccess = (event) => {
          const previous = event.target.result;
          if ((previous?.updatedAt || null) !== expected ||
              (previous && previous.conversationKey !== annotation.conversationKey)) {
            fail(new Error(t("readerConflict"))); return;
          }
          annotation.updatedAt = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)).toISOString();
          annotation.byteSize = storageBytes(annotation);
          store.put(annotation);
          set(annotation);
        };
      };
    });
    announce(annotation.conversationKey);
    return annotation;
  }
  function deleteAnnotation(annotation) {
    return saveAnnotation({ ...annotation, deletedAt: new Date().toISOString() }, annotation.updatedAt);
  }
  async function deleteConversation(key) {
    if (typeof key !== "string" || !key) invalid();
    await transaction(["conversations", "annotations", "reads"], "readwrite", (tx) => {
      tx.objectStore("conversations").delete(key);
      for (const name of ["annotations", "reads"]) {
        const records = tx.objectStore(name);
        records.index("conversationKey").openKeyCursor(key).onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          records.delete(cursor.primaryKey); cursor.continue();
        };
      }
    });
    announce(key);
  }
  async function getReads(key) {
    if (typeof key !== "string" || !key) invalid();
    return transaction(["reads"], "readonly", (tx, set) => {
      tx.objectStore("reads").index("conversationKey").getAll(key).onsuccess = (event) => set(event.target.result);
    });
  }
  async function setReads(values) {
    if (!Array.isArray(values) || !values.length || values.length > 100000) invalid();
    const prepared = values.map((value) => {
      const entry = cleanRead({ ...value, updatedAt: value.updatedAt || new Date().toISOString() });
      return entry;
    });
    const key = prepared[0].conversationKey;
    const ids = new Set();
    for (const entry of prepared) {
      if (entry.conversationKey !== key || ids.has(entry.messageId)) invalid();
      ids.add(entry.messageId);
    }
    const saved = await transaction(["conversations", "reads"], "readwrite", (tx, set, fail) => {
      tx.objectStore("conversations").get(key).onsuccess = (event) => {
        const snapshot = event.target.result;
        if (!snapshot) { fail(new Error(t("readerSnapshotRequired"))); return; }
        const messages = new Set(snapshot.payload.messages.map((message) => message.id));
        if (prepared.some((entry) => !messages.has(entry.messageId))) { fail(new Error(t("readerSnapshotRequired"))); return; }
        const store = tx.objectStore("reads");
        let pending = prepared.length;
        const results = new Array(prepared.length);
        prepared.forEach((entry, index) => {
          store.get([entry.conversationKey, entry.messageId]).onsuccess = (got) => {
            const previous = got.target.result;
            const next = { ...entry };
            next.updatedAt = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)).toISOString();
            next.byteSize = storageBytes(next);
            store.put(next);
            results[index] = next;
            if (--pending === 0) set(results);
          };
        });
      };
    });
    announce(key, "reads");
    return saved;
  }
  async function pruneReads(key, messageIds, announceChange = true) {
    if (typeof key !== "string" || !key || !Array.isArray(messageIds) || messageIds.length > 100000) invalid();
    const ids = new Set(messageIds);
    const removed = await transaction(["reads"], "readwrite", (tx, set) => {
      let count = 0;
      tx.objectStore("reads").index("conversationKey").openCursor(key).onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { set(count); return; }
        if (!ids.has(cursor.value.messageId)) { tx.objectStore("reads").delete(cursor.primaryKey); count += 1; }
        cursor.continue();
      };
    });
    if (removed && announceChange) announce(key, "reads");
    return removed;
  }
  async function backup() {
    return transaction(["conversations", "annotations", "reads"], "readonly", (tx, set) => {
      const result = { format: FORMAT, version: 1, createdAt: new Date().toISOString() };
      tx.objectStore("conversations").getAll().onsuccess = (event) => { result.conversations = event.target.result; set(result); };
      tx.objectStore("annotations").getAll().onsuccess = (event) => { result.annotations = event.target.result; set(result); };
      tx.objectStore("reads").getAll().onsuccess = (event) => { result.reads = event.target.result; set(result); };
    });
  }
  async function restore(value) {
    const data = validateBackup(value);
    await transaction(["conversations", "annotations", "reads"], "readwrite", (tx, set, fail) => {
      const conversations = tx.objectStore("conversations"), annotations = tx.objectStore("annotations"), reads = tx.objectStore("reads");
      for (const entry of data.conversations) {
        entry.byteSize = storageBytes(entry);
        conversations.get(entry.key).onsuccess = (event) => {
          const old = event.target.result;
          if (!old || entry.payload.capturedAt > old.payload.capturedAt) conversations.put(entry);
        };
      }
      for (const entry of data.annotations) {
        entry.byteSize = storageBytes(entry);
        annotations.get(entry.id).onsuccess = (event) => {
          const old = event.target.result;
          // A deletion is retained as a tombstone; old backups cannot resurrect it.
          if (old && old.conversationKey !== entry.conversationKey) { fail(new Error(t("readerInvalidBackup"))); return; }
          if (!old || entry.updatedAt > old.updatedAt) annotations.put(entry);
        };
      }
      for (const entry of data.reads) {
        entry.byteSize = storageBytes(entry);
        reads.get([entry.conversationKey, entry.messageId]).onsuccess = (event) => {
          const old = event.target.result;
          if (!old || entry.updatedAt > old.updatedAt) reads.put(entry);
        };
      }
    });
    for (const entry of data.conversations) announce(entry.key);
    return { conversations: data.conversations.length, annotations: data.annotations.filter((entry) => !entry.deletedAt).length };
  }
  globalThis.ChatGPTReaderStore = { keyFor, getConversation, listConversations, saveConversation, deleteConversation,
    getAnnotations, saveAnnotation, deleteAnnotation, getReads, setReads, pruneReads, backup, restore, validateBackup, MAX_BACKUP_BYTES,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
})();
