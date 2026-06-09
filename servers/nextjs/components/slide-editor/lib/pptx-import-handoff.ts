import type { Deck } from "./slide-schema";

const DB_NAME = "presenton-slide-editor-imports";
const STORE_NAME = "pptx-imports";
const DB_VERSION = 1;
const ACTIVE_IMPORT_ID = "active-pptx-import";
const ACTIVE_TEMPLATE_IMPORT_ID = "active-template-import";

export const PPTX_IMPORT_QUERY_PARAM = "pptxImportId";
export const TEMPLATE_IMPORT_QUERY_PARAM = "templateImportId";

export type StagedPptxImport = {
  id: string;
  file: File;
  createdAt: number;
  fonts?: Record<string, string>;
};

export type StagedTemplateDeckImport = {
  id: string;
  deck: Deck;
  createdAt: number;
  fonts?: Record<string, string>;
  templateId?: string;
};

export type StagePptxImportOptions = {
  fonts?: Record<string, string>;
};

export type StageTemplateDeckImportOptions = {
  fonts?: Record<string, string>;
  templateId?: string;
};

export async function stagePptxImport(
  file: File,
  options: StagePptxImportOptions = {},
): Promise<string> {
  const record = {
    id: ACTIVE_IMPORT_ID,
    file,
    createdAt: Date.now(),
    fonts: options.fonts,
  } satisfies StagedPptxImport;
  await replaceStagedPptxImport(record);
  return ACTIVE_IMPORT_ID;
}

export async function stageTemplateDeckImport(
  deck: Deck,
  options: StageTemplateDeckImportOptions = {},
): Promise<string> {
  const record = {
    id: ACTIVE_TEMPLATE_IMPORT_ID,
    deck,
    createdAt: Date.now(),
    fonts: options.fonts,
    templateId: options.templateId,
  } satisfies StagedTemplateDeckImport;
  await replaceStagedPptxImport(record);
  return ACTIVE_TEMPLATE_IMPORT_ID;
}

export async function readStagedPptxImport(
  id: string,
): Promise<StagedPptxImport | null> {
  const record = await runStoreRequest<StagedPptxImport | undefined>(
    "readonly",
    (store) => store.get(id),
  );
  return record ?? null;
}

export async function readStagedTemplateDeckImport(
  id: string,
): Promise<StagedTemplateDeckImport | null> {
  const record = await runStoreRequest<StagedTemplateDeckImport | undefined>(
    "readonly",
    (store) => store.get(id),
  );
  return record ?? null;
}

export async function removeStagedPptxImport(
  id: string,
  expectedCreatedAt?: number,
): Promise<void> {
  if (expectedCreatedAt == null) {
    await runStoreRequest("readwrite", (store) => store.delete(id));
    return;
  }

  await removeStagedPptxImportIfCurrent(id, expectedCreatedAt);
}

async function replaceStagedPptxImport(
  record: StagedPptxImport | StagedTemplateDeckImport,
): Promise<void> {
  const db = await openImportDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    store.put(record);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not stage PPTX import."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Could not stage PPTX import."),
      );
  }).finally(() => db.close());
}

async function removeStagedPptxImportIfCurrent(
  id: string,
  expectedCreatedAt: number,
): Promise<void> {
  const db = await openImportDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const record = request.result as StagedPptxImport | undefined;
      if (record?.createdAt === expectedCreatedAt) {
        store.delete(id);
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not clear staged PPTX import."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not clear staged PPTX import."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Could not clear staged PPTX import."),
      );
  }).finally(() => db.close());
}

async function runStoreRequest<T = unknown>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openImportDb();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = createRequest(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not access staged PPTX import."));
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Could not access staged PPTX import."),
      );
    };
    transaction.onabort = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Could not access staged PPTX import."),
      );
    };
    transaction.oncomplete = () => db.close();
  });
}

function openImportDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("This browser does not support local PPTX import handoff."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open PPTX import cache."));
  });
}
