// ============================================================
// データモデルと保存
// 骨格データ = 「文字ごとに、どのエレメントをどこに置いたか」の集合。
// 座標系はキャンバスを 0〜1 に正規化した比率で持つので、
// 表示サイズが変わっても崩れない。
// localStorage に自動保存し、JSON の書き出し／読み込みにも対応する。
// ============================================================

// 1 つのエレメント配置。x,y は左上角、w,h は幅高さ。すべて 0〜1 の正規化値。
// （キャンバス外にはみ出す場合は負や 1 超も取りうる）
// rotation は度。中心まわりの回転（省略時 0）。
export interface Placement {
  id: string; // 一意なインスタンス ID
  element: string; // ElementDef.id
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipX?: boolean; // 左右反転
  flipY?: boolean; // 上下反転
}

// 文字 → 配置リスト
export type Skeletons = Record<string, Placement[]>;

const STORAGE_KEY = 'easyreta-skeletons-v1';

export function loadSkeletons(): Skeletons {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Skeletons;
  } catch {
    return {};
  }
}

export function saveSkeletons(data: Skeletons): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// JSON 文字列として書き出す（ダウンロード用）
export function exportJSON(data: Skeletons): string {
  return JSON.stringify(data, null, 2);
}

// JSON 文字列を読み込む。失敗したら null。
export function importJSON(text: string): Skeletons | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed as Skeletons;
    return null;
  } catch {
    return null;
  }
}

let uidCounter = 0;
export function newPlacementId(): string {
  return `p${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
}
