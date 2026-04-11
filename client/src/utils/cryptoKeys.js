const DB_NAME = "examsys-keys";
const STORE_NAME = "crypto_keys";
const STUDENT_PRIVATE_KEY_ID = "student_private_key";

const openKeyDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const putRecord = async (record) => {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(record);
  });
};

const getRecord = async (id) => {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const storeStudentPrivateKey = async (key) => {
  await putRecord({ id: STUDENT_PRIVATE_KEY_ID, key, saved_at: new Date().toISOString() });
};

export const loadStudentPrivateKey = async () => {
  const record = await getRecord(STUDENT_PRIVATE_KEY_ID);
  return record?.key || null;
};
