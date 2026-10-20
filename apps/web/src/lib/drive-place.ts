// ヘッダのドライブ選択。共有・管理へ移っても残す。

const STORAGE_KEY = "miyulabmd:drive-place";

export type DrivePlace =
  | { kind: "mine"; path: string }
  | { id: string; kind: "drive"; path: string };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

let memory: DrivePlace | null = null;

function sessionStore(): StorageLike | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  return sessionStorage;
}

function safeGet(storage: StorageLike | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // ストレージが使えないタブでも、メモリ上の選択は残す。
  }
}

function isTreePath(path: string) {
  return path === "/" || /^\/(?:d|f)\/[^/]+$/.test(path);
}

function defaultPath(place: { kind: "mine" } | { id: string; kind: "drive" }) {
  return place.kind === "drive" ? `/d/${place.id}` : "/";
}

export function drivePlacePath(place: DrivePlace) {
  return isTreePath(place.path) ? place.path : defaultPath(place);
}

function sameDrivePlace(left: DrivePlace, right: DrivePlace) {
  if (left.kind === "mine" || right.kind === "mine") {
    return left.kind === right.kind && left.path === right.path;
  }
  return left.id === right.id && left.path === right.path;
}

function parsePlace(raw: string | null): DrivePlace | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as {
      id?: unknown;
      kind?: unknown;
      path?: unknown;
    };
    const path = typeof value.path === "string" ? value.path : "";
    if (value.kind === "mine") {
      return { kind: "mine", path: drivePlacePath({ kind: "mine", path }) };
    }
    if (value.kind === "drive" && typeof value.id === "string" && value.id) {
      const place: DrivePlace = { id: value.id, kind: "drive", path };
      return { ...place, path: drivePlacePath(place) };
    }
  } catch {
    return null;
  }
  return null;
}

export function drivePlaceFromSelection(
  selection: { id?: string; kind: string },
  path: string,
): DrivePlace | null {
  if (!isTreePath(path)) {
    return null;
  }
  if (selection.kind === "mine") {
    return { kind: "mine", path };
  }
  if (selection.kind === "drive" && selection.id) {
    return { id: selection.id, kind: "drive", path };
  }
  return null;
}

export function readDrivePlace(storage?: StorageLike | null): DrivePlace {
  const store = storage === undefined ? sessionStore() : storage;
  const parsed = parsePlace(safeGet(store, STORAGE_KEY));
  if (parsed) {
    if (storage === undefined) {
      memory = parsed;
    }
    return parsed;
  }
  if (storage !== undefined) {
    return { kind: "mine", path: "/" };
  }
  return memory ?? { kind: "mine", path: "/" };
}

export function writeDrivePlace(
  place: DrivePlace,
  storage?: StorageLike | null,
) {
  const normalized: DrivePlace =
    place.kind === "mine"
      ? { kind: "mine", path: drivePlacePath(place) }
      : { id: place.id, kind: "drive", path: drivePlacePath(place) };
  if (storage === undefined) {
    memory = normalized;
  }
  const store = storage === undefined ? sessionStore() : storage;
  safeSet(store, STORAGE_KEY, JSON.stringify(normalized));
}

export function replaceDrivePlace(
  current: DrivePlace,
  next: DrivePlace,
): DrivePlace {
  return sameDrivePlace(current, next) ? current : next;
}
