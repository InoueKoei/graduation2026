// ============================================================
// エレメント定義
// 11個のエレメント画像のメタデータ。
// natW / natH は PNG の元のピクセル寸法で、
// キャンバスに置いたときのデフォルトの縦横比に使う。
// ここに 1 行足せば、そのままパレットに新しいエレメントが増える。
// ============================================================

export interface ElementDef {
  id: string; // ファイル名（拡張子なし）＝データ保存キー
  label: string; // パレットに表示する名前
  src: string; // 画像パス（public/elements 配下）
  natW: number; // 元画像の幅(px)
  natH: number; // 元画像の高さ(px)
}

export const ELEMENTS: ElementDef[] = [
  { id: 'tatebo', label: '縦棒', src: '/elements/tatebo.png', natW: 28, natH: 145 },
  { id: 'yokobou', label: '横棒', src: '/elements/yokobou.png', natW: 194, natH: 15 },
  { id: 'ten', label: '点', src: '/elements/ten.png', natW: 62, natH: 51 },
  { id: 'age', label: '上げ', src: '/elements/age.png', natW: 85, natH: 95 },
  { id: 'sage', label: '下げ', src: '/elements/sage.png', natW: 96, natH: 105 },
  { id: 'hane', label: 'はね', src: '/elements/hane.png', natW: 51, natH: 129 },
  { id: 'kaeri', label: '返り', src: '/elements/kaeri.png', natW: 75, natH: 85 },
  { id: 'kagi', label: 'かぎ', src: '/elements/kagi.png', natW: 116, natH: 155 },
  { id: 'mawari', label: 'まわり', src: '/elements/mawari.png', natW: 141, natH: 87 },
  { id: 'musubi', label: '結び', src: '/elements/musubi.png', natW: 118, natH: 108 },
  { id: 'wa', label: 'わ', src: '/elements/wa.png', natW: 183, natH: 143 },
];

export const ELEMENT_MAP: Record<string, ElementDef> = Object.fromEntries(
  ELEMENTS.map((e) => [e.id, e]),
);
