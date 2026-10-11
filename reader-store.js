/* Local snapshots and annotations. No credentials, servers or sync storage. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const FORMAT = "chatgpt-conversation-archive";
  const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
  const listeners = new Set();
  const channel = globalThis.BroadcastChannel ? new BroadcastChannel("chatgpt-reader-v1") : null;
  let opening;
  function announce(key) {
    for (const listener of listeners) listener(key);
    channel?.postMessage({ key });
  }
  if (channel) channel.onmessage = (event) => {
    if (typeof event.data?.key === "string") for (const listener of listeners) listener(event.data.key);
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
    return { conversations, annotations };
  }
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error(t("readerStorageUnavailable")));
      const request = indexedDB.open("chatgpt-conversation-reader", 2);
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
          ["savedAt", "payload.title", "payload.sourceUrl", "payload.capturedAt", "payload.completeness.count", "key", "byteSize"]);
        const annotations = db.objectStoreNames.contains("annotations")
          ? tx.objectStore("annotations") : db.createObjectStore("annotations", { keyPath: "id" });
        if (!annotations.indexNames.contains("conversationKey")) annotations.createIndex("conversationKey", "conversationKey");
        annotations.createIndex("storageSize", ["conversationKey", "byteSize"]);
        // Existing snapshots are read once during the atomic schema upgrade.
        // Later library refreshes read metadata keys, never bodies or assets.
        for (const store of [conversations, annotations]) {
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
    const entries = await transaction(["conversations", "annotations"], "readonly", (tx, set) => {
      // Only small metadata keys are read; the library never loads message bodies or assets.
      const result = [];
      const annotationSizes = new Map();
      tx.objectStore("annotations").index("storageSize").openKeyCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const [key, bytes] = cursor.key;
        annotationSizes.set(key, (annotationSizes.get(key) || 0) + bytes);
        cursor.continue();
      };
      tx.objectStore("conversations").index("summary").openKeyCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { set({ result, annotationSizes }); return; }
        const [savedAt, title, sourceUrl, capturedAt, count, key, bytes] = cursor.key;
        result.push({ key, title, sourceUrl, capturedAt, savedAt, count, bytes });
        cursor.continue();
      };
    });
    return entries.result.map((entry) => ({ ...entry,
      bytes: entry.bytes + (entries.annotationSizes.get(entry.key) || 0)
    })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function saveConversation(value) {
    const payload = cleanPayload(value), key = keyFor(payload.sourceUrl);
    const entry = { key, payload, savedAt: new Date().toISOString() };
    entry.byteSize = storageBytes(entry);
    await transaction(["conversations"], "readwrite", (tx) => {
      const store = tx.objectStore("conversations");
      store.get(key).onsuccess = (event) => {
        const previous = event.target.result;
        if (!previous || payload.capturedAt >= previous.payload.capturedAt) store.put(entry);
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
    await transaction(["conversations", "annotations"], "readwrite", (tx) => {
      tx.objectStore("conversations").delete(key);
      const annotations = tx.objectStore("annotations");
      annotations.index("conversationKey").openKeyCursor(key).onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        annotations.delete(cursor.primaryKey); cursor.continue();
      };
    });
    announce(key);
  }
  async function backup() {
    return transaction(["conversations", "annotations"], "readonly", (tx, set) => {
      const result = { format: FORMAT, version: 1, createdAt: new Date().toISOString() };
      tx.objectStore("conversations").getAll().onsuccess = (event) => { result.conversations = event.target.result; set(result); };
      tx.objectStore("annotations").getAll().onsuccess = (event) => { result.annotations = event.target.result; set(result); };
    });
  }
  async function restore(value) {
    const data = validateBackup(value);
    await transaction(["conversations", "annotations"], "readwrite", (tx, set, fail) => {
      const conversations = tx.objectStore("conversations"), annotations = tx.objectStore("annotations");
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
    });
    for (const entry of data.conversations) announce(entry.key);
    return { conversations: data.conversations.length, annotations: data.annotations.filter((entry) => !entry.deletedAt).length };
  }
  globalThis.ChatGPTReaderStore = { keyFor, getConversation, listConversations, saveConversation, deleteConversation,
    getAnnotations, saveAnnotation, deleteAnnotation, backup, restore, validateBackup, MAX_BACKUP_BYTES,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
})();
