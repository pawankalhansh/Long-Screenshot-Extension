/**
 * storage.js
 * Production-grade IndexedDB streaming storage utility for Chrome Extensions (MV3).
 * Operates seamlessly across Service Workers, Extension Pages, and Content Scripts.
 */

(function (global) {
  'use strict';

  const DB_NAME = 'LongScreenshotDB';
  const DB_VERSION = 1;
  const STORE_SESSIONS = 'sessions';
  const STORE_FRAMES = 'frames';

  let dbInstance = null;

  /**
   * Internal logger for transactions
   */
  const logError = (context, error) => {
    console.error(`[LSStorage Error] ${context}:`, error);
  };

  /**
   * Initializes the IndexedDB database and applies schema updates.
   * @returns {Promise<IDBDatabase>}
   */
  async function initDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this environment.'));
      }

      const request = global.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create 'sessions' store
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
        }

        // Create 'frames' store with composite key and an index on 'sessionId'
        if (!db.objectStoreNames.contains(STORE_FRAMES)) {
          const frameStore = db.createObjectStore(STORE_FRAMES, {
            keyPath: ['sessionId', 'index']
          });
          frameStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;

        // Handle version changes (e.g., if extension is updated and needs a new DB version)
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
        };

        resolve(dbInstance);
      };

      request.onerror = (event) => {
        logError('initDB', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Saves or updates a screenshot session.
   * @param {Object} sessionData - { sessionId, createdAt, type, metadata, bounds, dpr, totalHeight, ... }
   * @returns {Promise<void>}
   */
  async function saveSession(sessionData) {
    if (!sessionData || !sessionData.sessionId) {
      throw new Error('sessionData must contain a valid sessionId');
    }

    // Ensure createdAt is populated
    if (!sessionData.createdAt) {
      sessionData.createdAt = Date.now();
    }

    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS], 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);

      store.put(sessionData);

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        logError('saveSession', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieves a screenshot session by its ID.
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async function getSession(sessionId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS], 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const request = store.get(sessionId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (event) => {
        logError('getSession', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Converts a base64 Data URL to a Blob using the native fetch API.
   * @param {string} dataUrl
   * @returns {Promise<Blob>}
   */
  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  /**
   * Saves a single frame of a long screenshot.
   * @param {string} sessionId
   * @param {number} index - Sequence index of the frame
   * @param {Blob|string} blobOrDataUrl - The image payload (Blob or Data URL)
   * @param {Object} metadata - Optional properties (y, width, height, timestamp)
   * @returns {Promise<void>}
   */
  async function saveFrame(sessionId, index, blobOrDataUrl, metadata = {}) {
    let blob = blobOrDataUrl;

    // Automatically convert Data URL to Blob if necessary to optimize IDB storage
    if (typeof blobOrDataUrl === 'string' && blobOrDataUrl.startsWith('data:')) {
      blob = await dataUrlToBlob(blobOrDataUrl);
    }

    const frameRecord = {
      sessionId,
      index,
      blob,
      timestamp: metadata.timestamp || Date.now(),
      y: metadata.y || 0,
      width: metadata.width || 0,
      height: metadata.height || 0,
      ...metadata
    };

    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FRAMES], 'readwrite');
      const store = tx.objectStore(STORE_FRAMES);

      store.put(frameRecord);

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        logError('saveFrame', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieves all frames for a given session, sorted securely by their index.
   * @param {string} sessionId
   * @returns {Promise<Array<{ index, y, blob, width, height, timestamp }>>}
   */
  async function getFrames(sessionId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FRAMES], 'readonly');
      const store = tx.objectStore(STORE_FRAMES);
      const index = store.index('sessionId');

      const request = index.getAll(IDBKeyRange.only(sessionId));

      request.onsuccess = () => {
        const frames = request.result || [];
        // Guarantee sorted order by sequence index
        frames.sort((a, b) => a.index - b.index);
        resolve(frames);
      };

      request.onerror = (event) => {
        logError('getFrames', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Completely removes a session and cascades the deletion to all associated frames.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async function deleteSession(sessionId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      // Atomic multi-store transaction ensures database integrity
      const tx = db.transaction([STORE_SESSIONS, STORE_FRAMES], 'readwrite');

      // 1. Delete session metadata
      tx.objectStore(STORE_SESSIONS).delete(sessionId);

      // 2. Cascade delete frames matching the sessionId
      const frameStore = tx.objectStore(STORE_FRAMES);
      const frameIndex = frameStore.index('sessionId');
      const cursorRequest = frameIndex.openCursor(IDBKeyRange.only(sessionId));

      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        logError('deleteSession', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Sweeps the database for stale sessions to prevent disk leaks.
   * Default max age is 1 hour (3600000 ms).
   * @param {number} maxAgeMs
   * @returns {Promise<void>}
   */
  async function cleanupOldSessions(maxAgeMs = 3600000) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_FRAMES], 'readwrite');
      const sessionStore = tx.objectStore(STORE_SESSIONS);
      const frameStore = tx.objectStore(STORE_FRAMES);

      const now = Date.now();
      const request = sessionStore.getAll();

      request.onsuccess = (event) => {
        const sessions = event.target.result || [];

        sessions.forEach((session) => {
          const createdAt = session.createdAt || 0;
          if (now - createdAt > maxAgeMs) {
            // Delete stale session
            sessionStore.delete(session.sessionId);

            // Cascade delete related frames
            const frameIndex = frameStore.index('sessionId');
            const cursorReq = frameIndex.openCursor(IDBKeyRange.only(session.sessionId));

            cursorReq.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                cursor.delete();
                cursor.continue();
              }
            };
          }
        });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        logError('cleanupOldSessions', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Expose module API
   */
  const LSStorage = {
    initDB,
    saveSession,
    getSession,
    saveFrame,
    getFrames,
    deleteSession,
    cleanupOldSessions
  };

  // UMD-ish export ensures it works seamlessly as an ES6 module or standard global script
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = LSStorage;
    }
    exports.LSStorage = LSStorage;
  } else {
    global.LSStorage = LSStorage;
  }

})(globalThis || self || window);
