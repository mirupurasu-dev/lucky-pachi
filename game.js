'use strict';

/* ============================================================
   幸運のパチンコ v2 — 放置ビルド型パチンコローグライク(全10面)
   幸運の大家様式: 玉デッキ×リール構成で「揃い方」を自分で作る
   ============================================================ */

// ---------- コンフィグ ----------
const CFG = {
  W: 460, H: 780,               // 盤面(フィールド)サイズ
  CW: 600, CH: 1110,            // キャンバス全体(筐体込み・実機比率)
  FX: 70, FY: 175,              // 盤面のオフセット(AI筐体アートの窓位置に一致)
  ballR: 5.5, pinR: 3.4,
  gravity: 1500,
  restPin: 0.52, restWall: 0.38,
  fireInterval: 0.4,            // 自動発射間隔(秒)
  startBalls: 400,
  shotsPerStage: 170,
  quotas: [500, 650, 850, 1700, 3400, 6800, 13600, 26000, 50000, 95000], // ゴミ経済: 1-3面は低くフラット(積む期間)、4面以降を急勾配化(クリア率を大きく下げる調整)
  stageCoinRamp: 0.06,           // 面ごとに全獲得+6%(台の出玉エスカレーター。旧0.11から緩和)
  payScale: 2.8,                 // 払い出し全体スケール(高ノルマ調整の主ノブ。旧3.45から圧縮)
  hesoPay: 4, tulipPay: 5,
  attackerPay: 18, countPerRound: 9, roundTimeout: 6,
  rushRounds7: 6, rushRoundsBar: 4,
  renchanBase: 0.55,            // RUSH継続率(ノルマ改定に合わせ+5%)
  holdMax: 6,
  hesoHalfW: 10, hesoBoostInRush: 1.4,
  luckStart: 1.0,
  winL: 0.85,                   // 3揃い率 = Σ(c/N)^3×格 × (winL + 運×1.2)。低めで序盤ゴミ、積むほど揃う
  recipeL: 2.2,                 // 特殊役(レシピ)の成立係数
  twoMatchP: 0.34,
  shopPriceGrow: 1.12,
};

// ---------- 乱数 ----------
let _seed = (Math.random() * 2 ** 31) | 0;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(_seed);
function setSeed(n) { _seed = n | 0; rng = mulberry32(_seed); }
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const pick = arr => arr[(rng() * arr.length) | 0];

// ---------- 10面テーマ ----------
const THEMES = [
  { name: '場末',   num: '第一面', bg1: '#0e1511', bg2: '#0a0d0b', accent: '#29e07c', accent2: '#159254', pin: '#9aa49d', ambient: 'dust' },
  { name: '桜',     num: '第二面', bg1: '#1a0e15', bg2: '#0d070b', accent: '#ff7eb6', accent2: '#b3487d', pin: '#b39aa5', ambient: 'petal' },
  { name: '深海',   num: '第三面', bg1: '#081220', bg2: '#050a11', accent: '#38c8ff', accent2: '#1f7ea3', pin: '#8fa5b3', ambient: 'bubble' },
  { name: '夏祭',   num: '第四面', bg1: '#1a1008', bg2: '#0e0805', accent: '#ff8a3d', accent2: '#b35c24', pin: '#b3a08f', ambient: 'lantern' },
  { name: '銀河',   num: '第五面', bg1: '#100b20', bg2: '#090612', accent: '#a78bfa', accent2: '#6d5ab3', pin: '#a39ab3', ambient: 'star' },
  { name: '雷雲',   num: '第六面', bg1: '#0c1318', bg2: '#070b0e', accent: '#57d4ff', accent2: '#3488a8', pin: '#93a4ad', ambient: 'rain' },
  { name: '紅蓮',   num: '第七面', bg1: '#1a0909', bg2: '#0e0404', accent: '#ff5252', accent2: '#b33232', pin: '#b39090', ambient: 'emberUp' },
  { name: '氷牢',   num: '第八面', bg1: '#0b151a', bg2: '#060d11', accent: '#a5f3fc', accent2: '#6aa4ad', pin: '#9fb3b8', ambient: 'snow' },
  { name: '電脳',   num: '第九面', bg1: '#150920', bg2: '#0a0412', accent: '#ff4dff', accent2: '#a832a8', pin: '#b394b3', ambient: 'glitch' },
  { name: '天上',   num: '最終面', bg1: '#131318', bg2: '#0a0a0e', accent: '#f0f0ff', accent2: '#9a9ab3', pin: '#c9c9d4', ambient: 'shine' },
];

// ---------- リールシンボル(効果ディスクリプタ制) ----------
// three: 3揃い効果 / two: 2揃い効果(リーチ失敗時の小役)
// 効果type: coins/coinsRange/luck/mult/shots/quotaCut/shower/rush/thinDeck/
//           hesoPayPerm/rewriteHold/magnetPulse/deckBall/relicGift/ballsPct/multi/joker
const SYMBOLS = {
  // ---- ノーマル(単体はゴミ。稼ぎは倍率スタックで育てる) ----
  cherry:  { glyph: '🍒', name: 'チェリー',   color: '#ff6b81', rarity: 'normal', three: { t: 'coins', v: 10 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +10玉×倍率 / 2揃い: +3玉' },
  clover:  { glyph: '🍀', name: 'クローバー', color: '#4ade80', rarity: 'normal', three: { t: 'multi', list: [{ t: 'luck', v: 0.35 }, { t: 'coins', v: 8 }] }, two: { t: 'multi', list: [{ t: 'luck', v: 0.06 }, { t: 'coins', v: 2 }] }, desc: '3揃い: 運+0.35＆+8玉 / 2揃い: 運+0.06＆+2玉' },
  bell:    { glyph: '🔔', name: 'ベル',       color: '#fbbf24', rarity: 'normal', three: { t: 'shots', v: 6, c: 10 }, two: { t: 'shots', v: 1, c: 3 }, desc: '3揃い: +10玉＆発射+6 / 2揃い: +3玉＆発射+1' },
  house:   { glyph: '🏠', name: 'ハウス',     color: '#86efac', rarity: 'normal', three: { t: 'multi', list: [{ t: 'quotaCut', v: 0.08 }, { t: 'coins', v: 6 }] }, two: { t: 'multi', list: [{ t: 'quotaCut', v: 0.01 }, { t: 'coins', v: 1 }] }, desc: '3揃い: 納品-8%＆+6玉 / 2揃い: -1%＆+1玉' },
  lemon:   { glyph: '🍋', name: 'レモン',     color: '#fff176', rarity: 'normal', three: { t: 'coins', v: 10 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +10玉×倍率 / 2揃い: +3玉' },
  grape:   { glyph: '🍇', name: 'ブドウ',     color: '#b39ddb', rarity: 'normal', three: { t: 'coins', v: 10 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +10玉×倍率 / 2揃い: +3玉' },
  suika:   { glyph: '🍉', name: 'スイカ',     color: '#ef9a9a', rarity: 'normal', three: { t: 'coins', v: 10 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +10玉×倍率 / 2揃い: +3玉' },
  coin:    { glyph: '🪙', name: 'コイン',     color: '#ffcc80', rarity: 'normal', three: { t: 'shots', v: 1, c: 14 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +14玉＆発射+1 / 2揃い: +3玉' },
  fuusen:  { glyph: '🎈', name: '風船',       color: '#ff8a80', rarity: 'normal', three: { t: 'shower', v: 3 }, two: { t: 'coins', v: 2 }, desc: '3揃い: 玉シャワー3発 / 2揃い: +2玉' },
  sakura:  { glyph: '🌸', name: 'サクラ',     color: '#f8bbd0', rarity: 'normal', three: { t: 'multi', list: [{ t: 'luck', v: 0.2 }, { t: 'coins', v: 7 }] }, two: { t: 'multi', list: [{ t: 'luck', v: 0.03 }, { t: 'coins', v: 2 }] }, desc: '3揃い: 運+0.2＆+7玉 / 2揃い: 運+0.03＆+2玉' },
  mitsuba: { glyph: '☘️', name: '三つ葉',     color: '#81c784', rarity: 'normal', three: { t: 'multi', list: [{ t: 'luck', v: 0.25 }, { t: 'coins', v: 7 }] }, two: { t: 'multi', list: [{ t: 'luck', v: 0.03 }, { t: 'coins', v: 2 }] }, desc: '3揃い: 運+0.25＆+7玉 / 2揃い: 運+0.03＆+2玉' },
  fortune: { glyph: '🥠', name: 'おみくじ',   color: '#ffe0b2', rarity: 'normal', three: { t: 'coinsRange', min: 6, max: 42 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +6〜42玉(運試し) / 2揃い: +3玉' },
  kozutsumi:{ glyph: '📦', name: '小包',      color: '#bcaaa4', rarity: 'normal', three: { t: 'thinDeck', c: 9 }, two: { t: 'coins', v: 2 }, desc: '3揃い: 白玉を1つ回収して+9玉 / 2揃い: +2玉' },
  mato:    { glyph: '🎯', name: '的',         color: '#ef5350', rarity: 'normal', three: { t: 'hesoPayPerm', v: 1 }, two: { t: 'coins', v: 2 }, desc: '3揃い: ヘソ賞球+1(永続) / 2揃い: +2玉' },
  // ---- レア(効果は据置。ただし"格"で揃いにくい=積んで初めて出る) ----
  seven:   { glyph: '７',  name: 'セブン',     color: '#ff5d5d', rarity: 'rare', three: { t: 'rush', v: 6 }, two: { t: 'coins', v: 8 }, desc: '3揃い: RUSH 6R / 2揃い: +8玉' },
  bar:     { glyph: 'BAR', name: 'バー',       color: '#e8e8e8', rarity: 'rare', three: { t: 'rush', v: 3 }, two: { t: 'coins', v: 6 }, desc: '3揃い: ミニRUSH 3R / 2揃い: +6玉' },
  moon:    { glyph: '🌙', name: 'ムーン',     color: '#c4b5fd', rarity: 'rare', three: { t: 'multi', list: [{ t: 'mult', v: 0.3 }, { t: 'coins', v: 8 }] }, two: { t: 'multi', list: [{ t: 'mult', v: 0.05 }, { t: 'coins', v: 2 }] }, desc: '3揃い: 倍率+0.3＆+8玉 / 2揃い: +0.05＆+2玉' },
  diamond: { glyph: '💎', name: 'ダイヤ',     color: '#67e8f9', rarity: 'rare', three: { t: 'coins', v: 300 }, two: { t: 'coins', v: 10 }, desc: '3揃い: +300玉×倍率 / 2揃い: +10玉' },
  star:    { glyph: '⭐', name: 'スター',     color: '#fde68a', rarity: 'rare', three: { t: 'shower', v: 14 }, two: { t: 'coins', v: 2 }, desc: '3揃い: 玉シャワー14発 / 2揃い: +2玉' },
  kinbukuro:{ glyph: '💰', name: '金袋',      color: '#ffd54f', rarity: 'rare', three: { t: 'coins', v: 240 }, two: { t: 'coins', v: 8 }, desc: '3揃い: +240玉×倍率 / 2揃い: +8玉' },
  suisho:  { glyph: '🔮', name: '水晶',       color: '#ce93d8', rarity: 'rare', three: { t: 'rewriteHold', c: 6 }, two: { t: 'coins', v: 5 }, desc: '3揃い: 保留1つを当たりに書き換える / 2揃い: +5玉' },
  saikoro: { glyph: '🎲', name: 'サイコロ',   color: '#e0e0e0', rarity: 'rare', three: { t: 'coinsRange', min: 50, max: 500 }, two: { t: 'coins', v: 3 }, desc: '3揃い: +50〜500玉の大博打 / 2揃い: +3玉' },
  inazuma: { glyph: '⚡', name: 'イナズマ',   color: '#84ffff', rarity: 'rare', three: { t: 'magnetPulse' }, two: { t: 'coins', v: 4 }, desc: '3揃い: 全玉がヘソへ吸引される(2.5秒) / 2揃い: +4玉' },
  nijiiro: { glyph: '🌈', name: '虹',         color: '#f48fb1', rarity: 'rare', three: { t: 'multi', list: [{ t: 'luck', v: 0.5 }, { t: 'mult', v: 0.15 }] }, two: { t: 'luck', v: 0.1 }, desc: '3揃い: 運+0.5＆倍率+0.15 / 2揃い: 運+0.1' },
  present: { glyph: '🎁', name: 'プレゼント', color: '#f06292', rarity: 'rare', three: { t: 'relicGift' }, two: { t: 'coins', v: 4 }, desc: '3揃い: お守りをランダム入手！ / 2揃い: +4玉' },
  kagi:    { glyph: '🔑', name: '鍵',         color: '#ffe082', rarity: 'rare', three: { t: 'quotaCut', v: 0.2 }, two: { t: 'quotaCut', v: 0.03 }, desc: '3揃い: 納品額-20% / 2揃い: -3%' },
  buta:    { glyph: '🐷', name: '貯金箱',     color: '#f8bbd0', rarity: 'rare', three: { t: 'ballsPct', v: 0.08 }, two: { t: 'ballsPct', v: 0.03 }, desc: '3揃い: 持ち玉の8%を獲得 / 2揃い: 3%' },
  hanabi:  { glyph: '🎇', name: '花火',       color: '#ffab91', rarity: 'rare', three: { t: 'multi', list: [{ t: 'shower', v: 12 }, { t: 'coins', v: 8 }] }, two: { t: 'coins', v: 3 }, desc: '3揃い: シャワー12発＆+8玉 / 2揃い: +3玉' },
  unicorn: { glyph: '🦄', name: 'ユニコーン', color: '#f8bbd0', rarity: 'rare', three: { t: 'multi', list: [{ t: 'luck', v: 0.4 }, { t: 'shower', v: 8 }] }, two: { t: 'luck', v: 0.1 }, desc: '3揃い: 運+0.4＆シャワー8発 / 2揃い: 運+0.1' },
  // ---- レジェンド(格0.12=相当積まないと揃わない。揃えば爆発) ----
  crown:   { glyph: '👑', name: '王冠',       color: '#ffe57f', rarity: 'legend', three: { t: 'rush', v: 8 }, two: { t: 'coins', v: 12 }, desc: '3揃い: 超RUSH 8R / 2揃い: +12玉' },
  ryu:     { glyph: '🐉', name: '龍',         color: '#80cbc4', rarity: 'legend', three: { t: 'coins', v: 666 }, two: { t: 'coins', v: 10 }, desc: '3揃い: +666玉×倍率 / 2揃い: +10玉' },
  taiyo:   { glyph: '🌞', name: '太陽',       color: '#ffcc80', rarity: 'legend', three: { t: 'multi', list: [{ t: 'mult', v: 0.6 }, { t: 'coins', v: 12 }] }, two: { t: 'multi', list: [{ t: 'mult', v: 0.1 }, { t: 'coins', v: 3 }] }, desc: '3揃い: 倍率+0.6＆+12玉 / 2揃い: +0.1＆+3玉' },
  ryusei:  { glyph: '💫', name: '流星群',     color: '#b3e5fc', rarity: 'legend', three: { t: 'shower', v: 25 }, two: { t: 'shower', v: 3 }, desc: '3揃い: 玉シャワー25発 / 2揃い: シャワー3発' },
  joker:   { glyph: '🃏', name: 'ジョーカー', color: '#ff4dff', rarity: 'legend', three: { t: 'joker' }, two: { t: 'coins', v: 5 }, desc: '3揃い: ランダムなレジェンド級効果 / 2揃い: +5玉' },
  banana:  { glyph: '🍌', name: '黄金バナナ', color: '#ffe135', rarity: 'legend', three: { t: 'coins', v: 500 }, two: { t: 'coins', v: 8 }, desc: '3揃い: +500玉×倍率 / 2揃い: +8玉' },
  sekaiju: { glyph: '🌳', name: '世界樹',     color: '#66bb6a', rarity: 'legend', three: { t: 'multi', list: [{ t: 'luck', v: 1.0 }, { t: 'coins', v: 200 }] }, two: { t: 'luck', v: 0.1 }, desc: '3揃い: 運+1.0＆+200玉 / 2揃い: 運+0.1' },
  shakudama:{ glyph: '🎆', name: '尺玉',      color: '#ff7043', rarity: 'legend', three: { t: 'multi', list: [{ t: 'shower', v: 30 }, { t: 'coins', v: 100 }] }, two: { t: 'shower', v: 2 }, desc: '3揃い: 玉シャワー30発＆+100玉 / 2揃い: シャワー2発' },
  karakuri:{ glyph: '🏯', name: '絡繰城',     color: '#b39ddb', rarity: 'legend', three: { t: 'multi', list: [{ t: 'quotaCut', v: 0.25 }, { t: 'coins', v: 150 }] }, two: { t: 'coins', v: 5 }, desc: '3揃い: 納品-25%＆+150玉 / 2揃い: +5玉' },
  ringo: { glyph: "🍎", name: "りんご", color: "#e5604f", rarity: "normal", three: {"t":"coins","v":11}, two: {"t":"coins","v":3}, desc: "3揃い: +11玉×倍率 / 2揃い: +3玉" },
  momo: { glyph: "🍑", name: "もも", color: "#f6a6a0", rarity: "normal", three: {"t":"multi","list":[{"t":"luck","v":0.15},{"t":"coins","v":8}]}, two: {"t":"luck","v":0.03}, desc: "3揃い: 運+0.15＆+8玉 / 2揃い: 運+0.03" },
  mikan: { glyph: "🍊", name: "みかん", color: "#ff9f43", rarity: "normal", three: {"t":"coins","v":12}, two: {"t":"coins","v":3}, desc: "3揃い: +12玉×倍率 / 2揃い: +3玉" },
  ine: { glyph: "🌾", name: "稲穂", color: "#e3b23c", rarity: "normal", three: {"t":"multi","list":[{"t":"luck","v":0.2},{"t":"coins","v":12}]}, two: {"t":"multi","list":[{"t":"luck","v":0.03},{"t":"coins","v":2}]}, desc: "3揃い: 運+0.2＆+12玉(豊作の種) / 2揃い: 運+0.03＆+2玉" },
  himawari: { glyph: "🌻", name: "ひまわり", color: "#f9a825", rarity: "normal", three: {"t":"multi","list":[{"t":"mult","v":0.25},{"t":"coins","v":8}]}, two: {"t":"multi","list":[{"t":"mult","v":0.05},{"t":"coins","v":2}]}, desc: "3揃い: 倍率+0.25＆+8玉 / 2揃い: +0.05＆+2玉" },
  momiji: { glyph: "🍁", name: "もみじ", color: "#e0592a", rarity: "normal", three: {"t":"shots","v":5,"c":10}, two: {"t":"shots","v":1,"c":3}, desc: "3揃い: +10玉＆発射+5 / 2揃い: +3玉＆発射+1" },
  usagi: { glyph: "🐰", name: "兎", color: "#e2cdbb", rarity: "normal", three: {"t":"shots","v":5,"c":12}, two: {"t":"shots","v":1,"c":3}, desc: "3揃い: +12玉＆発射+5 / 2揃い: +3玉＆発射+1" },
  neko: { glyph: "🐱", name: "招き猫", color: "#ffd54f", rarity: "rare", three: {"t":"multi","list":[{"t":"ballsPct","v":0.1},{"t":"coins","v":18}]}, two: {"t":"coins","v":4}, desc: "3揃い: 持ち玉10%獲得＆+18玉 / 2揃い: +4玉" },
  byakko: { glyph: "🐅", name: "白虎", color: "#e8e8e8", rarity: "rare", three: {"t":"rush","v":3}, two: {"t":"coins","v":6}, desc: "3揃い: ミニRUSH 3R / 2揃い: +6玉" },
  suzaku: { glyph: "🦅", name: "朱雀", color: "#ef5350", rarity: "rare", three: {"t":"multi","list":[{"t":"shower","v":16},{"t":"coins","v":10}]}, two: {"t":"coins","v":3}, desc: "3揃い: シャワー16発＆+10玉 / 2揃い: +3玉" },
  genbu: { glyph: "🐢", name: "玄武", color: "#66bb6a", rarity: "rare", three: {"t":"hesoPayPerm","v":2}, two: {"t":"coins","v":3}, desc: "3揃い: ヘソ賞球+2(永続) / 2揃い: +3玉" },
  kumo: { glyph: "☁️", name: "雲", color: "#b0bec5", rarity: "normal", three: {"t":"shots","v":2,"c":12}, two: {"t":"coins","v":2}, desc: "3揃い: +12玉＆発射+2 / 2揃い: +2玉" },
  chochin: { glyph: "🏮", name: "提灯", color: "#ff7043", rarity: "normal", three: {"t":"shots","v":8,"c":6}, two: {"t":"coins","v":2}, desc: "3揃い: +6玉＆発射+8 / 2揃い: +2玉" },
  // 百獣・財宝・天体はノーマル絵柄が1種類しかなく開始直後に系統を組めなかった(実測クリア率40〜67%)ため、各+3種を追加
  kaeru:   { glyph: '🐸', name: '蛙',       color: '#7cb342', rarity: 'normal', three: { t: 'coins', v: 9 }, two: { t: 'coins', v: 2 }, desc: '3揃い: +9玉×倍率(無事帰る) / 2揃い: +2玉' },
  kitsune: { glyph: '🦊', name: '狐',       color: '#f4a340', rarity: 'normal', three: { t: 'multi', list: [{ t: 'luck', v: 0.15 }, { t: 'coins', v: 6 }] }, two: { t: 'multi', list: [{ t: 'luck', v: 0.02 }, { t: 'coins', v: 1 }] }, desc: '3揃い: 運+0.15＆+6玉 / 2揃い: 運+0.02＆+1玉' },
  koi:     { glyph: '🐟', name: '鯉',       color: '#e2725b', rarity: 'normal', three: { t: 'shots', v: 4, c: 7 }, two: { t: 'shots', v: 1, c: 2 }, desc: '3揃い: +7玉＆発射+4(滝を昇る) / 2揃い: +2玉＆発射+1' },
  shuugi:  { glyph: '🧧', name: '祝儀袋',   color: '#e5383b', rarity: 'normal', three: { t: 'coins', v: 9 }, two: { t: 'coins', v: 2 }, desc: '3揃い: +9玉×倍率 / 2揃い: +2玉' },
  tsubo:   { glyph: '🏺', name: '壺',       color: '#e0b04c', rarity: 'normal', three: { t: 'multi', list: [{ t: 'quotaCut', v: 0.035 }, { t: 'coins', v: 4 }] }, two: { t: 'multi', list: [{ t: 'quotaCut', v: 0.01 }, { t: 'coins', v: 1 }] }, desc: '3揃い: 納品-3.5%＆+4玉 / 2揃い: -1%＆+1玉' },
  satsu:   { glyph: '💴', name: '札束',     color: '#6fbf73', rarity: 'normal', three: { t: 'shots', v: 4, c: 7 }, two: { t: 'shots', v: 1, c: 2 }, desc: '3揃い: +7玉＆発射+4 / 2揃い: +2玉＆発射+1' },
  tako:    { glyph: '🪁', name: '凧',       color: '#e15554', rarity: 'normal', three: { t: 'shots', v: 4, c: 7 }, two: { t: 'shots', v: 1, c: 2 }, desc: '3揃い: +7玉＆発射+4(高く舞う) / 2揃い: +2玉＆発射+1' },
  hato:    { glyph: '🕊️', name: '鳩',       color: '#90a4d4', rarity: 'normal', three: { t: 'multi', list: [{ t: 'luck', v: 0.15 }, { t: 'coins', v: 5 }] }, two: { t: 'multi', list: [{ t: 'luck', v: 0.02 }, { t: 'coins', v: 1 }] }, desc: '3揃い: 運+0.15＆+5玉 / 2揃い: 運+0.02＆+1玉' },
  furin:   { glyph: '🎐', name: '風鈴',     color: '#9d7fd6', rarity: 'normal', three: { t: 'multi', list: [{ t: 'mult', v: 0.15 }, { t: 'coins', v: 4 }] }, two: { t: 'multi', list: [{ t: 'mult', v: 0.03 }, { t: 'coins', v: 1 }] }, desc: '3揃い: 倍率+0.15＆+4玉(涼やかな音) / 2揃い: +0.03＆+1玉' },
};

// ---------- 絵柄の色系統(色共鳴玉とのビルド相乗に使う) ----------
const SYMBOL_FAMILY = {
  cherry: 'red', suika: 'red', seven: 'red', mato: 'red', hanabi: 'red',
  bell: 'gold', lemon: 'gold', coin: 'gold', fortune: 'gold', kinbukuro: 'gold', star: 'gold', kagi: 'gold', crown: 'gold', taiyo: 'gold',
  clover: 'green', mitsuba: 'green', house: 'green',
  grape: 'purple', moon: 'purple', suisho: 'purple', joker: 'purple',
  diamond: 'blue', inazuma: 'blue', ryusei: 'blue', ryu: 'blue',
  sakura: 'pink', fuusen: 'pink', buta: 'pink', unicorn: 'pink', present: 'pink',
  nijiiro: 'rainbow', // 虹は全系統にマッチ
  ringo: 'red', momo: 'pink', mikan: 'gold', ine: 'gold', himawari: 'gold', momiji: 'red', usagi: 'pink', neko: 'gold', byakko: 'gold', suzaku: 'red', genbu: 'green', chochin: 'red',  // 追加13絵柄(雲kumoは無彩色=色共鳴なしで意図的に除外)
  banana: 'gold', sekaiju: 'green', shakudama: 'red', karakuri: 'purple', // カテゴリ専用レジェンド
  kaeru: 'green', kitsune: 'gold', koi: 'red', shuugi: 'red', tsubo: 'gold', satsu: 'green', tako: 'red', hato: 'blue', furin: 'purple', // 百獣/財宝/天体の追加ノーマル9種
};

// ---------- 絵柄アンロック(メタ進行・スルメ要素) ----------
// stages=累計クリア面数で解禁 / loops=周回クリア数で解禁。無記載は最初から使える
const SYMBOL_UNLOCKS = {
  suika: { stages: 4 }, coin: { stages: 8 }, mitsuba: { stages: 12 }, fuusen: { stages: 16 },
  fortune: { stages: 20 }, kozutsumi: { stages: 25 }, mato: { stages: 30 },
  bar: { stages: 6 }, star: { stages: 10 }, kinbukuro: { stages: 15 }, suisho: { stages: 20 },
  saikoro: { stages: 25 }, inazuma: { stages: 30 }, nijiiro: { stages: 36 }, present: { stages: 42 },
  kagi: { stages: 48 }, buta: { stages: 55 }, hanabi: { stages: 62 }, unicorn: { stages: 70 },
  crown: { loops: 1 }, taiyo: { loops: 2 }, ryu: { loops: 3 }, ryusei: { loops: 4 }, joker: { loops: 5 },
};
let META = { stages: 0, loops: 0, dex: {}, games: 0 };
try { META = Object.assign(META, JSON.parse(localStorage.getItem('luckyPachiMeta') || '{}')); } catch (e) {}
if (!META.dex) META.dex = {}; // 図鑑の発見記録(type:id → 1)
function saveMeta() { try { localStorage.setItem('luckyPachiMeta', JSON.stringify(META)); } catch (e) {} }
// 図鑑: アイテムを初めて入手/成立させたら記録(スルメ収集要素)
function markDex(type, id) {
  if (S.simMode || S.allUnlock) return; // 計測は汚さない
  const key = `${type}:${id}`;
  if (!META.dex[key]) { META.dex[key] = 1; saveMeta(); }
}
function dexHas(type, id) { return !!META.dex[`${type}:${id}`]; }
// ---------- 難易度(ノルマ倍率) ----------
const DIFFS = [
  { key: 'easy',   label: 'やさしい', mult: 0.62, color: '#7ef0a8', note: '納品ノルマ -38%' },
  { key: 'normal', label: 'ふつう',   mult: 1.3,  color: '#ffd76a', note: '標準バランス（クリア率約20%）' },
  { key: 'hard',   label: 'むずかしい', mult: 1.5, color: '#ff8a3d', note: '納品ノルマ +50%' },
  { key: 'oni',    label: '鬼',       mult: 2.3,  color: '#ff5252', note: '納品ノルマ +130%・玄人向け' },
];
let diffIdx = 1;
try { const d = localStorage.getItem('luckyPachiDiff'); if (d != null && DIFFS[+d]) diffIdx = +d; } catch (e) {}
function curDiff() { return DIFFS[diffIdx]; }
function setDiff(i) { diffIdx = ((i % DIFFS.length) + DIFFS.length) % DIFFS.length; try { localStorage.setItem('luckyPachiDiff', diffIdx); } catch (e) {} }
function symbolUnlocked(id) {
  if (S.allUnlock) return true;
  const u = SYMBOL_UNLOCKS[id];
  if (!u) return true;
  return u.stages != null ? META.stages >= u.stages : META.loops >= (u.loops || 0);
}
function unlockedNow() { return Object.keys(SYMBOL_UNLOCKS).filter(symbolUnlocked); }
function nextUnlockInfo() {
  let best = null;
  for (const [id, u] of Object.entries(SYMBOL_UNLOCKS)) {
    if (symbolUnlocked(id) || u.stages == null) continue;
    const rem = u.stages - META.stages;
    if (!best || rem < best.rem) best = { id, rem };
  }
  return best;
}

// ---------- 絵柄カテゴリ(8系統。役をカテゴリ制にして分かりやすくする) ----------
const SYMBOL_CAT = {
  cherry: 'fruit', lemon: 'fruit', grape: 'fruit', suika: 'fruit', ringo: 'fruit', momo: 'fruit', mikan: 'fruit',
  clover: 'plant', sakura: 'plant', mitsuba: 'plant', ine: 'plant', himawari: 'plant', momiji: 'plant',
  buta: 'animal', unicorn: 'animal', ryu: 'animal', usagi: 'animal', neko: 'animal', byakko: 'animal', suzaku: 'animal', genbu: 'animal',
  moon: 'sky', star: 'sky', taiyo: 'sky', ryusei: 'sky', nijiiro: 'sky', kumo: 'sky',
  coin: 'treasure', kinbukuro: 'treasure', diamond: 'treasure', crown: 'treasure', suisho: 'treasure', kagi: 'treasure',
  seven: 'luck', bar: 'luck', saikoro: 'luck', fortune: 'luck', mato: 'luck', joker: 'luck',
  bell: 'festival', hanabi: 'festival', fuusen: 'festival', present: 'festival', chochin: 'festival',
  house: 'tool', kozutsumi: 'tool', inazuma: 'tool',
  banana: 'fruit', sekaiju: 'plant', shakudama: 'festival', karakuri: 'tool', // カテゴリ専用レジェンド
  kaeru: 'animal', kitsune: 'animal', koi: 'animal', // 百獣: ノーマル1→4種に
  shuugi: 'treasure', tsubo: 'treasure', satsu: 'treasure', // 財宝: ノーマル1→4種に
  tako: 'sky', hato: 'sky', furin: 'sky', // 天体: ノーマル1→4種に
};
const CAT_INFO = {
  fruit: { name: '果物', glyph: '🍒' }, plant: { name: '植物', glyph: '🍀' },
  animal: { name: '動物', glyph: '🐾' }, sky: { name: '天体', glyph: '🌙' },
  treasure: { name: '財宝', glyph: '💎' }, luck: { name: '博打', glyph: '🎲' },
  festival: { name: '祭', glyph: '🎆' }, tool: { name: '仕掛', glyph: '🔧' },
};
function symCat(id) { return SYMBOL_CAT[id] || null; }

// ---------- 特殊役(レシピ): カテゴリ制＋レア固定役。need=必要スロット(cat=カテゴリ / id=特定絵柄) ----------
const RECIPES = [
  // ══ 系統役: 同じ系統を3つ揃えるだけ(覚えるルールは1つ) ══
  { name: '果実の恵み', family: 'カテゴリ役', tier: '中',   need: [{ cat: 'fruit', n: 3 }],    desc: '果物×3 → +130玉',                eff: { t: 'coins', v: 130 } },
  { name: '花盛り',     family: 'カテゴリ役', tier: '中',   need: [{ cat: 'plant', n: 3 }],    desc: '植物×3 → 運+0.15＆+130玉×倍率',   eff: { t: 'multi', list: [{ t: 'luck', v: 0.15 }, { t: 'coins', v: 130 }] } },
  { name: '獣の群れ',   family: 'カテゴリ役', tier: '中',   need: [{ cat: 'animal', n: 3 }],   desc: '動物×3 → +220玉＆発射+8',        eff: { t: 'multi', list: [{ t: 'coins', v: 220 }, { t: 'shots', v: 8 }] } },
  { name: '天の采配',   family: 'カテゴリ役', tier: '納品減', need: [{ cat: 'sky', n: 3 }],      desc: '天体×3 → 納品-10%(その面だけ、次の面でリセット)', eff: { t: 'quotaCut', v: 0.10 } },
  { name: '千両役者',   family: 'カテゴリ役', tier: '爆発', need: [{ cat: 'treasure', n: 3 }], desc: '財宝×3 → +450玉',                eff: { t: 'coins', v: 450 } },
  { name: '大博打',     family: 'カテゴリ役', tier: '大振れ', need: [{ cat: 'luck', n: 3 }],     desc: '博打×3 → +30〜1500玉(運試し・博打覚醒のしょぼい版)', eff: { t: 'coinsRange', min: 30, max: 1500 } },
  { name: '宵祭り',     family: 'カテゴリ役', tier: '中',   need: [{ cat: 'festival', n: 3 }], desc: '祭×3 → +400玉×倍率＆シャワー4発', eff: { t: 'multi', list: [{ t: 'coins', v: 400 }, { t: 'shower', v: 4 }] } },
  { name: '絡繰の妙',   family: 'カテゴリ役', tier: '中',   need: [{ cat: 'tool', n: 3 }],     desc: '仕掛×3 → 納品-15%＆白玉間引き',  eff: { t: 'multi', list: [{ t: 'quotaCut', v: 0.15 }, { t: 'thinDeck', c: 15 }] } },
  // ══ 覚醒役: 系統×2＋その系統の「主」レジェンド(1ルールは共通)。ただし発動する特殊能力は系統ごとに別物 ══
  // 果物=シャワー系／花木=永続成長系／百獣=フィーバー系／天体=倍率系(加算・安全)／財宝=固定でかい系／博打=大振れ乱数系／祭=納品数減らし系／仕掛=設置型系
  { name: 'フルーツ覚醒', family: '覚醒役', tier: 'シャワー', need: [{ cat: 'fruit', n: 2 }, { id: 'banana', n: 1 }],      desc: '果物×2＋🍌黄金バナナ → 玉シャワー8発＆+105玉', eff: { t: 'multi', list: [{ t: 'shower', v: 8 }, { t: 'coins', v: 105 }] } },
  { name: '花木覚醒',   family: '覚醒役', tier: '永続成長', need: [{ cat: 'plant', n: 2 }, { id: 'sekaiju', n: 1 }],      desc: '植物×2＋🌳世界樹 → ヘソ賞球+1(永続)＆運+0.15',   eff: { t: 'multi', list: [{ t: 'hesoPayPerm', v: 1 }, { t: 'luck', v: 0.15 }] } },
  { name: '百獣覚醒',   family: '覚醒役', tier: 'フィーバー', need: [{ cat: 'animal', n: 2 }, { id: 'ryu', n: 1 }],       desc: '動物×2＋🐉龍 → 即FEVER突入＆+55玉',       eff: { t: 'multi', list: [{ t: 'feverStart' }, { t: 'coins', v: 55 }] } },
  { name: '天体覚醒',   family: '覚醒役', tier: '納品減', need: [{ cat: 'sky', n: 2 }, { id: 'taiyo', n: 1 }],          desc: '天体×2＋🌞太陽 → 納品-30%(その面だけ、次の面でリセット)', eff: { t: 'quotaCut', v: 0.30 } },
  { name: '財宝覚醒',   family: '覚醒役', tier: '固定大当り', need: [{ cat: 'treasure', n: 2 }, { id: 'crown', n: 1 }],     desc: '財宝×2＋👑王冠 → 一撃+1540玉(倍率は伸ばさない、その場の大金)', eff: { t: 'coins', v: 1540 } },
  { name: '博打覚醒',   family: '覚醒役', tier: '大振れ', need: [{ cat: 'luck', n: 2 }, { id: 'joker', n: 1 }],         desc: '博打×2＋🃏ジョーカー → +100〜20000玉(一撃勝負・運要素強め)', eff: { t: 'coinsRange', min: 100, max: 20000 } },
  { name: '宴覚醒',     family: '覚醒役', tier: 'コンボ', need: [{ cat: 'festival', n: 2 }, { id: 'shakudama', n: 1 }], desc: '祭×2＋🎆尺玉 → 残り全面「祭コンボ」有効化。3揃い/役が連チャンするたび倍率+0.4(最大+2.0)、2揃い/ハズレで途切れて0に戻る', eff: { t: 'comboActivate' } },
  { name: '絡繰覚醒',   family: '覚醒役', tier: '設置', need: [{ cat: 'tool', n: 2 }, { id: 'karakuri', n: 1 }],      desc: '仕掛×2＋🏯絡繰城 → 役物を1つ無料設置',   eff: { t: 'partGift', c: 42 } },
  // ══ 特殊役: 見た瞬間わかるアイコン級だけを6つ。滅多に出ないがめっちゃ跳ねる ══
  { name: '大当り777',   family: '大当り役', tier: '爆発', need: [{ id: 'seven', n: 3 }],                                desc: '７×3 → 超RUSH 10R',           eff: { t: 'rush', v: 10 } },
  { name: 'ラッキーセブン', family: '大当り役', tier: '爆発', need: [{ id: 'seven', n: 2 }, { id: 'clover', n: 1 }],     desc: '７🍀７ → 超RUSH 8R',          eff: { t: 'rush', v: 8 } },
  { name: '龍神降臨',   family: '大当り役', tier: '爆発', need: [{ id: 'ryu', n: 3 }],                                  desc: '🐉×3 → +2222玉×倍率',         eff: { t: 'coins', v: 2222 } },
  { name: '四神降臨',   family: '大当り役', tier: '爆発', need: [{ id: 'ryu', n: 1 }, { id: 'byakko', n: 1 }, { id: 'suzaku', n: 1 }, { id: 'genbu', n: 1 }], desc: '🐉🐅🦅🐢 → 超RUSH10R＆倍率+0.5', eff: { t: 'multi', list: [{ t: 'rush', v: 10 }, { t: 'mult', v: 0.5 }] } },
  { name: '王の財宝',   family: '大当り役', tier: '爆発', need: [{ id: 'kinbukuro', n: 1 }, { id: 'diamond', n: 1 }, { id: 'crown', n: 1 }], desc: '💰💎👑 → +1500玉', eff: { t: 'coins', v: 1500 } },
  { name: '金龍昇天',   family: '大当り役', tier: '倍率', need: [{ id: 'ryu', n: 2 }],                                  desc: '🐉×2 → 次の当たり×4',         eff: { t: 'nextMult', v: 4, n: 1 } },
];
// need判定ヘルパー(id=絵柄一致 / rarity=格一致[レジェンド枠等] / cat=カテゴリ一致)
function symMatchesNeed(id, nd) {
  if (nd.id) return id === nd.id;
  if (nd.rarity) return SYMBOLS[id] && SYMBOLS[id].rarity === nd.rarity;
  return SYMBOL_CAT[id] === nd.cat;
}
function needGlyph(nd) {
  if (nd.id) return SYMBOLS[nd.id] ? SYMBOLS[nd.id].glyph : '?';
  if (nd.rarity) return '🌟';
  return CAT_INFO[nd.cat] ? CAT_INFO[nd.cat].glyph : '?';
}
function needLabel(nd) {
  if (nd.id) return (SYMBOLS[nd.id] ? SYMBOLS[nd.id].glyph : '?') + (nd.n > 1 ? '×' + nd.n : '');
  if (nd.rarity) return '🌟レジェンド×' + nd.n;
  const ci = CAT_INFO[nd.cat] || { glyph: '?', name: '?' };
  return ci.glyph + ci.name + '×' + nd.n;
}
function recipeSlots(rc) { return rc.need.reduce((a, nd) => a + nd.n, 0); }
// 役の必要条件を「🍒果物×2 ＋ 🌟レジェンド」のように描く
function recipePatternHTML(rc) { return rc.need.map(needLabel).join(' ＋ '); }
// コンパクトな絵文字だけの並び(チップ/図鑑用)
function recipeGlyphs(rc) {
  let s = '';
  for (const nd of rc.need) { const gl = needGlyph(nd); for (let i = 0; i < nd.n; i++) s += gl; }
  return s;
}
// この絵柄(または同カテゴリ)がプールにあれば、そのneedに寄与しているか
function recipeAnyOwned(rc) {
  return rc.need.some(nd => Object.keys(S.symbolPool).some(id => S.symbolPool[id] > 0 && symMatchesNeed(id, nd)));
}
// 役の「直接玉」の基礎値(倍率適用前)を推定
function effBaseCoins(eff) {
  if (!eff) return 0;
  if (eff.t === 'coins') return eff.v;
  if (eff.t === 'coinsRange') return (eff.min + eff.max) / 2;
  if (eff.t === 'shots') return eff.c || 0;
  if (eff.t === 'thinDeck' || eff.t === 'rewriteHold') return eff.c || 0;
  if (eff.t === 'multi') return eff.list.reduce((s, e) => s + effBaseCoins(e), 0);
  return 0;
}
// 役が揃った時の「想定獲得球数」を現在の倍率合計・面で計算(倍率/RUSH役は効果表記)
function roleYieldText(rc) {
  const eff = rc.eff;
  if (eff.t === 'mult') return `倍率+${eff.v}`;
  if (eff.t === 'multMult') return `倍率×${eff.v}`;
  if (eff.t === 'nextMult') return `次の当たり×${eff.v}`;
  if (eff.t === 'rush') return `RUSH ${eff.v}R`;
  if (eff.t === 'ballsPct') return `持ち玉${Math.round(eff.v * 100)}%`;
  if (eff.t === 'joker') return 'ランダム超級';
  if (eff.t === 'partGift') return '役物を1つ設置';
  if (eff.t === 'feverStart') return '即FEVER突入';
  if (eff.t === 'hesoPayPerm') return `ヘソ賞球+${eff.v}(永続)`;
  if (eff.t === 'comboActivate') return '祭コンボ発動(連チャンで倍率UP)';
  // coinsRangeは平均値ではなく実際の乱数幅をそのまま見せる(中央値を「約N玉」と出すと誤解を招くため)
  if (eff.t === 'coinsRange') {
    const tot = effMult() * synergyMult() * (S.fever ? 2 : 1) * (S.winBoostN > 0 ? (S.winBoostV || 1) : 1);
    const scale = v => Math.round(v * tot * CFG.payScale * (1 + CFG.stageCoinRamp * ((S.stage || 1) - 1)));
    return `${scale(eff.min).toLocaleString()}〜${scale(eff.max).toLocaleString()}玉のランダム`;
  }
  // multi内の「丸ごと別の仕組みに変わる」系は、玉数の見積もりより先に見出しとして出す
  if (eff.t === 'multi') {
    const f = t => eff.list.find(e => e.t === t);
    if (f('multMult')) return `倍率×${f('multMult').v}`;
    if (f('mult')) return `倍率+${f('mult').v}`;
    if (f('rush')) return `RUSH ${f('rush').v}R`;
    if (f('partGift')) return '役物を1つ設置';
    if (f('feverStart')) return '即FEVER突入';
    if (f('hesoPayPerm')) return `ヘソ賞球+${f('hesoPayPerm').v}(永続)`;
  }
  const base = effBaseCoins(eff);
  if (base > 0) {
    const tot = effMult() * synergyMult() * (S.fever ? 2 : 1) * (S.winBoostN > 0 ? (S.winBoostV || 1) : 1);
    const scaled = Math.round(base * tot * CFG.payScale * (1 + CFG.stageCoinRamp * ((S.stage || 1) - 1)));
    return `約${scaled.toLocaleString()}玉`;
  }
  if (eff.t === 'multi') {
    const f = t => eff.list.find(e => e.t === t);
    if (f('shower')) return `玉シャワー${f('shower').v}発`;
    if (f('quotaCut')) return `納品-${Math.round(f('quotaCut').v * 100)}%`;
    if (f('luck')) return `運+${f('luck').v}`;
  }
  if (eff.t === 'shower') return `玉シャワー${eff.v}発`;
  if (eff.t === 'quotaCut') return `納品-${Math.round(eff.v * 100)}%`;
  return '';
}

function needSpecificity(nd) { return nd.id ? 2 : nd.rarity ? 1 : 0; }
function recipeReady(rc) {
  // 貪欲割当: 具体的なneed(絵柄>格>カテゴリ)から先に確保。龍=動物かつレジェンドの二重取りを防ぐ
  const avail = {};
  for (const id in S.symbolPool) if (S.symbolPool[id] > 0) avail[id] = S.symbolPool[id];
  const needs = [...rc.need].sort((a, b) => needSpecificity(b) - needSpecificity(a));
  for (const nd of needs) {
    let want = nd.n;
    for (const id in avail) {
      if (want <= 0) break;
      if (avail[id] > 0 && symMatchesNeed(id, nd)) { const t = Math.min(avail[id], want); avail[id] -= t; want -= t; }
    }
    if (want > 0) return false;
  }
  return true;
}

// ---------- 所持シナジー: 相性の良い組み合わせで相乗倍率(全獲得に乗算) ----------
const SYNERGIES = [
  { id: 'kinman',    name: '金満コンビ',       desc: '金玉＋金袋 → 全獲得+15%',                   mult: 1.15, symTags: ['kinbukuro'], cond: () => S.deck.includes('kin') && (S.symbolPool.kinbukuro || 0) > 0 },
  { id: 'tentai',    name: '天体観測',         desc: 'ムーン2枚以上＋スター → 全獲得+12%',        mult: 1.12, symTags: ['moon', 'star'], cond: () => (S.symbolPool.moon || 0) >= 2 && (S.symbolPool.star || 0) >= 1 },
  { id: 'hoshizora', name: '星降る夜空',       desc: '星系の玉＋星降る夜 → 全獲得+15%',           mult: 1.15, symTags: [], cond: () => (S.deck.includes('hoshi') || S.deck.includes('hoshikuzu')) && S.relics.some(r => r.id === 'hoshifuru') },
  { id: 'jiba',      name: '磁力発電',         desc: '磁石系の玉＋マグネットコイル → 全獲得+12%', mult: 1.12, symTags: [], cond: () => (S.deck.includes('jishaku') || S.deck.includes('denji') || S.deck.includes('blackhole')) && S.parts.some(p => p.id === 'magcoil') },
  { id: 'raijin',    name: '雷神',             desc: '雷玉＋イナズマ → 全獲得+15%',               mult: 1.15, symTags: ['inazuma'], cond: () => S.deck.includes('kaminari') && (S.symbolPool.inazuma || 0) > 0 },
  { id: 'garden',    name: '植物園',           desc: 'クローバー＋サクラ＋三つ葉 → 全獲得+12%',   mult: 1.12, symTags: ['clover', 'sakura', 'mitsuba'], cond: () => (S.symbolPool.clover || 0) > 0 && (S.symbolPool.sakura || 0) > 0 && (S.symbolPool.mitsuba || 0) > 0 },
  { id: 'fruits',    name: 'フルーツバスケット', desc: 'フルーツ4種をリールに → 全獲得+18%',      mult: 1.18, symTags: ['cherry', 'lemon', 'grape', 'suika'], cond: () => ['cherry', 'lemon', 'grape', 'suika'].every(id => (S.symbolPool[id] || 0) > 0) },
  { id: 'gambler',   name: 'ギャンブル狂',     desc: 'サイコロ＋おみくじ → 全獲得+12%',           mult: 1.12, symTags: ['saikoro', 'fortune'], cond: () => (S.symbolPool.saikoro || 0) > 0 && (S.symbolPool.fortune || 0) > 0 },
  { id: 'shichifuku',name: '七福神',           desc: 'セブン2枚以上＋七光玉 → 全獲得+20%',        mult: 1.2,  symTags: ['seven'], cond: () => (S.symbolPool.seven || 0) >= 2 && S.deck.includes('nanahikari') },
  { id: 'daikazoku', name: '大家族',           desc: '分裂系の玉＋分裂フィールド → 全獲得+15%',   mult: 1.15, symTags: [], cond: () => (S.deck.includes('futago') || S.deck.includes('bunshin')) && S.parts.some(p => p.id === 'splitter') },
  { id: 'oushitsu',  name: '王室御用達',       desc: '王冠＋純金の玉箱 → 全獲得+25%',             mult: 1.25, symTags: ['crown'], cond: () => (S.symbolPool.crown || 0) > 0 && S.relics.some(r => r.id === 'kinbako') },
  { id: 'nijibashi', name: '虹の橋',           desc: '虹系の玉＋虹 → 全獲得+15%',                 mult: 1.15, symTags: ['nijiiro'], cond: () => (S.deck.includes('niji') || S.deck.includes('kenja')) && (S.symbolPool.nijiiro || 0) > 0 },
];

// 選択カード用: この絵柄のカテゴリ＋絡む特殊役・シナジーを書き出す(カテゴリ制で分かりやすく)
function symbolRoleTagsHTML(id) {
  const cat = SYMBOL_CAT[id];
  const recs = RECIPES.filter(rc => rc.need.some(nd => symMatchesNeed(id, nd)));
  const syns = SYNERGIES.filter(sy => (sy.symTags || []).includes(id));
  let rows = '';
  if (cat && CAT_INFO[cat]) rows += `<div class="rt cat"><b>${CAT_INFO[cat].glyph} ${CAT_INFO[cat].name}カテゴリ</b></div>`;
  for (const rc of recs.slice(0, 6)) {
    rows += `<div class="rt rec"><b>🎴${rc.name}</b> <span class="rc">${recipePatternHTML(rc)}</span> <span class="ry">→ ${roleYieldText(rc)}</span></div>`;
  }
  for (const sy of syns) {
    rows += `<div class="rt syn"><b>🔗${sy.name}</b> ${sy.desc}</div>`;
  }
  if (!rows) return '';
  return `<div class="roleTags"><div class="rth">この絵柄で狙える役</div>${rows}</div>`;
}

let SYNcache = null;
function synDirty() { SYNcache = null; }
function activeSynergies() {
  if (!SYNcache) SYNcache = SYNERGIES.filter(sy => sy.cond());
  return SYNcache;
}
function synergyMult() {
  let m = 1;
  for (const sy of activeSynergies()) m *= sy.mult;
  return m;
}
// 選択候補を「今の手持ち」に仮に足したら、新たに成立するシナジーを返す(選ぶ瞬間の指針)
function synergiesGainedBy(card) {
  if (!card) return [];
  const before = new Set(SYNERGIES.filter(sy => sy.cond()).map(sy => sy.id));
  let undo = null;
  if (card.kind === 'ball') { S.deck.push(card.id); undo = () => S.deck.pop(); }
  else if (card.kind === 'symbol') { const orig = S.symbolPool[card.id]; S.symbolPool[card.id] = (orig || 0) + 1; undo = () => { if (orig == null) delete S.symbolPool[card.id]; else S.symbolPool[card.id] = orig; }; }
  else if (card.kind === 'relic') { S.relics.push(card.rel || { id: card.id, fx: {} }); undo = () => S.relics.pop(); }
  else if (card.kind === 'part') { S.parts.push({ id: card.id }); undo = () => S.parts.pop(); }
  else return [];
  const gained = SYNERGIES.filter(sy => !before.has(sy.id) && sy.cond());
  undo();
  return gained;
}
// 選択カード/確認に載せる「手持ちと組んで成立するシナジー」表示
function synergyGainHTML(card, compact) {
  const g = synergiesGainedBy(card);
  if (!g.length) return '';
  if (compact) return `<div class="synGain">🔗 シナジー成立 ${g.map(s => s.name).join('・')}</div>`;
  return `<div class="synGain full"><div class="sgh">🔗 手持ちと組んでシナジー成立！</div>` +
    g.map(s => `<div class="sgr"><b>${s.name}</b><span class="m">全獲得×${s.mult}</span><div class="sgd">${s.desc}</div></div>`).join('') + `</div>`;
}
function checkSynergies(prev) {
  synDirty();
  const now = activeSynergies();
  const news = now.filter(sy => !prev.some(p => p.id === sy.id));
  for (const sy of news) {
    markDex('syn', sy.id);
    addLog(`🔗 シナジー成立「${sy.name}」 ×${sy.mult}`, 'hit');
    if (!S.simMode) { fx.cutin(`シナジー「${sy.name}」！`, true); sfx('bigwin'); fx.confettiBurst(40); }
  }
}

// ---------- 玉の種類(fxデータ駆動) ----------
// fx: r/gMul/jit/rest/magnet/payMult/spinLuck/tulipMult/pinCoinCap/drainCoins/
//     drainBlast/splitOnPin/hesoCoins/hesoShower/ghost/doubleHold/biasSym+biasMult/
//     quickNext/onWinMult/pullOthers/rainbow/sparkle/zap
const BALLS = {
  shiro:    { name: '白玉',   color: '#e8ede9', trail: '#ffffff44', rarity: 'normal', desc: 'ふつうの玉。屋台で間引ける。', fx: {} },
  // ---- ノーマル ----
  jishaku:  { name: '磁石玉',   color: '#5eb0ff', trail: '#5eb0ff66', rarity: 'normal', desc: 'ヘソに吸い寄せられる。', fx: { magnet: 2.2 } },
  futago:   { name: '双子玉',   color: '#ff9ecb', trail: '#ff9ecb55', rarity: 'normal', desc: '最初の釘ヒットで2つに分裂する。', fx: { splitOnPin: 1 } },
  bakudan:  { name: '爆弾玉',   color: '#ff7043', trail: '#ff704355', rarity: 'normal', desc: 'アウトで爆発: +12玉＆周囲を吹き飛ばす。', fx: { drainCoins: 12, drainBlast: 1 } },
  hoshi:    { name: '星玉',     color: '#fde047', trail: '#fde04755', rarity: 'normal', desc: 'チューリップ賞球3倍。星を撒く。', fx: { tulipMult: 3, sparkle: 1 } },
  yuki:     { name: '雪玉',     color: '#e0f2fe', trail: '#e0f2fe66', rarity: 'normal', desc: '釘に当たるたび+1玉(最大12)。', fx: { pinCoinCap: 12 } },
  akagane:  { name: '銅玉',     color: '#e8a87c', trail: '#e8a87c44', rarity: 'normal', desc: 'ヘソ賞球+2玉。', fx: { hesoCoins: 2 } },
  kokedama: { name: '苔玉',     color: '#9ccc65', trail: '#9ccc6544', rarity: 'normal', desc: 'チューリップ賞球2倍。', fx: { tulipMult: 2 } },
  biidama:  { name: 'ビー玉',   color: '#80deea', trail: '#80deea55', rarity: 'normal', desc: 'きれい。ちょっとだけ運がいい。', fx: { spinLuck: 1.1 } },
  koban:    { name: '小判玉',   color: '#e6c96e', trail: '#e6c96e44', rarity: 'normal', desc: 'どこに消えても+2玉。', fx: { drainCoins: 2 } },
  // ---- 色共鳴玉: 同じ色系統の絵柄で当たると、その当たりに倍率が乗る(ビルド相乗の軸) ----
  guren:    { name: '紅蓮玉',   color: '#ff6b6b', trail: '#ff6b6b55', rarity: 'normal', desc: '赤系絵柄(🍒🍉７🎯🎇)の当たり×1.55。', fx: { colorSyn: 'red', colorMult: 1.55 } },
  yamabuki: { name: '山吹玉',   color: '#f6c945', trail: '#f6c94555', rarity: 'normal', desc: '金系絵柄(🔔🍋🪙🥠💰⭐🔑👑🌞)の当たり×1.45。', fx: { colorSyn: 'gold', colorMult: 1.45 } },
  hisui:    { name: '翡翠玉',   color: '#6fdd8b', trail: '#6fdd8b55', rarity: 'normal', desc: '緑系絵柄(🍀☘️🏠)の当たり×1.7。', fx: { colorSyn: 'green', colorMult: 1.7 } },
  shion:    { name: '紫苑玉',   color: '#b98af0', trail: '#b98af055', rarity: 'normal', desc: '紫系絵柄(🍇🌙🔮🃏)の当たり×1.65。', fx: { colorSyn: 'purple', colorMult: 1.65 } },
  soukai:   { name: '蒼海玉',   color: '#58c7f0', trail: '#58c7f055', rarity: 'normal', desc: '青系絵柄(💎⚡💫🐉)の当たり×1.7。', fx: { colorSyn: 'blue', colorMult: 1.7 } },
  touka:    { name: '桃花玉',   color: '#ffa6c9', trail: '#ffa6c955', rarity: 'normal', desc: '桃系絵柄(🌸🎈🐷🦄🎁)の当たり×1.55。', fx: { colorSyn: 'pink', colorMult: 1.55 } },
  prism:    { name: 'プリズム玉', color: '#e8f4ff', trail: '#e8f4ff66', rarity: 'normal', desc: 'どの色系統の絵柄でも当たり×1.25。', fx: { colorSyn: 'any', colorMult: 1.25 } },
  // ---- レア ----
  kin:      { name: '金玉',     color: '#f5c542', trail: '#f5c54266', rarity: 'rare', desc: 'この玉が起こした獲得が2倍。', fx: { payMult: 2 } },
  niji:     { name: '虹玉',     color: '#c084fc', trail: '#c084fc66', rarity: 'rare', desc: 'この玉の抽選は運2倍。虹の尾。', fx: { spinLuck: 2, rainbow: 1 } },
  kaminari: { name: '雷玉',     color: '#a5f3fc', trail: '#a5f3fc77', rarity: 'rare', desc: 'ヘソ入賞で落雷+35玉。', fx: { hesoCoins: 35, zap: 1 } },
  gin:      { name: '銀玉',     color: '#dfe6e9', trail: '#dfe6e966', rarity: 'rare', desc: 'この玉が起こした獲得が1.5倍。', fx: { payMult: 1.5 } },
  yurei:    { name: '幽霊玉',   color: '#b5c9d6', trail: '#b5c9d633', rarity: 'rare', desc: '釘を時々すり抜ける。', fx: { ghost: 0.13 } },
  bunshin:  { name: '分身玉',   color: '#ffa8d9', trail: '#ffa8d955', rarity: 'rare', desc: '2回まで分裂する。', fx: { splitOnPin: 2 } },
  kayaku:   { name: '火薬玉',   color: '#ff5722', trail: '#ff572266', rarity: 'rare', desc: '大爆発: +20玉＆強烈な衝撃波。', fx: { drainCoins: 20, drainBlast: 1.8 } },
  tanedama: { name: '種玉',     color: '#aed581', trail: '#aed58155', rarity: 'rare', desc: '釘ヒットごと+1玉(最大20)。', fx: { pinCoinCap: 20 } },
  denji:    { name: '電磁玉',   color: '#40c4ff', trail: '#40c4ff77', rarity: 'rare', desc: '強力にヘソへ吸い付く。', fx: { magnet: 3.4 } },
  gekko:    { name: '月光玉',   color: '#d1c4e9', trail: '#d1c4e955', rarity: 'rare', desc: 'この玉で3揃いすると倍率+0.05。', fx: { onWinMult: 0.05 } },
  nanahikari:{ name: '七光玉',  color: '#ff8a80', trail: '#ff8a8066', rarity: 'rare', desc: 'この玉の抽選は７が揃いやすい。', fx: { biasSym: 'seven', biasMult: 3 } },
  shunsoku: { name: '俊足玉',   color: '#b2ff59', trail: '#b2ff5955', rarity: 'rare', desc: 'この玉の直後、即座に次弾が出る。', fx: { quickNext: 1 } },
  horyudama:{ name: '保留玉',   color: '#69f0ae', trail: '#69f0ae55', rarity: 'rare', desc: 'ヘソ入賞で保留が2個貯まる。', fx: { doubleHold: 1 } },
  // ---- レジェンド ----
  kenja:    { name: '賢者の玉', color: '#e1bee7', trail: '#e1bee777', rarity: 'legend', desc: 'この玉の抽選は運3倍。', fx: { spinLuck: 3, rainbow: 1 } },
  kotei:    { name: '皇帝玉',   color: '#ffd54f', trail: '#ffd54f77', rarity: 'legend', desc: 'この玉が起こした獲得が3倍。', fx: { payMult: 3 } },
  blackhole:{ name: 'ブラックホール玉', color: '#7e57c2', trail: '#7e57c277', rarity: 'legend', desc: '周囲の玉ごとヘソへ引きずり込む。', fx: { magnet: 4, pullOthers: 1 } },
  kozuchi:  { name: '打ち出の小槌玉', color: '#ff8f5e', trail: '#ffab9166', rarity: 'legend', desc: 'どこに消えても+30玉。', fx: { drainCoins: 30 } },
  hoshikuzu:{ name: '星屑玉',   color: '#fff59d', trail: '#fff59d77', rarity: 'legend', desc: 'ヘソ入賞でミニ玉シャワー3発。', fx: { hesoShower: 3, sparkle: 1 } },
};

// ---------- お守り(レアリティ制) ----------
const RELICS = [
  // ---- ノーマル ----
  { id: 'kuginuki',  rarity: 'normal', icon: '🔧', name: '釘師への賄賂', desc: 'ヘソ上の邪魔釘2本が消える', fx: { removePins: 2 } },
  { id: 'dedama',    rarity: 'normal', icon: '💰', name: '出玉増量弁',   desc: 'RUSH賞球 +5玉',            fx: { attackerPay: 5 } },
  { id: 'tamakashi', rarity: 'normal', icon: '🎫', name: '玉貸しカード', desc: '各面の発射数 +30発',        fx: { shotsAdd: 30 } },
  { id: 'fusha',     rarity: 'normal', icon: '🌀', name: '金の風車',     desc: '風車が玉を中央へ送る',      fx: { windmillBias: 1 } },
  { id: 'hoyru',     rarity: 'normal', icon: '🟢', name: '濃い保留',     desc: '保留上限 +2',              fx: { holdAdd: 2 } },
  { id: 'amedama',   rarity: 'normal', icon: '🍬', name: '飴玉',         desc: 'ヘソ賞球 +1玉',            fx: { hesoPayAdd: 1 } },
  { id: 'zabuton',   rarity: 'normal', icon: '🪑', name: '古い座布団',   desc: '各面の発射数 +15発',        fx: { shotsAdd: 15 } },
  { id: 'manekineko',rarity: 'normal', icon: '🐱', name: '招き猫の置物', desc: '運 +0.2',                  fx: { luckAdd: 0.2 } },
  { id: 'waribiki',  rarity: 'normal', icon: '🎟️', name: '割引券',       desc: '屋台の価格 -10%',          fx: { shopDiscount: 0.1 } },
  { id: 'tulipseed', rarity: 'normal', icon: '🌷', name: 'チューリップの種', desc: 'チューリップ賞球 +3玉', fx: { tulipPayAdd: 3 } },
  { id: 'suberidome',rarity: 'normal', icon: '🧤', name: '滑り止め',     desc: '発射のブレが半分になる',    fx: { aimSteady: 0.5 } },
  { id: 'tamabako',  rarity: 'normal', icon: '📥', name: '予備の玉箱',   desc: '各面開始時 +40玉',          fx: { periodBalls: 40 } },
  { id: 'egao',      rarity: 'normal', icon: '😊', name: '店員の笑顔',   desc: '納品額 -4%',               fx: { quotaMult: 0.96 } },
  { id: 'speaker',   rarity: 'normal', icon: '📻', name: '中古スピーカー', desc: '2揃い率 +3%',            fx: { twoMatchAdd: 0.03 } },
  { id: 'sabikougu', rarity: 'normal', icon: '🪛', name: '錆びた工具',   desc: '邪魔釘1本が消える',         fx: { removePins: 1 } },
  { id: 'neonkan',   rarity: 'normal', icon: '💡', name: 'ネオン管',     desc: '3揃いのたび +15玉',         fx: { bonusPerWin: 15 } },
  { id: 'shippu',    rarity: 'normal', icon: '🩹', name: '湿布',         desc: 'RUSH継続率 +5%',           fx: { renchanAdd: 0.05 } },
  { id: 'gunte',     rarity: 'normal', icon: '🧤', name: '軍手',         desc: 'RUSH賞球 +2玉',            fx: { attackerPay: 2 } },
  { id: 'mamedenkyu',rarity: 'normal', icon: '🔅', name: '豆電球',       desc: '保留上限 +1',              fx: { holdAdd: 1 } },
  { id: 'caffeine',  rarity: 'normal', icon: '☕', name: 'カフェイン',   desc: '発射間隔 -8%',             fx: { fireFast: 0.92 } },
  { id: 'ashioki',   rarity: 'normal', icon: '🦶', name: '足置き',       desc: '各面の発射数 +20発',        fx: { shotsAdd: 20 } },
  { id: 'ocha',      rarity: 'normal', icon: '🍵', name: 'お茶',         desc: '各面開始時 +30玉',          fx: { periodBalls: 30 } },
  { id: 'mimisen',   rarity: 'normal', icon: '🎧', name: '耳栓',         desc: 'リール回転が15%速い',       fx: { spinFast: 0.85 } },
  { id: 'ema',       rarity: 'normal', icon: '🪧', name: '埃かぶった絵馬', desc: '運 +0.25',               fx: { luckAdd: 0.25 } },
  { id: 'fuseki',    rarity: 'normal', icon: '⚪', name: '布石',         desc: '2揃い率+2%＆運+0.1',        fx: { twoMatchAdd: 0.02, luckAdd: 0.1 } },
  // ---- レア ----
  { id: 'dekaheso',  rarity: 'rare', icon: '🎯', name: 'デカヘソ',       desc: 'ヘソの幅 +30%',            fx: { hesoMult: 1.3 } },
  { id: 'roundplus', rarity: 'rare', icon: '➕', name: '追加ラウンド',   desc: 'RUSH +2R',                 fx: { roundsAdd: 2 } },
  { id: 'renchan',   rarity: 'rare', icon: '🔥', name: '連チャン体質',   desc: 'RUSH継続率 +15%',          fx: { renchanAdd: 0.15 } },
  { id: 'risoku',    rarity: 'rare', icon: '🏦', name: '闇口座の利息',   desc: '納品後、残り玉の6%が配当',  fx: { interest: 0.06 } },
  { id: 'negiri',    rarity: 'rare', icon: '🤝', name: '値切りの心得',   desc: '全ての納品額 -10%',         fx: { quotaMult: 0.9 } },
  { id: 'shiori',    rarity: 'rare', icon: '🔖', name: '四つ葉の栞',     desc: '運 +0.6',                  fx: { luckAdd: 0.6 } },
  { id: 'mangetsu',  rarity: 'rare', icon: '🌕', name: '満月の写真',     desc: '倍率 +0.2',                fx: { multAdd: 0.2 } },
  { id: 'rashinban', rarity: 'rare', icon: '🧭', name: '磁北の羅針盤',   desc: '全ての玉に弱い磁力',        fx: { magnetAll: 0.6 } },
  { id: 'uchidome',  rarity: 'rare', icon: '♾️', name: '打ち止め知らず', desc: '各面の発射数 +45発',        fx: { shotsAdd: 45 } },
  { id: 'keihin',    rarity: 'rare', icon: '🧺', name: '総付景品',       desc: '各面開始時 +120玉',         fx: { periodBalls: 120 } },
  { id: 'uraROM',    rarity: 'rare', icon: '💾', name: '裏ROM',          desc: '3揃い率 +20%',             fx: { winLMult: 1.2 } },
  { id: 'refill',    rarity: 'rare', icon: '🔋', name: '保留リフィル',   desc: '保留上限 +2',              fx: { holdAdd: 2 } },
  { id: 'kintsuchi', rarity: 'rare', icon: '⚒️', name: '黄金の釘抜き',   desc: '邪魔釘3本が消える',         fx: { removePins: 3 } },
  { id: 'valve',     rarity: 'rare', icon: '🚰', name: '出玉バルブ',     desc: 'RUSH賞球 +6玉',            fx: { attackerPay: 6 } },
  { id: 'overkill',  rarity: 'rare', icon: '🎳', name: 'オーバー入賞のコツ', desc: 'RUSHのカウント +2個',   fx: { roundCountAdd: 2 } },
  { id: 'yuujou',    rarity: 'rare', icon: '🫂', name: '熱い友情',       desc: 'RUSH継続率 +12%',          fx: { renchanAdd: 0.12 } },
  { id: 'tsuucho',   rarity: 'rare', icon: '📒', name: '闇金の通帳',     desc: '納品後、残り玉の8%が配当',  fx: { interest: 0.08 } },
  { id: 'kaopasu',   rarity: 'rare', icon: '🪪', name: '顔パス',         desc: '納品額 -12%',              fx: { quotaMult: 0.88 } },
  { id: 'ubaguruma', rarity: 'rare', icon: '👶', name: '双子の乳母車',   desc: '全ての玉が5%で分裂する',    fx: { splitChance: 0.05 } },
  { id: 'saisen',    rarity: 'rare', icon: '⛩️', name: '賽銭箱',         desc: 'ハズレ玉が6%で+2玉返す',    fx: { drainCoinChance: 0.06 } },
  { id: 'coating',   rarity: 'rare', icon: '🧲', name: '磁気コーティング', desc: '全ての玉に磁力',         fx: { magnetAll: 1.0 } },
  { id: 'hatake',    rarity: 'rare', icon: '🌷', name: 'チューリップ畑', desc: 'チューリップ賞球 +5玉',     fx: { tulipPayAdd: 5 } },
  { id: 'hayauchi',  rarity: 'rare', icon: '🤠', name: '早撃ちグローブ', desc: '発射間隔 -15%',            fx: { fireFast: 0.85 } },
  { id: 'wazamono',  rarity: 'rare', icon: '📌', name: '業物の命釘',     desc: 'ヘソの幅 +20%',            fx: { hesoMult: 1.2 } },
  { id: 'hosuu',     rarity: 'rare', icon: '🎪', name: '福引補助券',     desc: '面クリア後のごほうびに、レアが出やすくなる(+8%)',     fx: { rareBias: 0.08 } },
  // ---- レジェンド ----
  { id: 'kamiwaza',  rarity: 'legend', icon: '🙏', name: '大当たりの神', desc: '3揃い率 +40%',             fx: { winLMult: 1.4 } },
  { id: 'kinbako',   rarity: 'legend', icon: '🧰', name: '純金の玉箱',   desc: '全ての玉獲得 +15%',         fx: { allGainMult: 1.15 } },
  { id: 'eikyu',     rarity: 'legend', icon: '⚙️', name: '永久機関',     desc: '発射玉が10%でタダになる',   fx: { freeBallChance: 0.1 } },
  { id: 'tenjo',     rarity: 'legend', icon: '🚀', name: '天井知らず',   desc: 'RUSH +4R',                 fx: { roundsAdd: 4 } },
  { id: 'tamashii',  rarity: 'legend', icon: '👻', name: '確変の魂',     desc: 'RUSH継続率 +25%',          fx: { renchanAdd: 0.25 } },
  { id: 'daifugo',   rarity: 'legend', icon: '💳', name: '大富豪の口座', desc: '納品後、残り玉の15%が配当', fx: { interest: 0.15 } },
  { id: 'koushounin',rarity: 'legend', icon: '🕴️', name: '立ち退き交渉人', desc: '全ての納品額 -25%',      fx: { quotaMult: 0.75 } },
  { id: 'hoshifuru', rarity: 'legend', icon: '🌠', name: '星降る夜',     desc: 'RUSH終了ごとに玉シャワー10発', fx: { showerOnRush: 10 } },
  { id: 'buildsoul', rarity: 'legend', icon: '🛠️', name: 'デッキビルダーの魂', desc: '面クリア後のごほうびに、レアが出やすくなる(+20%)', fx: { rareBias: 0.2 } },
  { id: 'amadeji',   rarity: 'legend', icon: '🍬', name: '幻の甘デジ',   desc: 'ヘソの幅 +45%',            fx: { hesoMult: 1.45 } },
];
// ---------- 盤面役物パーツ(第4のビルド軸) ----------
const PARTS = {
  bumper:    { name: 'バンパー',         rarity: 'normal', icon: '🔴', type: 'bumper', pay: 1, boost: 330, desc: '玉を強烈に弾き返す。ヒットごと+1玉' },
  minitulip: { name: 'ミニチューリップ', rarity: 'normal', icon: '🌷', type: 'pocket', pay: 8, desc: '小さな入賞口: +8玉。FEVERゲージ(チューリップ20)も速く貯まる' },
  fusha2:    { name: '追加風車',         rarity: 'normal', icon: '🌀', type: 'windmill', desc: '玉を掻き回す風車を増設' },
  jumper:    { name: 'ジャンプ台',       rarity: 'normal', icon: '📐', type: 'jumper', desc: '乗った玉を中央上空へ打ち上げる' },
  bellpock:  { name: 'ベルポケット',     rarity: 'normal', icon: '🔔', type: 'pocket', pay: 5, shotChance: 0.35, desc: '+5玉、35%で発射数+1' },
  warp:      { name: 'ワープゲート',     rarity: 'rare',  icon: '🌌', type: 'warp', desc: '入った玉をヘソ上空へ転送する' },
  spinchakka:{ name: 'スピンチャッカー', rarity: 'rare',  icon: '🎰', type: 'pocket', pay: 6, spinChance: 0.35, desc: '+6玉、35%で追加抽選(保留+1)' },
  bonuspock: { name: 'ボーナスポケット', rarity: 'rare',  icon: '💰', type: 'pocket', pay: 30, narrow: true, desc: '狭い。だが入れば+30玉' },
  magcoil:   { name: 'マグネットコイル', rarity: 'rare',  icon: '🧲', type: 'magnet', desc: '周囲の玉を吸い寄せて下へ流す' },
  goldbump:  { name: '黄金バンパー',     rarity: 'legend', icon: '🥇', type: 'bumper', pay: 4, boost: 360, desc: '弾くたび+4玉の暴力装置' },
  vchakka:   { name: 'Vチャッカー',      rarity: 'legend', icon: '🅥', type: 'vpocket', desc: '入賞した瞬間ミニRUSH 2R発動！' },
  splitter:  { name: '分裂フィールド',   rarity: 'legend', icon: '✨', type: 'splitter', desc: '通過した玉が分裂する魔空間' },
};
// 大型液晶(BLOCK x112-348,y96-284)を避け、かつヘソ中央の導線を潰さぬよう左右へ配置
const PART_SLOTS = [
  { x: 58, y: 342 }, { x: 402, y: 342 },
  { x: 150, y: 352 }, { x: 310, y: 352 },
  { x: 95, y: 430 }, { x: 365, y: 430 },
];
function freeSlots() {
  return PART_SLOTS.filter(sl => !S.parts.some(p => p.x === sl.x && p.y === sl.y));
}
function installPartAt(id, sl) {
  const def = PARTS[id];
  S.parts.push({ id, ...def, x: sl.x, y: sl.y, dir: rng() < 0.5 ? 1 : -1, ang: 0, flash: 0 });
  markDex('part', id);
  refreshPins();
  addLog(`盤面に「${def.name}」を設置`, 'hit');
  return true;
}
function installPart(id) { // ランダム設置(sim/フォールバック用)
  const slots = freeSlots();
  if (slots.length === 0) return false;
  return installPartAt(id, pick(slots));
}
// 釘の再構成: お守りの釘抜き + 役物周辺のクリアランス
function refreshPins() {
  applyRemovedPins();
  for (const pt of S.parts) {
    for (const p of BOARD.pins) {
      // バンパーr12/風車r14と釘の間に玉(径11px)が挟まらないクリアランス
      if (!p.key && dist(p.x, p.y, pt.x, pt.y) < 31) p.alive = false;
    }
  }
}
// 役物パーツの物理
function handleParts(b, dt, m) {
  for (const pt of S.parts) {
    const dx = b.x - pt.x, dy = b.y - pt.y;
    if (dx > 90 || dx < -90 || dy > 90 || dy < -90) continue;
    switch (pt.type) {
      case 'bumper': {
        const d2 = dx * dx + dy * dy, min = b.r + 12;
        if (d2 < min * min && d2 > 0) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          b.x = pt.x + nx * min; b.y = pt.y + ny * min;
          b.vx = nx * pt.boost; b.vy = ny * pt.boost * 0.85;
          pt.flash = 1;
          const got = gainBalls(pt.pay, b, false);
          if (!S.simMode) {
            fx.spark(pt.x, pt.y, '#ff6b81', 6);
            fx.floatText(pt.x, pt.y - 20, `+${got}`, '#ff6b81');
          }
          sfx('two');
        }
        break;
      }
      case 'windmill': {
        if (Math.abs(dx) > 22 || Math.abs(dy) > 22) break;
        if (collideCircle(b, pt.x, pt.y, 14, 0.5, false)) {
          const d = dist(b.x, b.y, pt.x, pt.y) || 1;
          b.vx += -((b.y - pt.y) / d) * pt.dir * 130;
          b.vy += ((b.x - pt.x) / d) * pt.dir * 130;
          sfx('tick');
        }
        break;
      }
      case 'pocket': {
        const hw = pt.narrow ? 7 : 11;
        if (Math.abs(dx) < hw && dy > -4 && dy < 12 && b.vy > 0) {
          b.dead = true;
          const got = gainBalls(pt.pay, b, false);
          pt.flash = 1;
          if (pt.id === 'minitulip') chargeFever(1); // 🌷ミニチューリップ20ヒットでFEVER
          if (pt.shotChance && rng() < pt.shotChance) S.shotsLeft += 1;
          if (pt.spinChance && rng() < pt.spinChance) {
            const max = CFG.holdMax + m.holdAdd;
            if (S.hold.length < max) { S.hold.push({ ball: b.type, out: decideOutcome(b.type), hint: null }); tryStartSpin(); }
          }
          if (!S.simMode) {
            fx.spark(pt.x, pt.y, '#ffd166', 8);
            fx.floatText(pt.x, pt.y - 18, `+${got}`, '#ffd166');
          }
          sfx('tulip');
          updateHUD();
        }
        break;
      }
      case 'vpocket': {
        if (Math.abs(dx) < 8 && dy > -4 && dy < 12 && b.vy > 0 && !S.rush && !S.spin) {
          b.dead = true;
          pt.flash = 1;
          if (!S.simMode) { fx.cutin('V！！'); sfx('jackpot'); }
          startRush(2, 'V');
          updateHUD();
        }
        break;
      }
      case 'warp': {
        if (Math.abs(dx) < 11 && Math.abs(dy) < 11 && (b.warpCd || 0) <= 0) {
          b.x = 230 + (rng() - 0.5) * 80;
          b.y = 480;
          b.vx = (rng() - 0.5) * 60; b.vy = Math.abs(b.vy) * 0.2 + 30;
          b.warpCd = 1;
          pt.flash = 1;
          if (!S.simMode) { fx.ring(pt.x, pt.y, '#c084fc'); fx.ring(b.x, b.y, '#c084fc'); }
          sfx('zap');
        }
        break;
      }
      case 'magnet': {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 85 && d > 4) {
          b.vx += (-dx / d) * 210 * dt;
          b.vy += (-dy / d) * 80 * dt + 60 * dt;
        }
        break;
      }
      case 'splitter': {
        if (Math.abs(dx) < 26 && Math.abs(dy) < 26 && !b.splitP && !b.free) {
          b.splitP = true; // 判定は1玉1回、発動は40%
          if (rng() < 0.4) {
            fireBall(0, { free: true, type: 'shiro', x: b.x + 6, y: b.y - 6, vx: -b.vx * 0.7, vy: -50 });
            pt.flash = 1;
            if (!S.simMode) { fx.spark(pt.x, pt.y, '#f0f0ff', 10); fx.floatText(pt.x, pt.y - 20, '分裂!', '#f0f0ff'); }
          }
        }
        break;
      }
      case 'jumper': {
        if (Math.abs(dx) < 16 && dy > -2 && dy < 10 && b.vy > 0) {
          b.jumps = (b.jumps || 0) + 1;
          if (b.jumps <= 5) { // 6回目以降は反応しない(無限ジャンプ保険)
            // 中央スロット(x=230)だとsignが0になり真上ループするので左右ランダムに逃がす
            const jdir = Math.abs(230 - pt.x) < 4 ? (rng() < 0.5 ? -1 : 1) : Math.sign(230 - pt.x);
            b.vy = -270;
            b.vx = jdir * (90 + rng() * 60);
            pt.flash = 1;
            sfx('tick');
          }
        }
        break;
      }
    }
    if (b.dead) return;
  }
  if (b.warpCd > 0) b.warpCd -= dt;
}
// 揃い「格」ペナルティ: 強い絵柄ほど1回転で揃いにくい(=積んで初めて出る)
const RARITY_ALIGN = { normal: 1.0, rare: 0.30, legend: 0.12 };
const RARITY_LABEL = { normal: 'NORMAL', rare: 'RARE', legend: 'LEGEND' };
const RARITY_COLOR = { normal: '#9aa49d', rare: '#38c8ff', legend: '#ff4dff' };
const RARITY_PRICE = { normal: 170, rare: 320, legend: 560 };

// ---------- 状態 ----------
const S = {
  phase: 'title',            // title | play | draft | shop | over | clear
  stage: 1, theme: THEMES[0],
  loop: 0,                   // 周回(0=1周目)。周が進むほどノルマ+22%＆釘シブめ
  allUnlock: false,          // ボット計測用: 全絵柄解禁扱い
  balls: 0, quota: 0, shotsLeft: 0,
  deck: [], bag: [],
  symbolPool: {}, relics: [], parts: [],
  luck: 1, mult: 1, hesoPayPerm: 0, magnetPulse: 0, lastFiredType: 'shiro',
  winBoostV: 1, winBoostN: 0, winBoostThis: 1, winBoostGranted: false, // 役倍率(nextMult)の保持状態
  hold: [], spin: null, rush: null,
  ballsOnBoard: [],
  power: 0.62, targetPower: 0.62, autoAim: true, fireCd: 0,
  rightHit: false,           // 右打ちモード(左レールから右へ打ち出す)
  speed: 1, sndOn: true,
  shower: 0, showerCd: 0,    // 玉シャワー残数(ゲーム内時間で消化)
  aimBins: Array.from({ length: 8 }, () => ({ shots: 0, heso: 0 })),
  particles: [], floats: [], rings: [], coins: [], confetti: [], ambient: [], rockets: [],
  coinRain: [], celebrate: null, rushWon: 0,
  fever: null, feverGauge: 0,      // FEVER TIME(脳汁ゲージ)
  shake: 0, boardFlash: 0,
  fxMax: true, timeScale: 1, tsTimer: 0, aberr: 0, glitchT: 0,
  cam: { z: 1, py: 390, punch: 0, rot: 0 },
  stat: { shots: 0, heso: 0, wins: 0, rush: 0, totalWon: 0, paid: 0 },
  simMode: false, time: 0, lastDigits: null,
};

// ---------- 実効値(キャッシュ付き) ----------
let MODcache = null;
function modsDirty() { MODcache = null; }
function mods() {
  if (MODcache) return MODcache;
  const m = {
    hesoMult: 1, removePins: 0, attackerPay: 0, roundsAdd: 0, roundCountAdd: 0,
    renchanAdd: 0, interest: 0, shotsAdd: 0, quotaMult: 1, windmillBias: 0, holdAdd: 0,
    hesoPayAdd: 0, tulipPayAdd: 0, winLMult: 1, twoMatchAdd: 0, fireFast: 1, spinFast: 1,
    shopDiscount: 0, draftExtra: 0, rareBias: 0, magnetAll: 0, splitChance: 0, drainCoinChance: 0,
    bonusPerWin: 0, allGainMult: 1, freeBallChance: 0, showerOnRush: 0,
    luckAdd: 0, multAdd: 0, periodBalls: 0, aimSteady: 1,
  };
  const MUL = ['hesoMult', 'quotaMult', 'winLMult', 'fireFast', 'spinFast', 'allGainMult', 'aimSteady'];
  for (const r of S.relics) {
    for (const [k, v] of Object.entries(r.fx)) {
      if (MUL.includes(k)) m[k] *= v;
      else m[k] += v;
    }
  }
  m.shopDiscount = Math.min(m.shopDiscount, 0.5);
  m.freeBallChance = Math.min(m.freeBallChance, 0.5);
  m.interest = Math.min(m.interest, 0.2); // 利息の重ね持ち上限
  MODcache = m;
  return m;
}
function effLuck() { return S.luck + mods().luckAdd; }
function effMult() { return S.mult + mods().multAdd + (S.comboBonusMult || 0); }
function hesoHalfW() {
  let w = CFG.hesoHalfW * mods().hesoMult * Math.pow(0.985, S.loop);
  if (S.rush) w *= CFG.hesoBoostInRush;
  if (S.fever) w *= 1.35; // FEVER TIME: ヘソ拡大
  return Math.min(w, 30);
}

// ---------- 盤面ジオメトリ ----------
const BOARD = { pins: [], windmills: [], segs: [] };
const BLOCK = { x: 112, y: 96, w: 236, h: 188, r: 20 }; // 大型液晶(上方向+横に拡大、下端≒旧位置で下部釘域を温存)
// リール窓メトリクス。3窓の総幅(winW×3+gap×2=174)はベゼル金枠の透明開口(横135〜324px=幅189)に収める
const REEL = { winW: 54, winH: 82, gap: 6, y0off: 46, sym: 35, drum: 31 };
const HESO = { x: 230, y: 598 };
const TULIPS = [{ x: 50, y: 496 }, { x: 410, y: 496 }];
const ATTACKER = { x: 230, y: 686, halfW: 56 };
const ATT_SEGS = [
  { x1: ATTACKER.x - ATTACKER.halfW, y1: ATTACKER.y + 4, x2: ATTACKER.x, y2: ATTACKER.y - 3 },
  { x1: ATTACKER.x, y1: ATTACKER.y - 3, x2: ATTACKER.x + ATTACKER.halfW, y2: ATTACKER.y + 4 },
];
const ATT_WINGS = [
  { x1: 58, y1: 626, x2: ATTACKER.x - ATTACKER.halfW + 4, y2: ATTACKER.y - 4 },
  { x1: 402, y1: 626, x2: ATTACKER.x + ATTACKER.halfW - 4, y2: ATTACKER.y - 4 },
];
// 右打ち中のみ有効な右上の返し斜面(強打を盤面へ流す)
const RIGHT_ENTRY_SEG = { x1: 382, y1: 22, x2: 448, y2: 120 };

function nearBlock(x, y, pad) {
  return x > BLOCK.x - pad && x < BLOCK.x + BLOCK.w + pad &&
         y > BLOCK.y - pad && y < BLOCK.y + BLOCK.h + pad;
}
function buildBoard() {
  BOARD.pins = [];
  BOARD.windmills = [
    { x: 105, y: 352, r: 15, ang: 0, dir: 1 },
    { x: 355, y: 352, r: 15, ang: 0, dir: -1 },
  ];
  // 道釘(こぼし付き)の座標を先に確定。最下段の通常釘との間隔チェックに使う
  const guideNails = [];
  for (let i = 0; i < 11; i++) {
    if (i === 3 || i === 7) continue;
    guideNails.push({ x: 60 + i * 14, y: 536 + i * 2.8 });
    guideNails.push({ x: 400 - i * 14, y: 536 + i * 2.8 });
  }
  for (let row = 0; row < 15; row++) {
    const y = 96 + row * 33;
    if (y > 530) break;
    const off = (row % 2) * 17;
    for (let x = 30 + off; x <= 430; x += 34) {
      if (y < 135 && x > 110 && x < 350) continue; // 役物の屋根と重なる釘は置かない(玉詰まり防止)
      if (nearBlock(x, y, 12)) continue;
      if (BOARD.windmills.some(w => dist(x, y, w.x, w.y) < w.r + 17)) continue; // 風車面+釘面の隙間が玉径11px超になる距離
      if (TULIPS.some(t => dist(x, y, t.x, t.y) < 30)) continue;
      if (y > 500 && guideNails.some(g => dist(x, y, g.x, g.y) < 19)) continue; // 道釘の起点と挟まって玉詰まりする釘は間引く
      BOARD.pins.push({ x, y, alive: true, key: false });
    }
  }
  // 道釘(こぼし付き)。勾配は玉が滞留しない角度(2.8/14≒11°)
  for (const g of guideNails) {
    BOARD.pins.push({ x: g.x, y: g.y, alive: true, key: false, guide: true });
  }
  // 寄り釘・命釘
  BOARD.pins.push({ x: 214, y: 552, alive: true, key: false, guide: true });
  BOARD.pins.push({ x: 246, y: 552, alive: true, key: false, guide: true });
  BOARD.pins.push({ x: HESO.x - 20, y: 582, alive: true, key: true });
  BOARD.pins.push({ x: HESO.x + 20, y: 582, alive: true, key: true });
  // チューリップ散らし釘
  for (const t of TULIPS) {
    const s = t.x < 230 ? 1 : -1;
    BOARD.pins.push({ x: t.x + s * 2, y: t.y - 24, alive: true, key: false });
  }
  BOARD.segs = [
    { x1: 12, y1: 120, x2: 78, y2: 22, leftEntry: true }, // 左打ち時のみ有効(右打ちだと発射口を囲うため無効化)
    { x1: 12, y1: 670, x2: 150, y2: 730 },
    { x1: 448, y1: 670, x2: 310, y2: 730 },
  ];
  refreshPins();
}
function applyRemovedPins() {
  const n = Math.min(mods().removePins, 8);
  const cands = BOARD.pins
    .filter(p => !p.key && !p.guide && p.y > 400 && Math.abs(p.x - HESO.x) < 90)
    .sort((a, b) => (Math.abs(a.x - HESO.x) + (590 - a.y) * 0.4) - (Math.abs(b.x - HESO.x) + (590 - b.y) * 0.4));
  BOARD.pins.forEach(p => { if (!p.key) p.alive = true; });
  for (let i = 0; i < n && i < cands.length; i++) cands[i].alive = false;
}

// ---------- 玉デッキ ----------
function drawFromBag() {
  if (S.bag.length === 0) {
    S.bag = S.deck.slice();
    for (let i = S.bag.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [S.bag[i], S.bag[j]] = [S.bag[j], S.bag[i]];
    }
  }
  return S.bag.pop() || 'shiro';
}

// ---------- 発射 ----------
function fireBall(power, opts = {}) {
  const m = mods();
  if (!opts.free) {
    if (S.balls <= 0) return false;
    if (S.shotsLeft <= 0 && !S.rush) return false;
    if (!(m.freeBallChance > 0 && rng() < m.freeBallChance)) S.balls--; // 永久機関
    if (S.shotsLeft > 0) S.shotsLeft--;
    S.stat.shots++;
    if (S.fever) { S.fever.shots--; if (S.fever.shots <= 0) endFever(); } // FEVERは発数で消化
  }
  const type = opts.type || drawFromBag();
  const bfx = (BALLS[type] || BALLS.shiro).fx;
  const p = Math.max(0.05, Math.min(1, power + (rng() - 0.5) * 0.06 * m.aimSteady));
  const b = {
    x: opts.x != null ? opts.x : (S.rightHit ? 20 : 440),
    y: opts.y != null ? opts.y : 26,
    vx: opts.vx != null ? opts.vx : (S.rightHit ? (170 + p * 460) : -(170 + p * 460)),
    vy: opts.vy != null ? opts.vy : (rng() - 0.5) * 30,
    r: bfx.r || CFG.ballR, type, dead: false, trail: [],
    gMul: bfx.gMul || 1, jit: bfx.jit != null ? bfx.jit : 1,
    restM: bfx.rest || 1,
    splitCap: (bfx.splitOnPin || 0) + (m.splitChance > 0 && rng() < m.splitChance ? 1 : 0),
    splits: 0,
    pinHits: 0, grown: 0, free: !!opts.free,
    bin: Math.min(7, Math.max(0, Math.round((p - 0.25) / 0.1))),
  };
  S.ballsOnBoard.push(b);
  S.lastFiredType = type;
  if (!opts.free && !S.simMode) S.muzzle = 1; // 発射口フラッシュ
  if (!opts.free && !S.simMode && S.aimBins[b.bin]) S.aimBins[b.bin].shots++;
  if (!opts.free) sfx('fire');
  updateHUD();
  return true;
}

// ---------- 物理 ----------
function physStep(dt) {
  const m = mods();
  if (S.magnetPulse > 0) S.magnetPulse -= dt;
  for (const b of S.ballsOnBoard) {
    if (b.dead) continue;
    const bfx = (BALLS[b.type] || BALLS.shiro).fx;
    b.vy += CFG.gravity * b.gMul * dt;
    const magnet = (bfx.magnet || 0) + m.magnetAll + (S.magnetPulse > 0 ? 3 : 0);
    if (magnet > 0 && b.y > 380 && b.y < 590) b.vx += Math.sign(HESO.x - b.x) * 46 * magnet * dt;
    // ブラックホール玉: 周囲の玉を引き込む
    if (bfx.pullOthers) {
      for (const o of S.ballsOnBoard) {
        if (o === b || o.dead) continue;
        const d = dist(o.x, o.y, b.x, b.y);
        if (d < 130 && d > 1) {
          o.vx += (b.x - o.x) / d * 220 * dt;
          o.vy += (b.y - o.y) / d * 220 * dt;
        }
      }
    }
    b.vx *= 0.9995; b.vy *= 0.9995;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!S.simMode) { b.trail.push(b.x, b.y); if (b.trail.length > 16) b.trail.splice(0, 2); }

    if (b.x < 12 + b.r) { b.x = 12 + b.r; b.vx = Math.abs(b.vx) * CFG.restWall; }
    if (b.x > 448 - b.r) { b.x = 448 - b.r; b.vx = -Math.abs(b.vx) * CFG.restWall; }
    if (b.y < 12 + b.r) { b.y = 12 + b.r; b.vy = Math.abs(b.vy) * CFG.restWall; }

    for (const pin of BOARD.pins) {
      if (!pin.alive) continue;
      const ddx = b.x - pin.x, ddy = b.y - pin.y;
      if (ddx > 9.5 || ddx < -9.5 || ddy > 9.5 || ddy < -9.5) continue;
      if (bfx.ghost && rng() < bfx.ghost) continue; // 幽霊玉: すり抜け
      if (collideCircle(b, pin.x, pin.y, CFG.pinR, CFG.restPin, true)) onPinHit(b, pin);
    }
    for (const w of BOARD.windmills) {
      if (Math.abs(b.x - w.x) > w.r + 7 || Math.abs(b.y - w.y) > w.r + 7) continue;
      if (collideCircle(b, w.x, w.y, w.r, 0.5, false)) {
        const d = dist(b.x, b.y, w.x, w.y) || 1;
        const nx = (b.x - w.x) / d, ny = (b.y - w.y) / d;
        let dir = w.dir;
        if (m.windmillBias > 0) dir = (w.x < 230) ? 1 : -1;
        b.vx += -ny * dir * 120; b.vy += nx * dir * 120;
        if (!S.simMode && rng() < 0.5) fx.spark(w.x + nx * 18, w.y + ny * 18, S.theme.accent, 2);
        sfx('tick');
      }
    }
    // リールユニットはガラス奥のLCD扱い: 玉は手前を素通り(衝突なし)
    for (const s of BOARD.segs) {
      if (s.leftEntry && S.rightHit) continue; // 右打ち中は左上斜面を撤去(発射経路を空ける)
      collideSeg(b, s, CFG.restWall);
    }
    if (S.rightHit) collideSeg(b, RIGHT_ENTRY_SEG, CFG.restWall); // 右打ち時だけ右上に返し斜面
    handleParts(b, dt, m);
    if (b.dead) continue;

    const attOpen = S.rush && S.rush.phase === 'open';
    if (!attOpen) {
      for (const s of ATT_SEGS) collideSeg(b, s, 0.3);
    } else {
      for (const s of ATT_WINGS) collideSeg(b, s, 0.2);
      if (Math.abs(b.x - ATTACKER.x) < ATTACKER.halfW && b.y > ATTACKER.y - 6 && b.y < ATTACKER.y + 16 && b.vy > 0) {
        b.dead = true; onAttackerCatch(b); continue;
      }
    }
    const hw = hesoHalfW();
    if (Math.abs(b.x - HESO.x) < hw && b.y > HESO.y - 6 && b.y < HESO.y + 14 && b.vy > 0) {
      b.dead = true; onHeso(b); continue;
    }
    for (const t of TULIPS) {
      if (Math.abs(b.x - t.x) < 10 && b.y > t.y - 6 && b.y < t.y + 14 && b.vy > 0) {
        b.dead = true; onTulip(b, t); break;
      }
    }
    if (b.dead) continue;

    const spd2 = b.vx * b.vx + b.vy * b.vy;
    if (spd2 < 900) { // 30px/s未満は「滞留しかけ」とみなす
      b.slowT = (b.slowT || 0) + dt;
      if (b.slowT > 0.65) {
        b.nudges = (b.nudges || 0) + 1;
        if (b.nudges >= 3) {
          // 何度揺すってもダメなポケット: 強制的に下向きへ叩き出す
          b.vx += (b.x < 230 ? -1 : 1) * (70 + rng() * 70);
          b.vy = 280 + rng() * 80;
        } else {
          b.vx += (rng() < 0.5 ? -1 : 1) * (100 + rng() * 100);
          b.vy -= 30 + rng() * 40;
        }
        b.slowT = 0;
      }
    } else b.slowT = 0;
    // 保険: 長生きした玉は台の振動でぐらつき、16秒で店員が回収する
    b.age = (b.age || 0) + dt;
    if (b.age > 11) { b.vx += (rng() - 0.5) * 260 * dt; b.vy += 100 * dt; }
    if (b.age > 16) {
      b.dead = true;
      if (!S.simMode) fx.spark(b.x, b.y, '#ffffff', 6);
      onDrain(b);
      continue;
    }

    if (b.y > 742) { b.dead = true; onDrain(b); }
  }
  S.ballsOnBoard = S.ballsOnBoard.filter(b => !b.dead);
}
function collideCircle(b, cx, cy, cr, rest, jitter) {
  const dx = b.x - cx, dy = b.y - cy;
  const min = b.r + cr, d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return false;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  b.x = cx + nx * min; b.y = cy + ny * min;
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    const re = Math.min(0.95, rest * (b.restM || 1));
    b.vx -= (1 + re) * dot * nx;
    b.vy -= (1 + re) * dot * ny;
    if (jitter) {
      const a = (rng() - 0.5) * 0.22 * b.jit;
      const c = Math.cos(a), s = Math.sin(a);
      const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
      b.vx = vx; b.vy = vy;
      if (Math.abs(dot) > 60) sfx('tick');
    }
  }
  return true;
}
function collideRoundRect(b, R, rest) {
  const cx = Math.max(R.x + R.r, Math.min(b.x, R.x + R.w - R.r));
  const cy = Math.max(R.y + R.r, Math.min(b.y, R.y + R.h - R.r));
  const nx0 = Math.max(R.x, Math.min(b.x, R.x + R.w));
  const ny0 = Math.max(R.y, Math.min(b.y, R.y + R.h));
  const inX = b.x > R.x && b.x < R.x + R.w, inY = b.y > R.y && b.y < R.y + R.h;
  if (!(inX && inY) && dist(b.x, b.y, nx0, ny0) > b.r + 1) return;
  const dx = b.x - cx, dy = b.y - cy;
  const d = Math.hypot(dx, dy) || 0.001, min = b.r + R.r;
  if (d >= min) return;
  const nx = dx / d, ny = dy / d;
  b.x = cx + nx * min; b.y = cy + ny * min;
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) { b.vx -= (1 + rest) * dot * nx; b.vy -= (1 + rest) * dot * ny; }
}
function collideSeg(b, s, rest) {
  const abx = s.x2 - s.x1, aby = s.y2 - s.y1;
  const t = Math.max(0, Math.min(1, ((b.x - s.x1) * abx + (b.y - s.y1) * aby) / (abx * abx + aby * aby)));
  const px = s.x1 + abx * t, py = s.y1 + aby * t;
  const dx = b.x - px, dy = b.y - py;
  const d = Math.hypot(dx, dy);
  if (d >= b.r + 2 || d === 0) return;
  const nx = dx / d, ny = dy / d;
  b.x = px + nx * (b.r + 2); b.y = py + ny * (b.r + 2);
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) { b.vx -= (1 + rest) * dot * nx; b.vy -= (1 + rest) * dot * ny; }
}

// ---------- 玉種のフック(fx駆動) ----------
function onPinHit(b, pin) {
  const bd = BALLS[b.type] || BALLS.shiro;
  const bfx = bd.fx;
  if (b.splits < b.splitCap) {
    b.splits++;
    fireBall(0, { free: true, type: 'shiro', x: b.x, y: b.y - 8, vx: -b.vx * 0.8, vy: -60 });
    fx.spark(b.x, b.y, bd.color, 8);
    fx.floatText(b.x, b.y - 12, '分裂!', bd.color);
  }
  if (bfx.pinCoinCap && b.grown < bfx.pinCoinCap) {
    b.grown++; gainBalls(1, b, false);
    if (b.grown % 5 === 0) fx.floatText(b.x, b.y - 10, `+${b.grown}育った`, bd.color);
  }
  if (!S.simMode && rng() < 0.3) fx.spark(pin.x, pin.y, S.theme.accent, 1);
}
function onDrain(b) {
  const bd = BALLS[b.type] || BALLS.shiro;
  const bfx = bd.fx;
  const m = mods();
  let coins = bfx.drainCoins || 0;
  if (m.drainCoinChance > 0 && rng() < m.drainCoinChance) coins += 2;
  if (coins > 0) {
    gainBalls(coins, b, false);
    fx.floatText(b.x, 720, `+${coins}${bfx.drainBlast ? ' 爆発!' : ''}`, bd.color);
  }
  if (bfx.drainBlast) {
    const bl = bfx.drainBlast;
    fx.ring(b.x, 730, bd.color); fx.spark(b.x, 730, bd.color, Math.round(14 * bl));
    S.shake = Math.max(S.shake, 6 + 4 * bl); sfx('boom');
    for (const o of S.ballsOnBoard) {
      if (o === b || o.dead) continue;
      const d = dist(o.x, o.y, b.x, 730);
      const R = 100 * bl + 20;
      if (d < R) { o.vy -= 330 * bl * (1 - d / R); o.vx += Math.sign(HESO.x - o.x) * 130 * bl * (1 - d / R); }
    }
  }
}

// ---------- 入賞 ----------
function gainBalls(n, srcBall, applyMult = true) {
  const m = mods();
  let v = n;
  if (applyMult) v = Math.round(v * effMult());
  const bfx = srcBall && BALLS[srcBall.type] ? BALLS[srcBall.type].fx : null;
  if (bfx && bfx.payMult) v = Math.round(v * bfx.payMult);
  // 色共鳴: 玉の色系統と揃った絵柄の色系統が一致すると倍率
  if (bfx && bfx.colorSyn && srcBall.winSym) {
    const fam = SYMBOL_FAMILY[srcBall.winSym];
    if (fam && (bfx.colorSyn === 'any' || fam === bfx.colorSyn || fam === 'rainbow')) {
      v = Math.round(v * bfx.colorMult);
      if (!S.simMode && !srcBall.resonated) {
        fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2 + 76, `色共鳴！×${bfx.colorMult}`, BALLS[srcBall.type].color);
        sfx('zap');
      }
      srcBall.resonated = true;
    }
  }
  if (m.allGainMult !== 1) v = Math.round(v * m.allGainMult);
  // シナジー相乗倍率(相性ビルドの気持ちよさの本体)
  const sm = synergyMult();
  if (sm !== 1) v = Math.round(v * sm);
  if (S.fever) v = Math.round(v * 2); // FEVER TIME: 全獲得2倍
  v = Math.round(v * CFG.payScale); // 経済全体の底上げ(高ノルマに対する払い出しスケール)
  // 面エスカレーター: 後半の台ほど出玉が増える(ノルマ上昇に全ビルドが追いつける下駄)
  v = Math.round(v * (1 + CFG.stageCoinRamp * (S.stage - 1)));
  if (S.winBoostThis > 1) v = Math.round(v * S.winBoostThis); // 役倍率(nextMult): この当たりを丸ごと×
  S.balls += v;
  S.stat.totalWon += v;
  // FEVERは当選ではなくミニチューリップ🌷のヒット数で貯まる(pocket処理側でchargeFever)
  return v;
}
let FEVER_COUNT = 0; // 計測用(累計)
function chargeFever(amount) {
  if (S.fever || S.feverOff || S.phase !== 'play') return;
  S.feverGauge = (S.feverGauge || 0) + amount;
  if (S.feverGauge >= feverReq()) startFever();
}
// ---------- FEVER TIME(脳汁ゲージ) ----------
function feverReq() { return 20; } // FEVERはミニチューリップ🌷を20回ヒットで発動(feverGauge=チューリップ計数)
function startFever() {
  S.fever = { shots: 24, total: 24 };
  S.feverGauge = 0;
  S.stat.fever = (S.stat.fever || 0) + 1;
  FEVER_COUNT++;
  addLog('🌈 FEVER TIME！！ 24発のあいだ 全獲得×2＆ヘソ拡大＆高速連射', 'hit');
  if (S.simMode) return;
  hitStop(0.18, 0.8);
  S.cam.punch = 0.2; S.aberr = 2.4; S.boardFlash = 1;
  fx.flashDOM();
  if (GLP) { GLP.radialBurst(1); GLP.burst(CFG.CW / 2, CFG.CH * 0.45, 900, 'rainbow'); }
  fx.cutin('FEVER TIME！！', true);
  fx.confettiBurst(120);
  for (let i = 0; i < 6; i++) setTimeout(() => { if (S.fever && !S.simMode) fx.fireworks(60 + rng() * 340, 100 + rng() * 300); }, i * 200);
  fountainBurst(70);
  charCutin('hot', 2.6);
  feverStartSound();
  updateHUD();
}
function endFever() {
  S.fever = null;
  addLog('FEVER終了 — ゲージふたたび蓄積中', '');
  if (!S.simMode) feverEndSound();
}
function onHeso(b) {
  const m = mods();
  const bd = BALLS[b.type] || BALLS.shiro;
  const bfx = bd.fx;
  const got = gainBalls(CFG.hesoPay + m.hesoPayAdd + (S.hesoPayPerm || 0), b, false);
  S.stat.heso++;
  if (!b.free && !S.simMode && S.aimBins[b.bin]) S.aimBins[b.bin].heso++;
  fx.ring(HESO.x, HESO.y, S.theme.accent);
  fx.spark(HESO.x, HESO.y, S.theme.accent, 10);
  fx.floatText(HESO.x, HESO.y - 16, `+${got}`, S.theme.accent);
  sfx('heso');
  if (bfx.hesoCoins) {
    const z = gainBalls(bfx.hesoCoins, b, false);
    if (bfx.zap) { fx.lightning(HESO.x, HESO.y); S.shake = Math.max(S.shake, 6); sfx('zap'); }
    fx.floatText(HESO.x + 30, HESO.y - 30, `+${z}`, bd.color);
  }
  if (bfx.hesoShower) {
    if (S.simMode) gainBalls(bfx.hesoShower * 4, b, false);
    else { S.shower += bfx.hesoShower; fx.floatText(HESO.x, HESO.y - 44, 'ミニシャワー!', bd.color); }
  }
  const max = CFG.holdMax + m.holdAdd;
  const pushes = bfx.doubleHold ? 2 : 1;
  let pushed = false;
  for (let k = 0; k < pushes && S.hold.length < max; k++) {
    // 入賞時に結果を先決定 → 保留色で先読み示唆(実機の激熱保留)
    const out = decideOutcome(b.type);
    let hint = null;
    if (out.kind === 3 || out.kind === 'recipe') {
      if ((out.kind === 'recipe' || out.symbol === 'seven' || out.symbol === 'bar' || out.symbol === 'crown') && rng() < 0.6) hint = 'red';
      else if (rng() < 0.5) hint = 'gold';
    } else if (rng() < 0.04) hint = 'gold'; // ガセ金保留
    S.hold.push({ ball: b.type, out, hint });
    pushed = true;
  }
  if (pushed) tryStartSpin();
  updateHUD();
}
function onTulip(b, t) {
  const m = mods();
  const bfx = (BALLS[b.type] || BALLS.shiro).fx;
  const pay = Math.round((CFG.tulipPay + m.tulipPayAdd) * (bfx.tulipMult || 1));
  const got = gainBalls(pay, b, false);
  chargeFever(1); // 左右のデフォルトチューリップも20ヒットでFEVERへ(ミニチューリップ役物と合算)
  fx.spark(t.x, t.y, '#ff9ecb', 6);
  fx.floatText(t.x, t.y - 14, `+${got}`, '#ff9ecb');
  sfx('tulip');
  updateHUD();
}
function onAttackerCatch(b) {
  if (!S.rush) return;
  const m = mods();
  const got = gainBalls(CFG.attackerPay + m.attackerPay, b, false);
  S.rushWon += got;
  S.rush.catches++;
  fx.spark(ATTACKER.x, ATTACKER.y, S.theme.accent, 8);
  fx.coinFly(b.x, ATTACKER.y, 3);
  fx.floatText(ATTACKER.x + (rng() - 0.5) * 70, ATTACKER.y - 12, `+${got}`, '#fff');
  sfx('catch');
  if (S.rush.catches >= CFG.countPerRound + m.roundCountAdd) endRound();
  updateHUD();
}

// ---------- リール抽選 ----------
function poolTotal() { return Object.values(S.symbolPool).reduce((a, b) => a + b, 0); }
function decideOutcome(ballType) {
  const m = mods();
  const bfx = BALLS[ballType] ? BALLS[ballType].fx : {};
  const N = poolTotal();
  if (N <= 0) return { kind: 0, symbol: null }; // ビルド未完了ガード
  const luck = effLuck() * (bfx.spinLuck || 1);
  const p3 = {}, ids = Object.keys(S.symbolPool).filter(id => S.symbolPool[id] > 0);
  let sum3 = 0;
  for (const id of ids) {
    // 格ペナルティ: 強い絵柄(レア/レジェンド)は枚数を積まないとほぼ揃わない
    let w = Math.pow(S.symbolPool[id] / N, 3) * (RARITY_ALIGN[SYMBOLS[id].rarity] || 1);
    if (bfx.biasSym === id) w *= bfx.biasMult || 1;
    p3[id] = w; sum3 += w;
  }
  const pWin = Math.min(0.45, sum3 * (CFG.winL + luck * 1.2) * m.winLMult);
  const r = rng();
  if (r < pWin) {
    let t = rng() * sum3, symbol = ids[0];
    for (const id of ids) { t -= p3[id]; if (t <= 0) { symbol = id; break; } }
    return { kind: 3, symbol };
  }
  // 特殊役(レシピ): 必要絵柄をリールに揃えていると抽選に混ざる
  const rl = [];
  let rSum = 0;
  const FACT = [1, 1, 2, 6, 24, 120];
  for (const rc of RECIPES) {
    if (!recipeReady(rc)) continue;
    let prod = 1, dupF = 1, slots = 0;
    for (const nd of rc.need) {
      let cnt = 0; // このneedに該当するプール枚数
      for (const id of ids) if (symMatchesNeed(id, nd)) cnt += S.symbolPool[id];
      for (let i = 0; i < nd.n; i++) prod *= Math.max(1, cnt);
      dupF *= FACT[nd.n] || 720;
      slots += nd.n;
    }
    const p = ((FACT[slots] || 720) / dupF) * (prod / Math.pow(N, slots)) * (CFG.recipeL + luck * 0.6) * m.winLMult;
    rl.push({ rc, p }); rSum += p;
  }
  if (rl.length && rng() < Math.min(rSum, 0.25)) {
    let t = rng() * rSum, sel = rl[0].rc;
    for (const x of rl) { t -= x.p; if (t <= 0) { sel = x.rc; break; } }
    return { kind: 'recipe', recipe: sel };
  }
  if (rng() < CFG.twoMatchP + m.twoMatchAdd) {
    let sum2 = 0; const p2 = {};
    for (const id of ids) { p2[id] = S.symbolPool[id] ** 2; sum2 += p2[id]; }
    let t = rng() * sum2, symbol = ids[0];
    for (const id of ids) { t -= p2[id]; if (t <= 0) { symbol = id; break; } }
    return { kind: 2, symbol };
  }
  return { kind: 0, symbol: null };
}
function facesFor(out) {
  const ids = Object.keys(S.symbolPool).filter(id => S.symbolPool[id] > 0);
  if (ids.length === 0) return ['seven', 'seven', 'seven'];
  if (out.kind === 'recipe') {
    // 各needを満たす実際のプール絵柄を選んで3枠に割り当てる(カテゴリ役は該当系統から拾う)
    const faces = [];
    for (const nd of out.recipe.need) {
      const cands = ids.filter(id => symMatchesNeed(id, nd));
      for (let i = 0; i < nd.n && faces.length < 3; i++) {
        const fresh = cands.find(id => !faces.includes(id));
        faces.push(fresh || cands[i % cands.length] || cands[0] || ids[0]);
      }
    }
    while (faces.length < 3) faces.push(faces[0] || ids[0]);
    return faces.slice(0, 3);
  }
  const other = ex => { let o = pick(ids); let g = 0; while (o === ex && g++ < 12) o = pick(ids); return o; };
  if (out.kind === 3) return [out.symbol, out.symbol, out.symbol];
  if (out.kind === 2) return [out.symbol, out.symbol, other(out.symbol)];
  // ハズレ: 3つバラバラ(偶然の2個揃いに見せない)
  const a = pick(ids), b = other(a);
  let c3 = pick(ids), g = 0;
  while ((c3 === a || c3 === b) && g++ < 12) c3 = pick(ids);
  return [a, b, c3];
}
function tryStartSpin() {
  if (S.spin || S.rush || S.hold.length === 0) return;
  const entry = S.hold.shift();
  const out = entry.out || decideOutcome(entry.ball);
  const faces = facesFor(out);
  const isRecipe = out.kind === 'recipe';
  // 役の揃い際は絵柄そのものが違ってもカテゴリが同じなら「揃いそう」に見えるのでリーチ扱いにする
  const reach = isRecipe ? (faces[0] === faces[1] || SYMBOL_CAT[faces[0]] === SYMBOL_CAT[faces[1]]) : out.kind >= 2;
  const sf = mods().spinFast;
  S.spin = {
    faces, out, ball: entry.ball, t: 0, reach,
    stopAt: [0.55 * sf, 0.95 * sf, (reach ? 2.6 : 1.35) * sf],
    reachPlayed: false,
    hot: out.kind === 3 ? rng() < 0.6 : isRecipe ? (reach && rng() < 0.75) : (reach && rng() < 0.12),
    stopped: [false, false, false],
  };
  if (S.simMode) { S.spin.t = 99; resolveSpin(); return; }
  // ---- 実機級演出の仕込み(疑似連/復活/PUSH。計測simでは一切走らない) ----
  const sp = S.spin;
  const win = out.kind === 3 || isRecipe;
  sp.finalFaces = faces.slice();
  if (win && rng() < 0.4) sp.pseudo = rng() < 0.35 ? 2 : 1;           // 疑似連(当たりの40%)
  else if (!win && reach && rng() < 0.08) sp.pseudo = 1;              // ガセ疑似連
  if (win && !sp.pseudo && rng() < 0.13) sp.revive = true;            // 復活(逆転)
  if (sp.pseudo || sp.revive) sp.faces = nearMissFaces(sp.finalFaces); // まずニアミス目を見せる
  // PUSHボタン演出は廃止(テンポ優先)
}
// ニアミス目: 最後の1個だけ別の絵柄に差し替えた「あと1個」の形
function nearMissFaces(f) {
  const ids = Object.keys(S.symbolPool).filter(id => S.symbolPool[id] > 0 && id !== f[2]);
  const other = ids.length ? ids[(rng() * ids.length) | 0] : (f[2] === 'cherry' ? 'bell' : 'cherry');
  return [f[0], f[1], other];
}
// 疑似連: いったん止まった風→「連」スタンプ→再始動
function pseudoRespin(sp) {
  sp.pseudo--;
  sp.renN = (sp.renN || 1) + 1;
  showRenStamp(sp.renN);
  sfx('ren');
  const last = sp.pseudo <= 0;
  sp.faces = last ? sp.finalFaces.slice() : nearMissFaces(sp.finalFaces);
  const sf = mods().spinFast;
  sp.t = 0;
  sp.stopAt = [0.42 * sf, 0.75 * sf, (last && sp.reach ? 2.3 : 1.25) * sf];
  sp.stopped = [false, false, false];
  sp.reachPlayed = false;
  S.shake = Math.max(S.shake, 7);
  S.cam.punch = Math.max(S.cam.punch, 0.07);
  if (GLP) GLP.burst(CFG.FX + BLOCK.x + BLOCK.w / 2, CFG.FY + BLOCK.y + BLOCK.h / 2, 60, 'white');
}
function reelCenter() { return [CFG.FX + BLOCK.x + BLOCK.w / 2, CFG.FY + BLOCK.y + REEL.y0off + REEL.winH / 2]; }
// PUSHボタン
function showPushBtn(rainbow) {
  const b = document.getElementById('pushBtn');
  if (!b) return;
  b.className = 'show' + (rainbow ? ' rainbow' : '');
}
function hidePushBtn() {
  const b = document.getElementById('pushBtn');
  if (b) b.className = '';
}
function pushRelease(pressed) {
  const sp = S.spin;
  hidePushBtn();
  if (!sp || !sp.paused) return;
  sp.paused = false;
  if (pressed) {
    S.shake = Math.max(S.shake, 9); S.cam.punch = Math.max(S.cam.punch, 0.11);
    sfx('push');
    const [cx, cy] = reelCenter();
    if (GLP) { GLP.shock(cx, cy); GLP.burst(cx, cy, 90, 'white'); }
  }
}
function showRenStamp(n) {
  /* 赤い「連」スタンプは廃止(ユーザー要望)。連荘数はRUSH演出側で伝わるため表示しない */
}
function hideRenStamp() {
  const el = document.getElementById('renStamp');
  if (el) el.classList.remove('show');
}
function spinStep(dt) {
  if (!S.spin) return;
  const sp = S.spin;
  // PUSH待機中は時間停止(タップか2.8秒で開放)
  if (sp.paused) {
    sp.pushTimer = (sp.pushTimer || 0) + dt;
    if (sp.pushTimer > 2.8) pushRelease(false);
    return;
  }
  sp.t += dt;
  // リールごとのビタ止め演出
  if (!S.simMode) {
    for (let i = 0; i < 3; i++) {
      if (!sp.stopped[i] && sp.t >= sp.stopAt[i]) {
        sp.stopped[i] = true;
        const wx = BLOCK.x + BLOCK.w / 2 + (i - 1) * (REEL.winW + REEL.gap);
        fx.ring(wx, BLOCK.y + REEL.y0off + REEL.winH / 2, i === 2 && (sp.out.kind === 3 || sp.out.kind === 'recipe') ? '#ffffff' : S.theme.accent);
        S.shake = Math.max(S.shake, i === 2 ? 5 : 3);
        sfx('reelstop');
      }
    }
  }
  if (sp.reach && !sp.reachPlayed && sp.t > sp.stopAt[1]) {
    sp.reachPlayed = true;
    if (!S.simMode) {
      sfx('reach');
      document.getElementById('vignette').classList.add('on');
      lcdSchoolT = sp.hot ? 2.2 : 1.2; // 鯉の群予告(激アツほど大群)
      if (sp.hot) { fx.cutin('激アツ！！', true); sfx('atsu'); charCutin('hot', 2.4); }
    }
  }
  // PUSH: 最終リール停止の直前で止めてボタンを出す(疑似連の最終変動のみ)
  if (!S.simMode && sp.push && !sp.pushShown && !(sp.pseudo > 0) && sp.t >= sp.stopAt[2] - 0.06) {
    sp.pushShown = true; sp.paused = true; sp.pushTimer = 0;
    showPushBtn(sp.pushRainbow);
    return;
  }
  // 復活: ハズレ目で止めた後、無音のタメ→第3リールが落ち直して当たりに書き換わる
  if (!S.simMode && sp.reviveArmed && !sp.reviveDropped && sp.t >= sp.reviveDropAt) {
    sp.reviveDropped = true;
    sp.faces = sp.finalFaces.slice();
    sp.stopped[2] = false; // 第3リール再落下→通常のビタ止め処理が再発火する
    fx.flashDOM(); S.shake = Math.max(S.shake, 11); S.aberr = Math.max(S.aberr, 1.6);
    sfx('revive');
    const [cx, cy] = reelCenter();
    if (GLP) { GLP.shock(cx, cy); GLP.burst(cx, cy, 180, 'gold'); }
  }
  if (sp.t >= sp.stopAt[2]) {
    if (!S.simMode && sp.pseudo > 0) { pseudoRespin(sp); return; }
    if (!S.simMode && sp.revive && !sp.reviveArmed) {
      // いったん「負けた…」を演出: 無音0.85秒 → 再落下予約
      sp.reviveArmed = true;
      S.muteT = 0.85;
      sp.stopAt = sp.stopAt.slice();
      sp.reviveDropAt = sp.t + 0.85;
      sp.stopAt[2] = sp.t + 1.4;
      sfx('stop');
      return;
    }
    resolveSpin();
  }
}
// 宴覚醒コンボ: 3揃い/役が連チャンするたび倍率が伸び、2揃い/ハズレで途切れて0に戻る
const FEST_COMBO_STEP = 0.4, FEST_COMBO_CAP = 5;
function festComboStep(isBigWin) {
  if (!S.festComboActive) return;
  if (isBigWin) {
    S.festStreak = (S.festStreak || 0) + 1;
    S.comboBonusMult = +(Math.min(FEST_COMBO_CAP, S.festStreak) * FEST_COMBO_STEP).toFixed(2);
    if (!S.simMode) {
      flashStat('multChip');
      if (S.festStreak >= 2) fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y - 14, `祭連チャン×${S.festStreak}！`, '#ff8aff');
    }
  } else if (S.festStreak > 0) {
    if (!S.simMode) fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y - 14, '連チャン途切れ…', '#8a8f9c');
    S.festStreak = 0;
    S.comboBonusMult = 0;
  }
}
function resolveSpin() {
  const sp = S.spin;
  S.spin = null;
  S.lastDigits = sp.faces;
  if (!S.simMode) {
    document.getElementById('vignette').classList.remove('on');
    hidePushBtn(); hideRenStamp();
  }
  festComboStep(sp.out.kind === 3 || sp.out.kind === 'recipe');
  if (sp.out.kind === 3) applyThree(sp.out.symbol, sp.ball);
  else if (sp.out.kind === 'recipe') applyRecipe(sp.out.recipe, sp.ball);
  else if (sp.out.kind === 2) applyTwo(sp.out.symbol, sp.ball);
  else { sfx('stop'); tryStartSpin(); }
  updateHUD();
}
// 特殊役の成立
function applyRecipe(rc, ballType) {
  S.stat.wins++;
  markDex('recipe', rc.name);
  // 揃った実際のリール絵柄を代表シンボルにする(カテゴリ役は固定idが無いため)
  const rep = (S.lastDigits || []).find(x => SYMBOLS[x]) || Object.keys(S.symbolPool).find(k => S.symbolPool[k] > 0) || 'seven';
  const srcBall = { type: ballType, winSym: rep };
  fx.flashDOM(); S.shake = Math.max(S.shake, 14); S.boardFlash = 1;
  fx.confettiBurst(70);
  fx.ring(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2, '#ff4dff');
  if (!S.simMode) {
    S.winFx = { t: 0, amount: 0, symbol: rep };
    hitStop(0.05, 0.2);
    S.cam.punch = 0.12;
    S.aberr = Math.max(S.aberr, 1.2);
    if (GLP) { const [cx, cy] = reelCenter(); GLP.shock(cx, cy); GLP.burst(cx, cy, 320, 'gold'); }
    fx.cutin(`役「${rc.name}」！！`, true);
    fx.coinFly(230, 200, 16);
    sfx('jackpot');
  }
  addLog(`🎴 特殊役「${rc.name}」成立！`, 'hit');
  if (!S.simMode) roleNameBanner(rc.name); // 役名を液晶に大きく掲示(何の役か一目で分かる)
  symbolWinSound(rep); // 役の主役絵柄のジングルを重ねる
  winBoostBegin();
  runEffect(rc.eff, srcBall, false, rep);
  const m = mods();
  if (m.bonusPerWin) gainBalls(m.bonusPerWin, null, false);
  winBoostEnd();
  if (!S.rush) tryStartSpin();
  updateHUD();
}
// HUDの倍率/運チップを光らせる(効果が一目でわかる)
function flashStat(id) {
  if (S.simMode) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('up'); void el.offsetWidth; el.classList.add('up');
}
// 役成立時に役名を液晶へ大きく掲示(何の役が決まったか一目で分かる)
let roleBannerT = null;
function roleNameBanner(name) {
  const el = document.getElementById('roleBanner');
  if (!el) return;
  el.innerHTML = `<span class="rb-k">役 成立</span><span class="rb-n">${name}</span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (roleBannerT) clearTimeout(roleBannerT);
  roleBannerT = setTimeout(() => el.classList.remove('show'), 2600);
}
// 倍率UPの巨大カットイン(一目で「倍率が上がった」とわかる)
function bigMultPopup(newMult) {
  if (S.simMode) return;
  fx.cutin(`倍率 ×${newMult.toFixed(2)} に UP！`, true);
  fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2 + 40, `× ${newMult.toFixed(2)}`, '#ffd76a');
}
// 当たりに乗った「自分のビルド倍率」を表示用に組む(倍率×相乗×FEVER)。1.05倍以上のとき"×N"を出す
function winMultTag() {
  const bm = effMult() * synergyMult() * (S.fever ? 2 : 1) * (S.winBoostThis > 1 ? S.winBoostThis : 1);
  return bm > 1.05 ? ` ×${bm.toFixed(1)}` : '';
}
// 役倍率(nextMult)の当たり単位ライフサイクル。当たり開始時に有効な倍率を確定し、gainBallsで乗せる
function winBoostBegin() {
  S.winBoostThis = (S.winBoostN > 0) ? (S.winBoostV || 1) : 1; // この当たりに乗る役倍率(開始時に確定=自己ブースト防止)
  S.winBoostGranted = false; // この当たり中にnextMultを新規付与したか(付与したものは即消費しない)
}
function winBoostEnd() {
  if (S.winBoostThis > 1 && !S.winBoostGranted) {
    S.winBoostN = Math.max(0, S.winBoostN - 1);
    if (S.winBoostN <= 0) S.winBoostV = 1;
  }
  S.winBoostThis = 1;
}
// ---------- 効果エグゼキュータ ----------
function runEffect(d, srcBall, big, symId) {
  const sym = SYMBOLS[symId] || {};
  const F = (txt, col) => {
    if (big) fx.cutin(txt);
    else fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2 + 56, txt, col || sym.color || '#fff');
  };
  const BW = () => { if (big) sfx('bigwin'); };
  switch (d.t) {
    // 宴覚醒: 残り面すべて「祭コンボ」が有効になる(3揃い/役が連チャンするたび倍率が伸び、途切れると0に戻る)
    case 'comboActivate': {
      S.festComboActive = true;
      F('祭コンボ 発動！連チャンで倍率UP', '#ff8aff');
      if (!S.simMode) fx.cutin('祭コンボ突入！連チャンで倍率UP', true);
      BW(); break;
    }
    case 'coins': {
      const tag = winMultTag(); // 倍率適用前に計算(gainBallsでmultが変わる前提はないが表示整合のため)
      const v = gainBalls(d.v, srcBall);
      if (big && S.winFx) S.winFx.amount = v;
      F(`+${v}玉${tag}${big ? '！' : ''}`);
      if (big) fx.coinFly(230, 200, Math.min(24, 6 + ((v / 40) | 0)));
      celebrate(v);
      BW(); break;
    }
    case 'coinsRange': {
      const raw = d.min + Math.floor(rng() * (d.max - d.min + 1));
      const tag = winMultTag();
      const v = gainBalls(raw, srcBall);
      if (big && S.winFx) S.winFx.amount = v;
      F(`+${v}玉${tag}！`); if (big) fx.coinFly(230, 200, 12);
      celebrate(v);
      BW(); break;
    }
    case 'ballsPct': {
      // simulate中は持ち玉が仮値(1e9)なので実残高に換算。エスカレーター対象外+1回上限あり
      const bank = Math.max(0, S.balls + (S.simRealBase || 0));
      const v = Math.min(Math.max(1, Math.round(bank * d.v)), 150 + 150 * S.stage);
      S.balls += v; S.stat.totalWon += v;
      if (big && S.winFx) S.winFx.amount = v;
      F(`+${v}玉！`);
      celebrate(v);
      BW(); break;
    }
    case 'luck': S.luck = +(S.luck + d.v).toFixed(2); F(`運UP ▲ ${effLuck().toFixed(1)}`, '#7ef0a8'); flashStat('luckChip'); BW(); break;
    case 'mult': S.mult = +(S.mult + d.v).toFixed(2); bigMultPopup(effMult()); flashStat('multChip'); BW(); break;
    // 倍率乗算型: 倍率スタットそのものを×する(加算より遥かに跳ねる)
    case 'multMult': S.mult = +(S.mult * d.v).toFixed(2); bigMultPopup(effMult()); flashStat('multChip'); BW(); break;
    // 役倍率型: 次のn回の「当たり(3揃い/役)」を丸ごと×v。今回の当たりには乗らない(winBoostThisは当たり開始時に確定済み)
    case 'nextMult':
      S.winBoostV = d.v; S.winBoostN = (d.n || 1); S.winBoostGranted = true;
      F(`次の${(d.n || 1) > 1 ? (d.n) + '回の' : ''}当たり ×${d.v}！`, '#ff8aff'); flashStat('multChip'); BW(); break;
    case 'shots': {
      S.shotsLeft += d.v;
      let t = `+${d.v}発`;
      if (d.c) { const v = gainBalls(d.c, srcBall); if (big && S.winFx) S.winFx.amount = v; t = `+${v}玉＆${t}`; }
      F(t); BW(); break;
    }
    case 'quotaCut': S.quota = Math.max(50, Math.round(S.quota * (1 - d.v))); F(`納品 -${Math.round(d.v * 100)}%！`); BW(); break;
    case 'shower':
      if (S.simMode) gainBalls(d.v * 4, srcBall, false);
      else { S.shower += d.v; S.showerCd = 0; }
      F('玉シャワー！'); if (big) sfx('shower');
      break;
    case 'rush':
      if (big && !S.simMode) { fx.cutin(d.v >= 6 ? 'RUSH！！' : 'ミニRUSH'); sfx('jackpot'); }
      startRush(d.v, sym.glyph || '');
      break;
    case 'thinDeck': {
      const prevSyn = activeSynergies().slice();
      const i = S.deck.indexOf('shiro');
      if (i >= 0) { S.deck.splice(i, 1); S.bag = []; }
      const v = gainBalls(d.c || 0, srcBall);
      F(i >= 0 ? `白玉を回収 +${v}玉` : `+${v}玉`);
      checkSynergies(prevSyn);
      if (!S.simMode) renderCollections();
      BW(); break;
    }
    case 'hesoPayPerm': S.hesoPayPerm = (S.hesoPayPerm || 0) + d.v; F(`ヘソ賞球 +${d.v}(永続)`); BW(); break;
    case 'rewriteHold': {
      const h = S.hold.find(h2 => h2.out && h2.out.kind !== 3);
      if (h) {
        const ids = Object.keys(S.symbolPool).filter(k => S.symbolPool[k] > 0);
        h.out = { kind: 3, symbol: pick(ids) };
        h.hint = 'red';
        F('保留が赤く燃えた！');
      } else {
        const v = gainBalls(d.c || 30, srcBall); F(`+${v}玉`);
      }
      BW(); break;
    }
    case 'magnetPulse': S.magnetPulse = 2.5; F('全玉吸引！'); BW(); break;
    case 'deckBall': {
      const prevSyn = activeSynergies().slice();
      S.deck.push(d.id); S.bag = [];
      F(`${BALLS[d.id].name}を入手！`);
      checkSynergies(prevSyn);
      if (!S.simMode) renderCollections();
      BW(); break;
    }
    case 'relicGift': {
      const avail = RELICS.filter(r => r.rarity === 'normal' && !S.relics.some(o => o.id === r.id));
      if (avail.length) {
        const r = pick(avail);
        S.relics.push(r); modsDirty();
        if (r.fx.removePins) refreshPins();
        F(`お守り「${r.name}」！`);
        if (!S.simMode) renderCollections();
      } else { const v = gainBalls(50, srcBall); F(`+${v}玉`); }
      BW(); break;
    }
    // 絡繰覚醒: 空きスロットに役物を1つ無料設置(レア/レジェンド優先、埋まっていれば玉で代替)
    case 'partGift': {
      const slots = freeSlots();
      if (slots.length > 0) {
        const owned = new Set(S.parts.map(p => p.id));
        const cand = Object.keys(PARTS).filter(id => !owned.has(id));
        const weighted = [];
        for (const id of cand) {
          const w = PARTS[id].rarity === 'legend' ? 4 : PARTS[id].rarity === 'rare' ? 2 : 1;
          for (let i = 0; i < w; i++) weighted.push(id);
        }
        if (weighted.length) {
          const id = pick(weighted);
          installPartAt(id, pick(slots));
          F(`役物「${PARTS[id].name}」設置！`);
          if (!S.simMode) renderCollections();
        } else { const v = gainBalls(d.c || 60, srcBall); F(`+${v}玉`); }
      } else { const v = gainBalls(d.c || 60, srcBall); F(`+${v}玉(スロット満杯)`); }
      BW(); break;
    }
    // 百獣覚醒: 即座にFEVER突入(既にFEVER中なら延長)
    case 'feverStart': startFever(); BW(); break;
    case 'multi': for (const sub of d.list) runEffect(sub, srcBall, false, symId); BW(); break;
    case 'joker': {
      const pool = [
        { t: 'coins', v: 600 }, { t: 'rush', v: 8 }, { t: 'shower', v: 20 },
        { t: 'mult', v: 0.5 }, { t: 'luck', v: 1 }, { t: 'quotaCut', v: 0.4 },
      ];
      runEffect(pick(pool), srcBall, big, symId);
      break;
    }
  }
}
function applyTwo(id, ballType) {
  runEffect(SYMBOLS[id].two, { type: ballType, winSym: id }, false, id);
  sfx('two');
  tryStartSpin();
  updateHUD();
}
function applyThree(id, ballType) {
  S.stat.wins++;
  const srcBall = { type: ballType, winSym: id };
  const sym = SYMBOLS[id];
  const m = mods();
  fx.flashDOM(); S.shake = Math.max(S.shake, 12); S.boardFlash = 1;
  fx.confettiBurst(50);
  fx.ring(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2, sym.color);
  if (!S.simMode) {
    S.winFx = { t: 0, amount: 0, symbol: id }; // サンバースト+カウントアップ
    if (GLP) { const [cx, cy] = reelCenter(); GLP.shock(cx, cy); GLP.burst(cx, cy, 220, 'gold'); }
    hitStop(0.06, 0.16);          // 揃った瞬間、時が止まる
    S.cam.punch = 0.09;           // ズームパンチ
    S.aberr = Math.max(S.aberr, 1);
    if (S.theme.ambient === 'glitch') S.glitchT = Math.max(S.glitchT, 0.25);
  }
  addLog(`🎰 ${sym.name} 3揃い！`, 'hit');
  cheerSwimmers(); // 液晶の生き物が歓喜ジャンプ
  symbolWinSound(id); // 揃った絵柄「らしい」専用ジングル
  winBoostBegin();
  runEffect(sym.three, srcBall, true, id);
  if (m.bonusPerWin) gainBalls(m.bonusPerWin, null, false); // ネオン管
  winBoostEnd();
  const bfx = (BALLS[ballType] || BALLS.shiro).fx;
  if (bfx.onWinMult) {
    S.mult = +(S.mult + bfx.onWinMult).toFixed(2);
    addLog(`月光: 倍率+${bfx.onWinMult}`, 'hit');
  }
  if (!S.rush) tryStartSpin();
  updateHUD();
}

// ---------- RUSH ----------
function startRush(rounds, label) {
  S.stat.rush++;
  S.rushWon = 0; // このRUSHセッションの総獲得(連チャン込み)を祝祭演出に使う
  S.rush = { round: 0, totalRounds: rounds + mods().roundsAdd, catches: 0, t: 0, phase: 'banner', label };
  if (S.simMode) return;
  hitStop(0.3, 0.75);             // 突入スローモーション
  S.cam.punch = 0.16;
  S.aberr = 1.5;
  document.getElementById('fever').classList.add('on');
  addLog(`⚡ RUSH ${S.rush.totalRounds}R 開始`, 'hit');
}
function rushStep(dt) {
  if (!S.rush) return;
  const j = S.rush;
  j.t += dt;
  if (j.phase === 'banner' && j.t > (S.simMode ? 0 : 1.5)) {
    j.phase = 'open'; j.round = 1; j.catches = 0; j.t = 0;
    sfx('round');
  } else if (j.phase === 'open') {
    if (S.simMode) {
      const m = mods();
      gainBalls(Math.round((CFG.countPerRound + m.roundCountAdd) * 0.85) * (CFG.attackerPay + m.attackerPay), null, false);
      endRound();
    } else if (j.t > CFG.roundTimeout) endRound();
  } else if (j.phase === 'gap' && j.t > (S.simMode ? 0 : 0.9)) {
    j.phase = 'open'; j.round++; j.catches = 0; j.t = 0;
    sfx('round');
  }
}
function endRound() {
  const j = S.rush;
  if (!j) return;
  if (j.round >= j.totalRounds) {
    const rate = Math.min(CFG.renchanBase + mods().renchanAdd, 0.9);
    if (rng() < rate) {
      j.round = 0; j.catches = 0; j.t = 0; j.phase = S.simMode ? 'open' : 'banner';
      S.stat.rush++;
      if (!S.simMode) { fx.cutin('連チャン！！'); fx.confettiBurst(80); sfx('jackpot'); addLog('🔥 連チャン継続！', 'hit'); }
    } else {
      S.rush = null;
      const m = mods();
      if (m.showerOnRush > 0) { // 星降る夜
        if (S.simMode) gainBalls(m.showerOnRush * 4, null, false);
        else { S.shower += m.showerOnRush; fx.cutin('星降る夜！'); sfx('shower'); }
      }
      if (!S.simMode) {
        document.getElementById('fever').classList.remove('on');
        addLog(`RUSH終了 — 総獲得 ${S.rushWon}玉`, 'hit');
        celebrate(S.rushWon); // RUSH総獲得で祝祭(連チャン込みなら超大当り級)
      }
      tryStartSpin();
    }
  } else {
    j.phase = 'gap'; j.t = 0;
    fx.fireworks(ATTACKER.x + (rng() - 0.5) * 120, 480 + rng() * 80); // ラウンド完走の打ち上げ
  }
  updateHUD();
}

// ---------- 面の進行 ----------
// 周回ノルマ倍率: 周が進むほど"どんどん"急になる加速曲線(各周の上げ幅が増える)
// loop1≈×1.24 / loop2≈×1.57 / loop3≈×2.05 / loop5≈×3.8 / loop10≈×27
function loopMultAt(loop) {
  let m = 1;
  for (let k = 1; k <= loop; k++) m *= (1.20 + 0.035 * k);
  return m;
}
function loopMult() { return loopMultAt(S.loop); }
function quotaFor(stage) {
  const base = CFG.quotas[Math.min(stage - 1, CFG.quotas.length - 1)];
  const diff = (S.simMode || S.allUnlock) ? (S.testDiffMult || 1) : curDiff().mult; // 計測(autoRun)は常にふつう基準(S.testDiffMultで上書き可)
  return Math.max(50, Math.round(base * mods().quotaMult * loopMult() * diff));
}
function stageShots(m) {
  return Math.max(90, CFG.shotsPerStage + m.shotsAdd - S.loop * 4);
}
function startStage(n) {
  // 3面・7面: プレイ前に神社(お賽銭)イベントを挟む
  if (!S.simMode && !S.free && (n === 3 || n === 7)) {
    S.stage = n;
    openShrine(n, () => beginStage(n));
    return;
  }
  beginStage(n);
}
function beginStage(n) {
  S.stage = n;
  if (S.free) {
    // フリーモード: テーマは選んだ面に固定、ノルマは軽め、玉は常に潤沢=死なずに演出を楽しむ
    S.theme = THEMES[Math.min(Math.max(S.freeTheme, 1), THEMES.length) - 1];
    S.quota = 800;
    S.balls = Math.max(S.balls, 25000);
  } else {
    S.theme = THEMES[Math.min(Math.max(n, 1), THEMES.length) - 1];
    S.quota = quotaFor(n);
  }
  if (S.cullCd > 0) S.cullCd--; // 間引き商品クールダウンを面ごとに消化
  const m = mods();
  S.shotsLeft = stageShots(m);
  if (m.periodBalls > 0) {
    S.balls += m.periodBalls;
    addLog(`景品・玉箱で +${m.periodBalls}玉`, 'hit');
  }
  S.phase = 'play';
  S.hold = []; S.spin = null; S.rush = null;
  S.shower = 0; S.showerCd = 0;
  S.ballsOnBoard = []; S.ambient = [];
  if (!S.simMode) document.getElementById('fever').classList.remove('on');
  applyTheme();
  addLog(`—— ${S.theme.num}「${S.theme.name}」 納品 ${S.quota}玉 ——`);
  if (!S.simMode) {
    const card = document.getElementById('stageCard');
    card.querySelector('.num').textContent = S.free ? 'フリーモード' : `${S.theme.num}　${n} / 10`;
    card.querySelector('.nm').textContent = S.theme.name;
    card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
    sfx('stage');
    // キャラ挨拶は面カードと領域を奪い合わないよう、カードが引けてから出す(同じ面のままの時だけ)
    const introStage = n;
    setTimeout(() => { if (!S.simMode && S.stage === introStage && S.phase === 'play') charCutin('normal', 1.4); }, 1700);
    // 面カードが出ている間は発射をロック(盤面が見えない裏で発射数を消費しない)
    S.introLock = true;
    if (S.introTimer) clearTimeout(S.introTimer);
    S.introTimer = setTimeout(() => { S.introLock = false; }, 2000);
    saveRun(); // 面の頭(盤面が空)で自動セーブ → 「つづきから」で再開可能
  } else {
    S.introLock = false;
  }
  updateHUD();
}

// ========== 神社 お賽銭イベント (3面・7面) ==========
// 5秒間、画面を連打 → 1タップにつき「持ち玉の1%」を寄進。寄進した玉ぶんだけ運が上がる。
// レート: 3面=1500玉で運+1 / 7面=1万玉で運+1。暴走防止に1回の上限は運+3。
let shrineCtx = null;
function fmtN(n) { return Math.round(n).toLocaleString('en-US'); }
// OSの「視覚効果を減らす」(prefers-reduced-motion)を尊重する — 光過敏/前庭障害への配慮
let _rmq = null;
function reduceMotion() {
  if (_rmq === null) { try { _rmq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { _rmq = { matches: false }; } }
  return _rmq.matches;
}
function openShrine(stage, onDone) {
  const rate = stage === 3 ? 1500 : 10000;
  const perTap = Math.max(1, Math.floor(S.balls * 0.01)); // タップ1回=開始時持ち玉の1%
  shrineCtx = { stage, rate, perTap, donated: 0, taps: 0, ended: false, active: false, onDone, timer: null };
  const nm = stage === 3 ? '三の宮' : '七の宮';
  document.getElementById('shrineTtl').textContent = nm + ' 御賽銭';
  document.getElementById('shrineRate').innerHTML = `${fmtN(rate)}玉ごとに <b>運+1</b>`;
  document.getElementById('shrinePerTap').textContent = fmtN(perTap);
  document.getElementById('shrineIntroTtl').textContent = nm + ' にお参り';
  document.getElementById('shrineIntroNote').innerHTML = `1タップ ≈ <b>${fmtN(perTap)}玉</b> を奉納。<br>玉と引き換えに運が上がります。`;
  document.getElementById('shrineReward').classList.remove('show');
  document.getElementById('shrineIntro').classList.add('show');   // まず説明を出す
  document.getElementById('shrineScene').classList.remove('active');
  document.getElementById('shrineMinus').classList.remove('show');
  const bar = document.getElementById('shrineTimerBar');
  bar.style.transition = 'none'; bar.style.width = '100%';
  updateShrineStats();
  document.getElementById('shrineOverlay').classList.add('show');
  sfx('reach');
}
function startShrineTapping() {
  const c = shrineCtx; if (!c || c.active || c.ended) return;
  c.active = true;
  document.getElementById('shrineIntro').classList.remove('show');
  document.getElementById('shrineScene').classList.add('active');
  const bar = document.getElementById('shrineTimerBar');
  bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
  bar.style.transition = 'width 5s linear'; bar.style.width = '0%';
  sfx('push');
  c.timer = setTimeout(endShrine, 5000);
}
function updateShrineStats() {
  const c = shrineCtx; if (!c) return;
  document.getElementById('shrineDonated').textContent = fmtN(c.donated);
  document.getElementById('shrineLuckGain').textContent = '+' + Math.min(3, c.donated / c.rate).toFixed(2);
  document.getElementById('shrineBallsLeft').textContent = fmtN(S.balls);
}
function shrineTap(clientX, clientY) {
  const c = shrineCtx; if (!c || !c.active || c.ended) return;
  const give = Math.min(S.balls, c.perTap);
  if (give <= 0) return; // 玉切れ
  S.balls -= give; c.donated += give; c.taps++;
  updateShrineStats();
  // 賽銭箱を揺らす＆光らせる(神社とは分離)
  const box = document.getElementById('shrineBox');
  box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit');
  const bg = document.getElementById('shrineBoxGlow');
  bg.classList.remove('on'); void bg.offsetWidth; bg.classList.add('on');
  // 「持ち玉がいくら減ったか」を強調(−○玉＆数字を赤く弾ませる)
  const minus = document.getElementById('shrineMinus');
  minus.textContent = '−' + fmtN(give);
  minus.classList.remove('show'); void minus.offsetWidth; minus.classList.add('show');
  const bl = document.querySelector('.shrine-stat .ss-balls');
  bl.classList.remove('dropped'); void bl.offsetWidth; bl.classList.add('dropped');
  shrineTapFX(clientX, clientY, c.taps, give);
}
function shrineTapFX(cx, cy, taps, give) {
  const layer = document.getElementById('shrineFx');
  if (!layer) return;
  const r = layer.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const big = (taps % 10 === 0);
  // 小判・札束がタップ場所から湧き出て落ちる(じゃらじゃら)
  const coins = big ? 22 : 10;
  const glyphs = ['🪙', '💰', '💴', '🪙', '🪙'];
  for (let i = 0; i < coins; i++) {
    const co = document.createElement('div'); co.className = 'shCoin';
    co.textContent = glyphs[(Math.random() * glyphs.length) | 0];
    co.style.left = px + 'px'; co.style.top = py + 'px';
    co.style.setProperty('--dx', ((Math.random() - 0.5) * (big ? 280 : 160)).toFixed(0) + 'px');
    co.style.setProperty('--rot', ((Math.random() - 0.5) * 760).toFixed(0) + 'deg');
    layer.appendChild(co); setTimeout(() => co.remove(), 940);
  }
  // 火花
  const sparks = big ? 18 : 9;
  for (let i = 0; i < sparks; i++) {
    const sp = document.createElement('div'); sp.className = 'shSpark';
    const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * (big ? 95 : 55);
    sp.style.left = px + 'px'; sp.style.top = py + 'px';
    sp.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
    sp.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
    layer.appendChild(sp); setTimeout(() => sp.remove(), 520);
  }
  // 波紋リング
  const rp = document.createElement('div'); rp.className = 'shRipple' + (big ? ' big' : '');
  rp.style.left = px + 'px'; rp.style.top = py + 'px';
  layer.appendChild(rp); setTimeout(() => rp.remove(), 600);
  // −○玉 フロート(タップ場所から溢れる寄進額)
  const mn = document.createElement('div'); mn.className = 'shMinus' + (big ? ' big' : '');
  mn.textContent = '−' + fmtN(give) + '玉';
  mn.style.left = px + 'px'; mn.style.top = py + 'px';
  layer.appendChild(mn); setTimeout(() => mn.remove(), 860);
  // 全画面フラッシュ＆シェイク — 連打でストロボ化しないよう最大~2回/秒に制限(小判/火花/波紋など局所FXは毎タップ出す)。
  // 演出控えめ(fxMax=false)や OSの視覚効果軽減(prefers-reduced-motion)では全画面フラッシュ自体を止める(光過敏配慮)。
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const allowFlash = S.fxMax && !reduceMotion() && (!shrineCtx || !shrineCtx.lastFlash || now - shrineCtx.lastFlash > 480 || big);
  if (allowFlash) {
    if (shrineCtx) shrineCtx.lastFlash = now;
    const scene = document.getElementById('shrineScene');
    scene.classList.remove('shShake'); void scene.offsetWidth; scene.classList.add('shShake');
    const fl = document.getElementById('shrineFlash');
    fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    if (big) { fl.classList.add('bigflash'); setTimeout(() => fl.classList.remove('bigflash'), 240); }
  }
  sfx('heso');
  if (big) sfx('jackpot');
}
function endShrine() {
  const c = shrineCtx; if (!c || c.ended) return;
  c.ended = true; if (c.timer) clearTimeout(c.timer);
  const gain = +Math.min(3, c.donated / c.rate).toFixed(2); // 1回の上限=運+3(暴走防止)
  if (gain > 0) { S.luck = +(S.luck + gain).toFixed(2); }
  document.getElementById('shrineScene').classList.remove('active');
  const rw = document.getElementById('shrineReward');
  rw.innerHTML = gain > 0
    ? `御利益<br><span class="rw-big">運 +${gain.toFixed(2)}</span><br><span class="rw-sub">${fmtN(c.donated)}玉を奉納</span>`
    : `<span class="rw-sub">奉納なし</span>`;
  rw.classList.add('show');
  if (gain > 0) { fx.flashDOM && fx.flashDOM(); sfx('bigwin'); }
  setTimeout(() => {
    document.getElementById('shrineOverlay').classList.remove('show');
    const done = c.onDone; shrineCtx = null;
    updateHUD();
    if (done) done();
  }, 1700);
}

function applyTheme() {
  if (S.simMode) return;
  document.documentElement.style.setProperty('--accent', S.theme.accent);
  document.documentElement.style.setProperty('--accent2', S.theme.accent2);
  buildCabinet();   // 筐体もテーマ色で再塗装
  buildBackdrop();  // 盤面背景アートも再生成
}
function trySettle() {
  if (S.phase !== 'play') return;
  if (S.ballsOnBoard.length > 0 || S.spin || S.hold.length > 0 || S.rush || S.shower > 0) return;
  if (S.shotsLeft <= 0) { settle(); return; }
  if (S.balls <= 0) {
    if (S.free) { S.balls = 25000; return; } // フリーは尽きない
    gameOver('持ち玉が尽きた。');
  }
}
function settle() {
  if (S.balls >= S.quota) {
    S.balls -= S.quota;
    S.stat.paid += S.quota;
    const m = mods();
    let intr = 0;
    if (m.interest > 0) { intr = Math.round(S.balls * m.interest); S.balls += intr; }
    addLog(`💸 ${S.quota}玉 納品完了${intr ? `（利息 +${intr}玉）` : ''}`, 'hit');
    if (!S.simMode && !S.allUnlock) {
      // メタ進行: 累計クリア面数を刻む → 絵柄解禁チェック
      const before = unlockedNow();
      META.stages++;
      saveMeta();
      const news = unlockedNow().filter(id => !before.includes(id));
      for (const id of news) addLog(`🔓 新絵柄 解禁: ${SYMBOLS[id].glyph} ${SYMBOLS[id].name}`, 'hit');
      if (news.length) setTimeout(() => { fx.cutin(`解禁！ ${SYMBOLS[news[0]].glyph} ${SYMBOLS[news[0]].name}`); sfx('bigwin'); }, 1300);
    }
    if (!S.simMode) {
      const st = document.getElementById('stamp');
      st.classList.remove('show'); void st.offsetWidth; st.classList.add('show');
      fx.confettiBurst(70); sfx('pay');
      fx.fireworks(120, 250); fx.fireworks(340, 300, '#ffffff'); // 納品祝いの打ち上げ
    }
    if (!S.free && S.stage >= 10) { openClear(); return; }
    S.phase = 'settle';
    if (S.simMode) { openDraft(); return; }
    setTimeout(openDraft, 1100); // フリーでも無料ドラフト→屋台で積み増しでき、同テーマで無限に続く
  } else if (S.free) {
    // フリーモードは死なない: 玉を補充してそのまま続行
    S.balls = 25000; S.shotsLeft = stageShots(mods());
    addLog('🎬 フリー: 玉を補充して続行', 'hit');
  } else {
    gameOver(`納品 ${S.quota}玉 に対し、持ち玉 ${S.balls}玉。`);
  }
}
function gameOver(reason) {
  S.phase = 'over';
  sfx('death');
  if (S.simMode) return;
  clearRun(); // ラン終了 → セーブ破棄
  document.getElementById('fever').classList.remove('on');
  document.getElementById('gameoverText').innerHTML =
    `${S.loop > 0 ? `${S.loop + 1}周目・` : ''}${S.theme.num}「${S.theme.name}」で力尽きた。${reason}<br>` +
    `3揃い <b>${S.stat.wins}回</b> ／ RUSH <b>${S.stat.rush}回</b> ／ 総獲得 <b>${S.stat.totalWon}玉</b>`;
  document.getElementById('gameoverOverlay').classList.add('show');
}
function openClear() {
  S.phase = 'clear';
  if (S.simMode) return;
  clearRun(); // 全10面クリア → セーブ破棄(次周は新規)
  document.getElementById('fever').classList.remove('on');
  fx.confettiBurst(150);
  try {
    const b = JSON.parse(localStorage.getItem('luckyPachiBest') || '{}');
    if (S.loop + 1 > (b.loops || 0)) localStorage.setItem('luckyPachiBest', JSON.stringify({ loops: S.loop + 1 }));
  } catch (e) {}
  if (!S.allUnlock) {
    // 周回クリアでレジェンド絵柄が解禁されていく
    const before = unlockedNow();
    META.loops = Math.max(META.loops, S.loop + 1);
    saveMeta();
    const news = unlockedNow().filter(id => !before.includes(id));
    for (const id of news) addLog(`🔓 レジェンド絵柄 解禁: ${SYMBOLS[id].glyph} ${SYMBOLS[id].name}`, 'hit');
  }
  document.getElementById('clearText').innerHTML =
    `<b>${S.loop + 1}周目</b> 全10面、計 <b>${S.stat.paid}玉</b> を納品しきった。<br>` +
    `3揃い <b>${S.stat.wins}回</b> ／ RUSH <b>${S.stat.rush}回</b> ／ 総獲得 <b>${S.stat.totalWon}玉</b> ／ 発射 <b>${S.stat.shots}発</b>`;
  {
    const up = Math.round((loopMultAt(S.loop + 1) / loopMultAt(S.loop) - 1) * 100);
    document.getElementById('nextLoopBtn').textContent = `${S.loop + 2}周目に挑む（ノルマ+${up}%・釘シブめ・発射-4発）`;
  }
  document.getElementById('clearOverlay').classList.add('show');
}

// ---------- 絵柄はがし(リール圧縮) ----------
let removeCtx = null;
function removeSymbolCopy(id) {
  const prevSyn = activeSynergies().slice();
  S.symbolPool[id]--;
  if (S.symbolPool[id] <= 0) delete S.symbolPool[id];
  addLog(`🧹 リールから ${SYMBOLS[id].glyph}${SYMBOLS[id].name} を1枚はがした`, 'hit');
  if (!S.simMode) {
    sfx('two');
    fx.floatText(BLOCK.x + BLOCK.w / 2, BLOCK.y + BLOCK.h / 2 + 40, `${SYMBOLS[id].glyph} −1`, '#ff9ecb');
  }
  checkSynergies(prevSyn);
  renderCollections();
  updateHUD();
}
function openSymbolRemove(opts = {}) {
  if (poolTotal() <= 3) { addLog('リールが薄すぎて、これ以上はがせない', 'bad'); if (opts.onCancel) opts.onCancel(); return; }
  // ボット/計測時は最少枚数の絵柄を自動ではがす(DOMで止まらない)
  if (S.simMode || S.allUnlock) {
    const ids = Object.keys(S.symbolPool).filter(id => S.symbolPool[id] > 0);
    let worst = ids[0];
    for (const id of ids) if (S.symbolPool[id] < S.symbolPool[worst]) worst = id;
    removeSymbolCopy(worst);
    if (opts.onDone) opts.onDone();
    return;
  }
  removeCtx = opts;
  const grid = document.getElementById('removeGrid');
  grid.innerHTML = '';
  for (const [id, n] of Object.entries(S.symbolPool)) {
    if (n <= 0) continue;
    const s = SYMBOLS[id];
    const el = document.createElement('button');
    el.className = 'buildCard';
    el.innerHTML =
      `<div class="g">${s.glyph}</div><div class="n">${s.name} ×${n}</div>` +
      `<div class="d">${s.desc.replace('3揃い: ', '')}</div>` +
      symbolRoleTagsHTML(id);
    el.onclick = () => {
      removeSymbolCopy(id);
      document.getElementById('removeOverlay').classList.remove('show');
      const done = removeCtx && removeCtx.onDone;
      removeCtx = null;
      if (done) done();
    };
    grid.appendChild(el);
  }
  document.getElementById('removeCancel').textContent = opts.refund ? 'やめる（返金）' : '使わない';
  document.getElementById('removeOverlay').classList.add('show');
}

// ---------- ドラフト＆ショップ(レアリティ制) ----------
function rollRarity() {
  // 5面以降は固定レート: レジェンド15%(3/20)・レア35%(7/20)・ノーマル50%(10/20)
  const lg = S.stage >= 5 ? 0.15 : Math.min(0.12, 0.04 + S.stage * 0.007);
  const rw = Math.min(0.5, (S.stage >= 5 ? 0.35 : 0.28) + mods().rareBias); // 福引補助券系でレア率UP
  const r = rng();
  return r < lg ? 'legend' : r < lg + rw ? 'rare' : 'normal';
}
function rollDraftCard(depth = 0, forceRarity) {
  if (depth > 10) { // フォールバック
    return { kind: 'symbol', rarity: 'normal', id: 'cherry', name: SYMBOLS.cherry.name, desc: SYMBOLS.cherry.desc, glyph: SYMBOLS.cherry.glyph };
  }
  const rar = forceRarity || rollRarity();
  const r = rng();
  // (絵柄はがしチケットは廃止。間引きは屋台で3面に1回だけ = デッキ構築を主役に)
  if (r < 0.35) {
    const cand = Object.keys(BALLS).filter(k => k !== 'shiro' && BALLS[k].rarity === rar);
    if (cand.length) {
      const id = pick(cand);
      return { kind: 'ball', rarity: rar, id, name: BALLS[id].name, desc: BALLS[id].desc, color: BALLS[id].color };
    }
  }
  if (r < 0.62) {
    const cand = Object.keys(SYMBOLS).filter(k => SYMBOLS[k].rarity === rar && symbolUnlocked(k));
    if (cand.length) {
      const id = pick(cand);
      return { kind: 'symbol', rarity: rar, id, name: SYMBOLS[id].name, desc: `リールに${SYMBOLS[id].glyph}を1個追加。${SYMBOLS[id].desc}`, glyph: SYMBOLS[id].glyph };
    }
  }
  if (r < 0.8 && freeSlots().length > 0) {
    const cand = Object.keys(PARTS).filter(k => PARTS[k].rarity === rar && !S.parts.some(p => p.id === k));
    if (cand.length) {
      const id = pick(cand);
      return { kind: 'part', rarity: rar, id, name: PARTS[id].name, desc: `盤面に設置: ${PARTS[id].desc}`, icon: PARTS[id].icon };
    }
  }
  const avail = RELICS.filter(x => x.rarity === rar && !S.relics.some(o => o.id === x.id));
  if (avail.length === 0) return rollDraftCard(depth + 1, forceRarity);
  const rel = pick(avail);
  return { kind: 'relic', rarity: rar, id: rel.id, name: rel.name, desc: rel.desc, icon: rel.icon, rel };
}
// 取得後の共通処理(シナジー再判定・レジェンド演出・再描画)
function afterAcquire(card, prevSyn) {
  if (card.rarity === 'legend' && !S.simMode) { // レジェンド入手はド派手に
    S.aberr = 1.6; S.glitchT = 0.22;
    fx.confettiBurst(80);
    fx.fireworks(230, 240);
    sfx('jackpot');
  }
  checkSynergies(prevSyn);
  renderCollections();
  updateHUD();
}
function acquire(card) {
  const prevSyn = activeSynergies().slice();
  if (card.kind === 'ball') { S.deck.push(card.id); S.bag = []; markDex('ball', card.id); addLog(`玉デッキに「${card.name}」追加`, 'hit'); }
  if (card.kind === 'symbol') { S.symbolPool[card.id] = (S.symbolPool[card.id] || 0) + 1; markDex('sym', card.id); addLog(`リールに ${SYMBOLS[card.id].glyph} 追加`, 'hit'); }
  if (card.kind === 'relic') { S.relics.push(card.rel); markDex('relic', card.id); modsDirty(); if (card.rel.fx.removePins) refreshPins(); addLog(`お守り「${card.name}」入手`, 'hit'); }
  if (card.kind === 'part') installPart(card.id); // ランダム(sim/プログラム経由のみ。UIは設置場所を選ばせる)
  if (card.kind === 'symRemoveTicket') openSymbolRemove({});
  afterAcquire(card, prevSyn);
}
// ---------- 選択の確認ダイアログ ----------
function confirmSelect(card, price, onOk) {
  const ov = document.getElementById('confirmOverlay');
  const isPart = card.kind === 'part';
  const icon = card.kind === 'ball'
    ? `<span class="dot2" style="background:radial-gradient(circle at 35% 35%, #fff, ${card.color});color:${card.color}"></span>`
    : card.kind === 'symbol' ? card.glyph : card.icon;
  const kindLabel = card.kind === 'ball' ? '玉デッキ' : card.kind === 'symbol' ? 'リール絵柄'
    : card.kind === 'part' ? '盤面役物' : card.kind === 'relic' ? 'お守り' : 'アイテム';
  document.getElementById('cfKind').textContent = `${RARITY_LABEL[card.rarity] || ''}・${kindLabel}`;
  document.getElementById('cfIcon').innerHTML = icon;
  document.getElementById('cfName').innerHTML =
    `<span class="cfrar" style="color:${RARITY_COLOR[card.rarity] || '#ccc'}">${RARITY_LABEL[card.rarity] || ''}</span> ${card.name}`;
  document.getElementById('cfDesc').innerHTML =
    card.desc + synergyGainHTML(card, false) + (card.kind === 'symbol' ? symbolRoleTagsHTML(card.id) : '') +
    (isPart ? '<div class="cf-hint">次に盤面で設置場所を選びます</div>' : '');
  const pr = document.getElementById('cfPrice');
  pr.style.display = price != null ? 'block' : 'none';
  if (price != null) pr.innerHTML = `支払い <b>${price}玉</b>　→　残り ${Math.max(0, S.balls - price)}玉`;
  const ok = document.getElementById('cfOk');
  ok.textContent = isPart ? '設置場所を選ぶ →' : (price != null ? 'これを買う' : 'これにする');
  ok.onclick = () => { ov.classList.remove('show'); sfx('tick'); onOk(); };
  document.getElementById('cfCancel').onclick = () => { ov.classList.remove('show'); sfx('tick'); };
  ov.classList.add('show');
}
// ---------- 盤面役物: 設置場所を自分で選ぶ ----------
let placeCtx = null;
function startPlacement(card, onPlaced, onCancel) {
  placeCtx = { card, onPlaced, onCancel };
  S.cam.z = 1; S.cam.py = 390; S.cam.punch = 0; // カメラをデフォルト固定→盤面座標とDOMを一致
  S.placing = true;
  document.getElementById('plName').innerHTML = `${card.icon} ${card.name}`;
  document.getElementById('placeOverlay').classList.add('show');
  layoutPlaceSlots();
}
function layoutPlaceSlots() {
  const box = document.getElementById('placeSlots');
  if (!box || !placeCtx) return;
  box.innerHTML = '';
  const w = cv.clientWidth, h = cv.clientHeight, l = cv.offsetLeft, t = cv.offsetTop;
  const sx = w / CFG.CW, sy = h / CFG.CH;
  for (const sl of PART_SLOTS) {
    const occ = S.parts.find(p => p.x === sl.x && p.y === sl.y);
    const cxp = CFG.FX + sl.x, cyp = CFG.FY + sl.y; // z=1,py=390 の写像
    const btn = document.createElement('button');
    btn.className = 'placeSlot' + (occ ? ' occ' : '');
    btn.style.left = (l + cxp * sx) + 'px';
    btn.style.top = (t + cyp * sy) + 'px';
    if (occ) {
      btn.innerHTML = `<span class="ps-ic">${occ.icon}</span>`;
      btn.disabled = true;
    } else {
      btn.innerHTML = `<span class="ps-plus">＋</span><span class="ps-ic ghost">${placeCtx.card.icon}</span>`;
      btn.onclick = () => commitPlacement(sl);
    }
    box.appendChild(btn);
  }
}
function commitPlacement(sl) {
  const { card, onPlaced } = placeCtx;
  const prevSyn = activeSynergies().slice();
  installPartAt(card.id, sl);
  afterAcquire(card, prevSyn);
  sfx('heso'); fx.confettiBurst(20);
  endPlacement();
  if (onPlaced) onPlaced();
}
function cancelPlacement() {
  const cb = placeCtx && placeCtx.onCancel;
  endPlacement();
  if (cb) cb();
}
function endPlacement() {
  S.placing = false;
  placeCtx = null;
  document.getElementById('placeOverlay').classList.remove('show');
}
// ---------- 戦利品/屋台の選択(確認→パーツは設置場所選択) ----------
function selectDraft(card) {
  confirmSelect(card, null, () => {
    if (card.kind === 'part') {
      document.getElementById('draftOverlay').classList.remove('show');
      startPlacement(card,
        () => closeDraft(),
        () => document.getElementById('draftOverlay').classList.add('show'));
    } else {
      acquire(card); closeDraft();
    }
  });
}
// 銭飛翔: 持ち玉HUDから商品へコインが弧を描いて飛ぶ(購入の手応え)
function coinFlight(item) {
  const from = document.getElementById('balls');
  const rows = [...document.querySelectorAll('.shopItem')];
  const to = rows.find(r => r.dataset.item === (item.kind + ':' + (item.id || item.name))) || rows[0];
  if (!from || !to) return;
  const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
  const x0 = fr.left + fr.width / 2, y0 = fr.top + fr.height / 2;
  const x1 = tr.left + tr.width * 0.8, y1 = tr.top + tr.height / 2;
  const n = Math.min(9, 4 + Math.floor((item.price || 100) / 150));
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'flyCoin';
    document.body.appendChild(c);
    const t0 = performance.now() + i * 55;
    const cx = (x0 + x1) / 2 + (Math.random() - 0.5) * 120, cy = Math.min(y0, y1) - 90 - Math.random() * 60;
    const step = now => {
      const p = Math.min(1, (now - t0) / 420);
      if (p < 0) { requestAnimationFrame(step); return; }
      const q = 1 - p;
      const x = q * q * x0 + 2 * q * p * cx + p * p * x1;
      const y = q * q * y0 + 2 * q * p * cy + p * p * y1;
      c.style.transform = `translate(${x}px,${y}px) rotate(${p * 720}deg) scale(${1 - p * 0.35})`;
      c.style.opacity = p > 0.9 ? String((1 - p) * 10) : '1';
      if (p < 1) requestAnimationFrame(step);
      else { c.remove(); if (sndOK()) beep(1300 + Math.random() * 500, 0.05, 'sine', 0.05); }
    };
    requestAnimationFrame(step);
  }
}
function selectShop(item) {
  confirmSelect(item, item.price, () => {
    const commitBuy = () => { S.balls -= item.price; item.bought = true; item.freshStamp = true; coinFlight(item); };
    if (item.kind === 'part') {
      document.getElementById('shopOverlay').classList.remove('show');
      startPlacement(item,
        () => { commitBuy(); document.getElementById('shopOverlay').classList.add('show'); renderShop(); updateHUD(); },
        () => document.getElementById('shopOverlay').classList.add('show'));
    } else if (item.kind === 'thin') {
      commitBuy();
      const prevSyn = activeSynergies().slice();
      const i = S.deck.indexOf('shiro');
      if (i >= 0) S.deck.splice(i, 1);
      S.bag = [];
      addLog('白玉を1つ間引いた', 'hit');
      checkSynergies(prevSyn);
      renderCollections();
      sfx('heso'); renderShop(); updateHUD();
    } else if (item.kind === 'symRemove') {
      commitBuy();
      openSymbolRemove({
        refund: true,
        onDone: () => { renderShop(); updateHUD(); },
        onCancel: () => { S.balls += item.price; delete item.bought; renderShop(); updateHUD(); },
      });
      sfx('heso'); renderShop(); updateHUD();
    } else {
      commitBuy(); acquire(item);
      sfx('heso'); renderShop(); updateHUD();
    }
  });
}
// ドラムロール(開封のタメ)
function drumroll(dur) {
  if (!sndOK()) return;
  const n = Math.floor(dur / 0.045);
  for (let i = 0; i < n; i++) boomNoise(0.05, 0.03, i * 0.045);
}
function renderDraftInv() {
  const map = { diDeck: deckChipsHTML(), diReel: reelChipsHTML(), diRelic: relicChipsHTML(), diPart: partChipsHTML() };
  for (const id in map) { const el = document.getElementById(id); if (el) el.innerHTML = map[id]; }
}
function openDraft() {
  if (S.phase !== 'settle') return; // reset/goStage後の古いsetTimeout誤発火ガード
  S.phase = 'draft';
  if (S.simMode) { startStage(S.stage + 1); return; }
  renderDraftInv();
  const box = document.getElementById('draftCards');
  box.innerHTML = '';
  const seen = new Set();
  const count = 3; // 選択肢は常に3つまで
  // 4面・7面クリア後は3択が全部レジェンド確定(覚醒役の主を選び放題にする節目)
  const allLegend = (S.stage === 4 || S.stage === 7) && !S.free;
  for (let i = 0; i < count; i++) {
    const forceRar = allLegend ? 'legend' : undefined;
    let card = rollDraftCard(0, forceRar), guard = 0;
    while (seen.has(card.kind + card.id) && guard++ < 15) card = rollDraftCard(0, forceRar);
    seen.add(card.kind + card.id);
    const el = document.createElement('button');
    el.className = `draftCard ${card.rarity} dealing`;
    el.style.setProperty('--i', i);
    const icon = card.kind === 'ball'
      ? `<span class="dot2" style="background:radial-gradient(circle at 35% 35%, #fff, ${card.color});color:${card.color}"></span>`
      : card.kind === 'symbol' ? card.glyph : card.icon;
    const kindLabel = card.kind === 'ball' ? 'BALL' : card.kind === 'symbol' ? 'REEL' : 'RELIC';
    el.innerHTML =
      `<div class="cardInner"><div class="cfFace cfFront">` +
      `<div class="kind">${RARITY_LABEL[card.rarity]}・${kindLabel}</div>` +
      `<div class="icon">${icon}</div><div class="nm">${card.name}</div><div class="ds">${card.desc}</div>` +
      synergyGainHTML(card, true) + (card.kind === 'symbol' ? symbolRoleTagsHTML(card.id) : '') +
      `<div class="holo"></div>` +
      `</div></div>`;
    // 3Dチルト(指/マウス位置でカードが傾き、ホロの光沢が流れる)
    el.addEventListener('pointermove', ev => {
      const r = el.getBoundingClientRect();
      const nx = (ev.clientX - r.left) / r.width - 0.5;
      const ny = (ev.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', (-ny * 10) + 'deg');
      el.style.setProperty('--ry', (nx * 12) + 'deg');
      el.style.setProperty('--mx', (nx * 100 + 50) + '%');
      el.style.setProperty('--my', (ny * 100 + 50) + '%');
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
    });
    el.onclick = () => selectDraft(card);
    box.appendChild(el);
    if (card.rarity === 'legend') { // レジェンド出現は登場時に一発演出だけ残す
      setTimeout(() => { fx.flashDOM(); sfx('jackpot'); fx.confettiBurst(60); }, 200 + i * 140);
    }
  }
  document.getElementById('draftOverlay').classList.add('show');
}
function closeDraft() {
  document.getElementById('draftOverlay').classList.remove('show');
  openShop();
}
let shopStock = [];
function priceAt(base) {
  return Math.round(base * Math.pow(CFG.shopPriceGrow, S.stage - 1) * (1 - mods().shopDiscount));
}
function openShop() {
  S.phase = 'shop';
  // 直前の一時オーバーレイが残っていると「次の面へ」ボタンを覆って進めなくなるため確実に閉じる
  ['placeOverlay', 'confirmOverlay', 'symDetailOverlay', 'glossaryOverlay', 'draftOverlay'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove('show');
  });
  shopStock = [];
  const seen = new Set();
  const hasThin = S.deck.filter(d => d === 'shiro').length > 1;
  // 常に3枚の「積む」商品を並べてデッキ構築を主役に
  for (let i = 0; i < 3; i++) {
    let card = rollDraftCard(), guard = 0;
    while (seen.has(card.kind + card.id) && guard++ < 15) card = rollDraftCard();
    seen.add(card.kind + card.id);
    card.price = priceAt(RARITY_PRICE[card.rarity] + (card.kind === 'symbol' ? 40 : 0));
    shopStock.push(card);
  }
  // 間引き(削る)は3面に1回だけ。積む楽しさを邪魔しない
  if ((S.cullCd || 0) <= 0) {
    if (poolTotal() > 3) {
      shopStock.push({ kind: 'symRemove', rarity: 'normal', name: '絵柄はがし', desc: 'リールから好きな絵柄を1枚削除(残りが揃いやすくなる)', icon: '🧹', price: priceAt(190) });
      S.cullCd = 3;
    } else if (hasThin) {
      shopStock.push({ kind: 'thin', rarity: 'normal', name: '白玉を間引く', desc: '白玉を1つデッキから除去(当たり玉が濃くなる)', icon: '✂️', price: priceAt(120) });
      S.cullCd = 3;
    }
  }
  renderShop();
  document.getElementById('shopOverlay').classList.add('show');
}
function renderShopInv() {
  const map = { siDeck: deckChipsHTML(), siReel: reelChipsHTML(), siRelic: relicChipsHTML(), siPart: partChipsHTML() };
  for (const id in map) { const el = document.getElementById(id); if (el) el.innerHTML = map[id]; }
}
function renderShop() {
  document.getElementById('shopSub').textContent =
    `持ち玉 ${S.balls}玉 ／ 次の納品 ${S.free ? 800 : quotaFor(S.stage + 1)}玉`;
  renderShopInv();
  const box = document.getElementById('shopItems');
  box.innerHTML = '';
  for (const item of shopStock) {
    const btn = document.createElement('button');
    btn.className = `shopItem r-${item.rarity || 'normal'}` + (item.bought ? ' sold' : '');
    btn.dataset.item = item.kind + ':' + (item.id || item.name);
    btn.disabled = item.bought || S.balls < item.price;
    const ic = item.kind === 'ball'
      ? `<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 35%, #fff, ${item.color})"></span>`
      : item.kind === 'symbol' ? item.glyph : item.icon;
    btn.innerHTML =
      `<span class="ic">${ic}</span><span>` +
      `<div class="nm"><span class="rar" style="color:${RARITY_COLOR[item.rarity]}">${RARITY_LABEL[item.rarity]}</span> ${item.name}${item.kind === 'symbol' ? 'を追加' : ''}</div>` +
      `<div class="ds">${item.desc}</div>` +
      synergyGainHTML(item, true) + (item.kind === 'symbol' ? symbolRoleTagsHTML(item.id) : '') +
      `</span><span class="pr">${item.bought ? '' : (S.balls < item.price ? `${item.price}玉<br><span class="short">あと${fmtN(item.price - S.balls)}玉</span>` : item.price + '玉')}</span>` +
      (item.bought ? `<span class="soldStamp${item.freshStamp ? ' fresh' : ''}">売約</span>` : '');
    if (item.bought && item.freshStamp) { setTimeout(() => { item.freshStamp = false; }, 700); if (sndOK()) { boomNoise(0.12, 0.07, 0.15); } }
    btn.onclick = () => { if (btn.disabled) return; selectShop(item); };
    box.appendChild(btn);
  }
}
function closeShop() {
  shopStock.forEach(i => delete i.bought);
  document.getElementById('shopOverlay').classList.remove('show');
  startStage(S.free ? 1 : S.stage + 1); // フリーは同じテーマで無限ループ
}

// ---------- 開始リール選択(スタータービルド) ----------
// 1枚ずつ薄く配る = 序盤はほぼ揃わない。面クリアのドラフトで同じ絵柄を重ねて「濃く」して初めて揃い出す
// 開始7枚(各1枚)→ N=7で揃い率約5%。ドラフトで積んで最終的に計15枚前後
// 初期はノーマル6枚だけ(レア撤去)。序盤に7は存在すらしない=ゴミから積み上げる
const BUILD_STEPS = [
  { rarity: 'normal', copies: 1, label: '1枚目 — 選んだ絵柄が ×1枚 入る' },
  { rarity: 'normal', copies: 1, label: '2枚目 — ×1枚' },
  { rarity: 'normal', copies: 1, label: '3枚目 — ×1枚' },
  { rarity: 'normal', copies: 1, label: '4枚目 — ×1枚' },
  { rarity: 'normal', copies: 1, label: '5枚目 — ×1枚' },
  { rarity: 'normal', copies: 1, label: '6枚目 — ×1枚' },
];
let buildStep = 0;
function openBuild() {
  S.phase = 'build';
  buildStep = 0;
  S.symbolPool = {};
  renderBuild();
  document.getElementById('buildOverlay').classList.add('show');
}
function renderBuild() {
  const st = BUILD_STEPS[buildStep];
  document.getElementById('buildTitle').innerHTML =
    `開始リールを組め <span style="color:var(--accent)">${buildStep + 1} / ${BUILD_STEPS.length}</span>`;
  document.getElementById('buildSub').textContent =
    st.label + (st.rarity === 'normal' ? '（同じ絵柄を2枚以上に増やすのは、面クリア後のごほうびで）' : '');
  const grid = document.getElementById('buildGrid');
  grid.innerHTML = '';
  // 解禁済み&未取得からランダム3択(選択肢は常に3つまで)
  const pool = Object.keys(SYMBOLS).filter(id =>
    SYMBOLS[id].rarity === st.rarity && symbolUnlocked(id) && !S.symbolPool[id]);
  const opts = [];
  const tmp = pool.slice();
  while (opts.length < 3 && tmp.length) opts.push(tmp.splice((rng() * tmp.length) | 0, 1)[0]);
  for (const id of opts) {
    const s = SYMBOLS[id];
    const el = document.createElement('button');
    el.className = `buildCard${st.rarity === 'rare' ? ' rare' : ''}`;
    el.innerHTML =
      `<div class="g">${s.glyph}</div><div class="n">${s.name}</div>` +
      `<div class="d">${s.desc.replace('3揃い: ', '')}</div>` +
      symbolRoleTagsHTML(id);
    el.onclick = () => {
      const prevSyn = activeSynergies().slice();
      S.symbolPool[id] = (S.symbolPool[id] || 0) + st.copies;
      markDex('sym', id);
      sfx('heso');
      checkSynergies(prevSyn);
      buildStep++;
      if (buildStep >= BUILD_STEPS.length) {
        document.getElementById('buildOverlay').classList.remove('show');
        renderCollections();
        addLog('リール構成 完成。開店！', 'hit');
        startStage(1);
      } else renderBuild();
    };
    grid.appendChild(el);
  }
  // 未解禁の匂わせ(スルメ)
  const lockedN = Object.keys(SYMBOL_UNLOCKS).filter(id => !symbolUnlocked(id)).length;
  const next = nextUnlockInfo();
  const lk = document.getElementById('buildLocked');
  if (lk) lk.textContent = lockedN > 0
    ? `🔒 未解禁の絵柄 ×${lockedN}${next ? `（次の解禁まで あと${next.rem}面クリア）` : '（残りは周回クリアで解禁）'}`
    : '';
  renderBuildPicked();
}
function renderBuildPicked() {
  document.getElementById('buildPicked').innerHTML = Object.entries(S.symbolPool)
    .map(([id, n]) => `<span class="chip sym">${SYMBOLS[id].glyph}<span class="cnt">×${n}</span></span>`)
    .join('') || '<span style="color:var(--dim);font-size:10px;font-weight:600">まだ空のリール</span>';
}

// ---------- セーブ / ロード(途中再開) ----------
// 面の開始時(盤面が空の瞬間)にビルド一式を保存 → 閉じても「つづきから」で同じ面の頭に戻れる
function saveRun() {
  if (S.simMode || S.allUnlock) return;
  try {
    const sv = {
      v: 1, stage: S.stage, loop: S.loop, balls: S.balls,
      deck: S.deck.slice(), symbolPool: { ...S.symbolPool },
      relics: S.relics.map(r => r.id),
      parts: S.parts.map(p => ({ id: p.id, x: p.x, y: p.y, dir: p.dir })),
      luck: S.luck, mult: S.mult, hesoPayPerm: S.hesoPayPerm || 0,
      winBoostV: S.winBoostV || 1, winBoostN: S.winBoostN || 0,
      feverGauge: S.feverGauge || 0, rightHit: !!S.rightHit,
      stat: S.stat,
    };
    localStorage.setItem('luckyPachiSave', JSON.stringify(sv));
  } catch (e) {}
}
function loadRun() { try { return JSON.parse(localStorage.getItem('luckyPachiSave') || 'null'); } catch (e) { return null; } }
function clearRun() { try { localStorage.removeItem('luckyPachiSave'); } catch (e) {} }
function hasSave() { const s = loadRun(); return !!(s && s.stage); }
function continueRun() {
  const sv = loadRun();
  if (!sv) return false;
  ensureAudio();
  resetTransient();               // 一過性(演出/物理)だけ初期化
  S.loop = sv.loop || 0;
  S.balls = sv.balls;
  S.deck = sv.deck.slice();
  S.symbolPool = { ...sv.symbolPool };
  S.relics = (sv.relics || []).map(id => RELICS.find(r => r.id === id)).filter(Boolean);
  S.parts = (sv.parts || []).map(p => ({ id: p.id, ...PARTS[p.id], x: p.x, y: p.y, dir: p.dir, ang: 0, flash: 0 }));
  S.luck = sv.luck; S.mult = sv.mult; S.hesoPayPerm = sv.hesoPayPerm || 0;
  S.winBoostV = sv.winBoostV || 1; S.winBoostN = sv.winBoostN || 0; S.winBoostThis = 1; S.winBoostGranted = false;
  S.free = false; document.getElementById('homeBtn').style.display = 'none';
  S.feverGauge = sv.feverGauge || 0; S.fever = null;
  S.rightHit = !!sv.rightHit;
  S.stat = sv.stat || { shots: 0, heso: 0, wins: 0, rush: 0, totalWon: 0, paid: 0 };
  modsDirty(); synDirty();
  buildBoard();
  for (const id of ['titleOverlay', 'gameoverOverlay', 'clearOverlay', 'shopOverlay', 'draftOverlay', 'buildOverlay', 'removeOverlay', 'dexOverlay'])
    document.getElementById(id).classList.remove('show');
  const hb = document.getElementById('hitBtn');
  hb.classList.toggle('on', S.rightHit); hb.textContent = S.rightHit ? '右打ち' : '左打ち';
  logLines.length = 0;
  addLog(`— つづきから：${THEMES[Math.min(sv.stage, 10) - 1].num} を再開 —`, 'hit');
  renderCollections();
  startStage(sv.stage);          // その面の頭からやり直し
  return true;
}
// 一過性の状態だけ初期化(ビルドは触らない)。resetGameとcontinueRunで共有
function resetTransient() {
  Object.assign(S, {
    phase: 'play', simMode: false, allUnlock: false, free: false,
    bag: [], magnetPulse: 0, lastFiredType: 'shiro',
    hold: [], spin: null, rush: null, ballsOnBoard: [], winFx: null, charFx: null,
    power: 0.62, targetPower: 0.62, fireCd: 0,
    shower: 0, showerCd: 0,
    aimBins: Array.from({ length: 8 }, () => ({ shots: 0, heso: 0 })),
    particles: [], floats: [], rings: [], coins: [], confetti: [], ambient: [], rockets: [],
    coinRain: [], celebrate: null, rushWon: 0,
    shake: 0, boardFlash: 0, lastDigits: null,
    timeScale: 1, tsTimer: 0, aberr: 0, glitchT: 0,
    cam: { z: 1, py: 390, punch: 0, rot: 0 },
  });
  document.getElementById('fever').classList.remove('on');
  removeCtx = null;
}

// ---------- リセット ----------
function resetGame(opts = {}) {
  clearRun();                     // 新規開始は旧セーブを破棄
  META.games = (META.games || 0) + 1; saveMeta();
  const free = !!opts.free;
  Object.assign(S, {
    phase: 'play', stage: 1, theme: THEMES[0],
    balls: free ? 30000 : CFG.startBalls, quota: 0, shotsLeft: 0,
    deck: ['shiro', 'shiro', 'shiro', 'shiro', 'shiro', 'shiro'], bag: [],
    symbolPool: {},
    relics: [], parts: [], luck: CFG.luckStart, mult: 1, hesoPayPerm: 0, magnetPulse: 0, lastFiredType: 'shiro',
    winBoostV: 1, winBoostN: 0, winBoostThis: 1, winBoostGranted: false, // 役倍率(nextMult)
    allUnlock: false, cullCd: 2, // 間引き商品のクールダウン(最初は序盤を積みに集中)
    hold: [], spin: null, rush: null, ballsOnBoard: [], winFx: null, charFx: null,
    power: 0.62, targetPower: 0.62, fireCd: 0, rightHit: false,
    shower: 0, showerCd: 0, simMode: false,
    aimBins: Array.from({ length: 8 }, () => ({ shots: 0, heso: 0 })),
    particles: [], floats: [], rings: [], coins: [], confetti: [], ambient: [], rockets: [],
    coinRain: [], celebrate: null, rushWon: 0,
    fever: null, feverGauge: 0,
    festComboActive: false, festStreak: 0, comboBonusMult: 0, // 宴覚醒: 連チャンで倍率が伸び、途切れると0に戻る
    shake: 0, boardFlash: 0, lastDigits: null,
    timeScale: 1, tsTimer: 0, aberr: 0, glitchT: 0,
    cam: { z: 1, py: 390, punch: 0, rot: 0 },
    stat: { shots: 0, heso: 0, wins: 0, rush: 0, totalWon: 0, paid: 0 },
  });
  // フリーモード: openBuildの前にフラグを立てる(renderBuildが全解禁で描かれるように)
  S.free = free;
  S.freeTheme = opts.theme || 1;
  S.allUnlock = free; // 全絵柄を選べる(メタ進行は汚さない)
  document.getElementById('fever').classList.remove('on');
  document.getElementById('homeBtn').style.display = free ? 'inline-block' : 'none';
  logLines.length = 0;
  modsDirty();
  synDirty();
  buildBoard();
  renderCollections();
  updateHUD();
  for (const id of ['titleOverlay', 'gameoverOverlay', 'clearOverlay', 'shopOverlay', 'draftOverlay', 'buildOverlay', 'removeOverlay', 'dexOverlay', 'freeOverlay'])
    document.getElementById(id).classList.remove('show');
  removeCtx = null;
  const hb = document.getElementById('hitBtn');
  hb.classList.remove('on');
  hb.textContent = '左打ち';
  openBuild(); // 開始リール選択 → 完了後に第一面へ
}

// ---------- HUD ----------
const logLines = [];
function addLog(msg, cls) {
  logLines.unshift({ msg, cls });
  if (logLines.length > 7) logLines.pop();
  if (S.simMode) return;
  document.getElementById('log').innerHTML =
    logLines.slice().reverse().map(l => `<div class="${l.cls || ''}">${l.msg}</div>`).join('');
}
// 持ち玉表示の整形: 〜9999は数字のまま、1万以上は万、1億以上は億へ圧縮(数値部は必ず4文字以内)
function formatBallsHUD(value) {
  const num = Number(value);
  const exact = Math.max(0, Math.floor(Number.isFinite(num) ? num : 0));
  if (exact < 10000) return { exact, digits: String(exact), unit: '玉' };
  const divisor = exact < 100000000 ? 10000 : 100000000;
  const unit = exact < 100000000 ? '万' : '億';
  const scaled = exact / divisor;
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;   // 常に4文字以内
  const factor = 10 ** decimals;
  const digits = (Math.floor(scaled * factor) / factor).toFixed(decimals);
  return { exact, digits, unit };
}
function updateHUD() {
  if (S.simMode) return;
  document.getElementById('stageLabel').textContent = S.free
    ? `フリー「${S.theme.name}」`
    : `${S.loop > 0 ? `${S.loop + 1}周目 ` : ''}${S.theme.num}「${S.theme.name}」 ${S.stage} / 10`;
  document.getElementById('quotaAmount').innerHTML = `${S.quota}<span>玉</span>`;
  document.getElementById('shotsLeft').textContent = Math.max(0, S.shotsLeft);
  const total = stageShots(mods());
  const bar = document.getElementById('shotsBar');
  bar.style.width = `${Math.max(0, (S.shotsLeft / total) * 100)}%`;
  bar.classList.toggle('low', S.shotsLeft / total < 0.25);
  // 持ち玉オドメーター(変わった桁だけ回転)。1万以上は万/億へ圧縮(常に4文字以内)し10億でもHUDからはみ出さない
  const bEl = document.getElementById('balls');
  const shown = formatBallsHUD(S.balls);
  const str = shown.digits;
  const prev = bEl.dataset.v || '';
  const prevUnit = bEl.dataset.unit || '';
  const exactLabel = `${shown.exact.toLocaleString('ja-JP')}玉`;
  bEl.title = exactLabel;                       // 完全値はツールチップ/読み上げに残す
  bEl.setAttribute('aria-label', `持ち玉 ${exactLabel}`);
  if (prev !== str || prevUnit !== shown.unit) {
    let html = '';
    for (let i = 0; i < str.length; i++) {
      const changed = prev.length !== str.length || prev[i] !== str[i];
      html += `<span class="dg${changed ? ' roll' : ''}">${str[i]}</span>`;
    }
    bEl.innerHTML = `<span class="digits">${html}</span><span class="unit">${shown.unit}</span>`;
    bEl.dataset.v = str;
    bEl.dataset.unit = shown.unit;
  }
  document.getElementById('luckV').textContent = effLuck().toFixed(1);
  const em = effMult();
  document.getElementById('multV').textContent = '×' + em.toFixed(2);
  const sm = synergyMult();
  const synEl = document.getElementById('synV');
  if (synEl) {
    synEl.textContent = '×' + sm.toFixed(2);
    synEl.style.color = sm > 1 ? '#ff4dff' : '';
  }
  // 「今の合計倍率」= 倍率 × 相乗 × FEVER × 役倍率(次の当たり×N) を全部掛けた実際に乗る倍率
  const fev = S.fever ? 2 : 1;
  const nm = (S.winBoostN > 0) ? (S.winBoostV || 1) : 1;
  const totalMult = em * sm * fev * nm;
  const mtEl = document.getElementById('multTotal');
  if (mtEl) {
    mtEl.textContent = '×' + (totalMult >= 100 ? Math.round(totalMult) : totalMult.toFixed(totalMult >= 10 ? 1 : 2));
    const box = document.getElementById('multBox');
    if (box) box.classList.toggle('hot', totalMult >= 4);
    const parts = [`倍率 ${em.toFixed(2)}`];
    if (sm > 1.001) parts.push(`相乗 ${sm.toFixed(2)}`);
    if (fev > 1) parts.push('FEVER 2');
    if (nm > 1) parts.push(`役倍率 ${nm}`);
    const mb = document.getElementById('multBreak');
    if (mb) mb.innerHTML = totalMult > 1.01
      ? parts.join(' <span class="mx">×</span> ')
      : '<span class="mbhint">まだ×1。🌙や役で上げると当たりの玉が全部この倍に</span>';
  }
  // 発射つよさバー
  leverDraw();
  const pwb = document.getElementById('pwBar');
  if (pwb && pwb.children.length) {
    const on = Math.round(S.power * pwb.children.length);
    for (let i = 0; i < pwb.children.length; i++) pwb.children[i].classList.toggle('on', i < on);
  }
}
// 持ちアイテムのチップHTML(サイドパネルと屋台の「持ち物」で共用)
function deckChipsHTML() {
  const counts = {};
  for (const d of S.deck) counts[d] = (counts[d] || 0) + 1;
  return Object.entries(counts).map(([id, n]) => {
    const b = BALLS[id];
    return `<span class="chip"><span class="dot" style="background:${b.color};color:${b.color}"></span>${b.name}<span class="cnt">×${n}</span><span class="tip">${b.desc}</span></span>`;
  }).join('');
}
function reelChipsHTML() {
  return Object.entries(S.symbolPool)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `<span class="chip sym tapInfo" data-sym="${id}" role="button" tabindex="0">${SYMBOLS[id].glyph}<span class="cnt">×${n}</span><span class="tip"><b>${SYMBOLS[id].name}</b><br>${SYMBOLS[id].desc}<br><span class="tapHint">タップで狙える役をぜんぶ見る</span></span></span>`)
    .join('');
}
function relicChipsHTML() {
  return S.relics.length
    ? S.relics.map(r => `<span class="chip">${r.icon} ${r.name}<span class="tip">${r.desc}</span></span>`).join('')
    : '<span style="color:var(--dim);font-size:10px;font-weight:600">まだ何もない</span>';
}
function partChipsHTML() {
  return S.parts.length
    ? S.parts.map(p => `<span class="chip">${p.icon} ${p.name}<span class="tip">${p.desc}</span></span>`).join('')
      + (freeSlots().length ? `<span class="chip" style="opacity:.5">空き ×${freeSlots().length}</span>` : '')
    : '<span style="color:var(--dim);font-size:10px;font-weight:600">空きスロット ×6 — 面クリア後のごほうびや屋台で、装置を置ける</span>';
}
function renderCollections() {
  document.getElementById('deckChips').innerHTML = deckChipsHTML();
  document.getElementById('symChips').innerHTML = reelChipsHTML();
  document.getElementById('relicChips').innerHTML = relicChipsHTML();
  const pEl = document.getElementById('partChips');
  if (pEl) pEl.innerHTML = partChipsHTML();
  // シナジー(相乗)
  const syEl = document.getElementById('synChips');
  if (syEl) {
    const act = activeSynergies();
    syEl.innerHTML = (act.length
      ? act.map(sy => `<span class="chip" style="border-color:#ff4dff66;color:#ff8aff">🔗${sy.name} ×${sy.mult}<span class="tip">${sy.desc}</span></span>`).join('')
      : '<span style="color:var(--dim);font-size:10px;font-weight:600">相性の良い組み合わせを集めると相乗倍率が乗る</span>')
      + (act.length < SYNERGIES.length ? `<span class="chip" style="opacity:.45">未発見 ×${SYNERGIES.length - act.length}</span>` : '');
  }
  // 特殊役(レシピ)
  const rcEl = document.getElementById('recipeChips');
  if (rcEl) {
    const rows = RECIPES.map(rc => {
      const ready = recipeReady(rc);
      if (!recipeAnyOwned(rc)) return null;
      const g = recipeGlyphs(rc);
      return `<span class="chip sym" style="${ready ? 'border-color:var(--accent2)' : 'opacity:.45'}">${g}<span class="cnt">${rc.name}</span><span class="tip"><b>${rc.name}</b> ${recipePatternHTML(rc)}<br>${rc.desc}${ready ? '（成立可能！）' : '（あと少し）'}</span></span>`;
    }).filter(Boolean).join('');
    rcEl.innerHTML = rows || '<span style="color:var(--dim);font-size:10px;font-weight:600">特定の絵柄の組み合わせで「特殊役」が揃うようになる</span>';
  }
}

// ---------- 演出システム ----------
const fx = {
  spark(x, y, color, n) {
    if (S.simMode) return;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, sp = 60 + rng() * 180;
      S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, t: 0, color });
    }
  },
  ring(x, y, color) {
    if (S.simMode) return;
    S.rings.push({ x, y, r: 4, t: 0, color });
  },
  floatText(x, y, txt, color) {
    if (S.simMode) return;
    S.floats.push({ x, y, txt, color: color || '#fff', t: 0 });
  },
  coinFly(x, y, n) {
    if (S.simMode) return;
    for (let i = 0; i < n; i++) {
      S.coins.push({ x: x + (rng() - 0.5) * 40, y: y + (rng() - 0.5) * 30, t: -i * 0.05, tx: 440, ty: 16 });
    }
  },
  confettiBurst(n) {
    if (S.simMode) return;
    for (let i = 0; i < n; i++) {
      S.confetti.push({
        x: rng() * CFG.W, y: -10 - rng() * 60,
        vx: (rng() - 0.5) * 60, vy: 90 + rng() * 160,
        w: 4 + rng() * 5, h: 6 + rng() * 6,
        rot: rng() * 7, vr: (rng() - 0.5) * 12,
        color: pick([S.theme.accent, '#ffffff', '#ff7eb6', '#67e8f9', '#fde68a']),
        t: 0,
      });
    }
  },
  lightning(x, y) {
    if (S.simMode) return;
    S.rings.push({ x, y, r: 4, t: 0, color: '#a5f3fc', bolt: { x, y } });
  },
  fireworks(x, y, color) {
    if (S.simMode || !S.fxMax) return;
    S.rockets.push({ x: x + (rng() - 0.5) * 40, y: CFG.H - 30, ty: y, vx: (rng() - 0.5) * 36, color: color || S.theme.accent, t: 0 });
  },
  cutin(text, hot) {
    if (S.simMode) return;
    const el = document.getElementById('cutin');
    document.getElementById('cutinText').textContent = text;
    el.style.background = hot
      ? 'linear-gradient(100deg, transparent 0%, #d1103f 12%, #d1103f 88%, transparent 100%)'
      : '';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  },
  flashDOM() {
    if (S.simMode) return;
    const f = document.getElementById('flash');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  },
};

// アンビエント粒子(面テーマごと)
function spawnAmbient(dt) {
  if (S.simMode) return;
  const kind = S.theme.ambient;
  const rate = { dust: 2.6, petal: 6.5, bubble: 6.5, lantern: 3, star: 8, rain: 30, emberUp: 9, snow: 10, glitch: 5, shine: 5 }[kind] || 3;
  if (S.ambient.length < 64 && rng() < rate * dt) {   /* 背景粒子の総数を抑え、玉と混同しにくくする */
    const a = { kind, t: 0, x: rng() * CFG.W, y: -12, vx: 0, vy: 20, size: 2 + rng() * 3, ph: rng() * 7 };
    switch (kind) {
      case 'dust': a.vy = 8 + rng() * 10; a.size = 1 + rng() * 1.6; break;
      case 'petal': a.vy = 26 + rng() * 22; a.vx = 12 + rng() * 18; a.size = 3.2 + rng() * 2.6; break;
      case 'bubble': a.y = CFG.H + 10; a.vy = -(18 + rng() * 28); a.size = 1.5 + rng() * 3.5; break;
      case 'lantern': a.vy = 6 + rng() * 8; a.size = 4 + rng() * 8; a.y = rng() * CFG.H; a.t = -9; break;
      case 'star': a.vy = 2 + rng() * 5; a.y = rng() * CFG.H; a.size = 0.8 + rng() * 1.6; a.t = -9; break;
      case 'rain': a.vy = 460 + rng() * 220; a.vx = -30; a.size = 1; break;
      case 'emberUp': a.y = CFG.H + 8; a.vy = -(34 + rng() * 46); a.vx = (rng() - 0.5) * 22; a.size = 1.4 + rng() * 2; break;
      case 'snow': a.vy = 22 + rng() * 20; a.size = 1.5 + rng() * 2.4; break;
      case 'glitch': a.y = rng() * CFG.H; a.vy = 0; a.size = 2 + rng() * 16; a.life = 0.22; break;
      case 'shine': a.y = rng() * CFG.H; a.vy = -4; a.size = 1 + rng() * 2; a.life = 2.2; break;
    }
    // 遠景レイヤー(疑似パララックス): 3割はデカくて遅い
    if (rng() < 0.3 && kind !== 'glitch' && kind !== 'rain') {
      a.far = true; a.size *= 2.2; a.vy *= 0.45; if (a.vx) a.vx *= 0.5;
    }
    S.ambient.push(a);
  }
  for (const a of S.ambient) {
    a.t += dt;
    a.x += (a.vx || 0) * dt + Math.sin((S.time + a.ph) * 1.7) * 16 * dt * (a.kind === 'petal' || a.kind === 'snow' ? 1 : 0.15);
    a.y += a.vy * dt;
    if (a.life && a.t > a.life) a.dead = true;
    if (a.y > CFG.H + 20 || a.y < -20) a.dead = true;
  }
  S.ambient = S.ambient.filter(a => !a.dead);
  // 雷雲: たまに画面が光る
  if (kind === 'rain' && rng() < dt * 0.12) { S.boardFlash = Math.max(S.boardFlash, 0.55); sfx('zap'); }
  // 電脳: 常時ノイズが走る
  if (kind === 'glitch' && S.fxMax && rng() < dt * 0.6) S.glitchT = Math.max(S.glitchT, 0.05);
}

// ---------- サウンド ----------
let AC = null, MASTER = null;
function ensureAudio() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      // マスターコンプレッサー: 派手な多重レイヤーでも音割れしない
      MASTER = AC.createDynamicsCompressor();
      MASTER.threshold.value = -16;
      MASTER.knee.value = 18;
      MASTER.ratio.value = 6;
      MASTER.attack.value = 0.003;
      MASTER.release.value = 0.22;
      MASTER.connect(AC.destination);
    } catch (e) {}
  }
  if (AC && AC.state === 'suspended') AC.resume();
}
function sndOK() { return AC && !S.simMode && S.sndOn && !(S.muteT > 0); }
function OUT() { return MASTER || AC.destination; }
let lastTick = 0;
function beep(freq, dur, type, gain, delay) {
  if (!AC || S.simMode || !S.sndOn || S.muteT > 0) return;
  const t = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(gain || 0.08, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(OUT());
  o.start(t); o.stop(t + dur + 0.02);
}
// ---------- 派手系シンセヘルパー ----------
function brass(f, dur, gain, delay = 0) { // デチューン3声+フィルタが開くブラス風
  if (!sndOK()) return;
  const t = AC.currentTime + delay;
  for (const det of [-7, 0, 8]) {
    const o = AC.createOscillator(), g = AC.createGain(), fl = AC.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = f * Math.pow(2, det / 1200);
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(500, t);
    fl.frequency.exponentialRampToValueAtTime(4200, t + 0.05);
    fl.frequency.exponentialRampToValueAtTime(900, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(OUT());
    o.start(t); o.stop(t + dur + 0.05);
  }
}
function kick(gain = 0.22, delay = 0) { // ティンパニ/キック
  if (!sndOK()) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(170, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g); g.connect(OUT());
  o.start(t); o.stop(t + 0.38);
}
function crash(gain = 0.13, dur = 1.4, delay = 0) { // クラッシュシンバル
  if (!sndOK()) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, (AC.sampleRate * 0.5) | 0, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = AC.currentTime + delay;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = AC.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 5200;
  const g = AC.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(OUT());
  src.start(t); src.stop(t + dur);
}
function bellTone(f, gain = 0.05, delay = 0) { // キラキラベル(倍音付き)
  if (!sndOK()) return;
  const t = AC.currentTime + delay;
  for (const [mul, gm] of [[1, 1], [2.76, 0.4]]) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.value = f * mul;
    g.gain.setValueAtTime(gain * gm, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(OUT());
    o.start(t); o.stop(t + 0.55);
  }
}
function coinTick(delay, gain = 0.04) { // ドル箱ジャラジャラの1粒
  if (!sndOK()) return;
  const t = AC.currentTime + delay;
  const f = 1700 + Math.random() * 2300;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.05);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g); g.connect(OUT());
  o.start(t); o.stop(t + 0.08);
}
function glide(f1, f2, dur, type = 'sine', gain = 0.06, delay = 0) { // ピッチが滑る単音
  if (!sndOK()) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
  o.connect(g); g.connect(OUT());
  o.start(t); o.stop(t + dur + 0.05);
}
function noiseSweep(f1, f2, dur, gain = 0.08, delay = 0, q = 2) { // 風切り・シュッ系のフィルタノイズ
  if (!sndOK()) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, (AC.sampleRate * 0.5) | 0, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = AC.currentTime + delay;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = AC.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(f1, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(OUT());
  src.start(t); src.stop(t + dur + 0.02);
}
// ---------- 絵柄別の当選ジングル(3揃いの瞬間、その絵柄「らしい」音が鳴る) ----------
const SYMBOL_JINGLES = {
  // ノーマル
  cherry()   { glide(620, 930, 0.07, 'square', 0.07); glide(680, 1020, 0.07, 'square', 0.07, 0.09); glide(760, 1140, 0.09, 'square', 0.06, 0.18); }, // ぷりっと3粒ポップ
  clover()   { [523, 659, 784, 880].forEach((f, i) => beep(f, 0.09, 'triangle', 0.07, i * 0.07)); bellTone(1760, 0.04, 0.3); }, // ラッキー上昇アルペジオ
  bell()     { bellTone(1047, 0.09, 0); bellTone(784, 0.08, 0.16); bellTone(1047, 0.1, 0.32); }, // 本物の鐘: キンコンカン
  house()    { beep(130, 0.07, 'square', 0.09); beep(130, 0.07, 'square', 0.09, 0.12); beep(659, 0.12, 'triangle', 0.06, 0.26); beep(523, 0.18, 'triangle', 0.06, 0.36); }, // ノック2回+ドアチャイム
  lemon()    { glide(780, 1650, 0.1, 'sawtooth', 0.05); bellTone(2093, 0.045, 0.12); }, // 酸っぱいキュッ
  grape()    { [880, 830, 780, 730, 680].forEach((f, i) => glide(f, f * 1.3, 0.05, 'sine', 0.06, i * 0.055)); }, // 粒がはじける泡ポコポコ
  suika()    { kick(0.2); noiseSweep(900, 250, 0.22, 0.09, 0.03); }, // ずっしり+果汁スプラッシュ
  coin()     { for (let i = 0; i < 8; i++) coinTick(i * 0.05, 0.05); beep(1568, 0.12, 'sine', 0.06, 0.3); }, // 小銭ジャラ
  fuusen()   { glide(320, 950, 0.32, 'sine', 0.06); noiseSweep(2600, 1500, 0.06, 0.13, 0.34); beep(420, 0.05, 'square', 0.07, 0.34); }, // ふくらんで→パン!
  sakura()   { [440, 523, 587, 784].forEach((f, i) => { beep(f, 0.22, 'triangle', 0.065, i * 0.11); beep(f * 2, 0.1, 'sine', 0.02, i * 0.11); }); }, // 和風の琴
  mitsuba()  { [523, 659, 784].forEach((f, i) => beep(f, 0.08, 'triangle', 0.07, i * 0.06)); bellTone(1568, 0.04, 0.22); }, // 三枚葉の3音
  fortune()  { glide(1300, 620, 0.3, 'sine', 0.045); glide(430, 860, 0.16, 'sine', 0.06, 0.34); }, // 神秘の下降→「なに？」の上がり
  kozutsumi(){ beep(150, 0.08, 'triangle', 0.09); noiseSweep(500, 2400, 0.18, 0.07, 0.1); }, // 段ボールどさ+テープびりっ
  mato()     { noiseSweep(2400, 700, 0.14, 0.08); kick(0.18, 0.15); bellTone(1319, 0.06, 0.2); }, // ヒュン→ドスッ→当たり鐘
  // レア
  seven()    { kick(0.2); [523, 659, 784].forEach(f => brass(f, 0.35, 0.06)); glide(620, 1240, 0.45, 'sawtooth', 0.035, 0.1); }, // ブラス直撃+サイレン上昇
  bar()      { [196, 196, 262].forEach((f, i) => { brass(f, 0.16, 0.07, i * 0.14); kick(0.15, i * 0.14); }); }, // 重低音3連スタブ
  moon()     { [523, 659].forEach(f => glide(f * 0.985, f, 0.85, 'sine', 0.05)); bellTone(1319, 0.035, 0.4); }, // 夢見る月光パッド
  diamond()  { [1568, 2093, 2637, 3136].forEach((f, i) => bellTone(f, 0.055, i * 0.09)); crash(0.04, 0.6, 0.2); }, // 結晶カスケード
  star()     { for (let i = 0; i < 5; i++) bellTone(1760 + i * 260 + Math.random() * 120, 0.05, i * 0.08); }, // キラキラ星
  kinbukuro(){ kick(0.2); for (let i = 0; i < 14; i++) coinTick(0.05 + i * 0.04, 0.05); beep(1319, 0.14, 'sine', 0.06, 0.55); }, // 金貨ぶちまけ
  suisho()   { for (const det of [-12, 12]) glide(392 * Math.pow(2, det / 1200), 587, 0.7, 'sawtooth', 0.022); bellTone(2349, 0.05, 0.55); }, // 霊気の唸り→透明音
  saikoro()  { for (let i = 0; i < 6; i++) noiseSweep(3200, 2500, 0.03, 0.06, i * 0.05); beep(310, 0.06, 'square', 0.09, 0.34); }, // カラカラ→ピタッ
  inazuma()  { glide(3200, 420, 0.13, 'sawtooth', 0.07); glide(2600, 380, 0.16, 'sawtooth', 0.06, 0.1); crash(0.05, 0.35, 0.05); }, // バリバリ放電
  nijiiro()  { [523, 587, 659, 698, 784, 880, 988].forEach((f, i) => beep(f, 0.08, 'triangle', 0.06, i * 0.055)); bellTone(2093, 0.05, 0.42); }, // 7色の駆け上がり
  present()  { noiseSweep(600, 2600, 0.16, 0.07); [523, 659].forEach(f => brass(f, 0.3, 0.05, 0.2)); bellTone(1760, 0.05, 0.24); }, // リボンしゅる→ジャーン
  kagi()     { for (let i = 0; i < 4; i++) coinTick(i * 0.045, 0.045); beep(2100, 0.03, 'square', 0.07, 0.2); glide(180, 330, 0.25, 'sawtooth', 0.03, 0.26); }, // 鍵束+カチャ+扉ギィ
  buta()     { glide(310, 175, 0.11, 'sawtooth', 0.075); glide(340, 185, 0.13, 'sawtooth', 0.075, 0.16); coinTick(0.34, 0.05); }, // ブヒブヒ+チャリン
  hanabi()   { glide(420, 1250, 0.45, 'sine', 0.045); boomNoise(0.22, 0.4, 0.45); for (let i = 0; i < 6; i++) bellTone(1568 + Math.random() * 1200, 0.04, 0.55 + i * 0.07); }, // ヒュ〜…ドーン!パラパラ
  unicorn()  { [784, 988, 1175, 1397, 1568, 1760].forEach((f, i) => bellTone(f, 0.045, i * 0.06)); glide(880, 1760, 0.25, 'sine', 0.04, 0.42); }, // ハープグリス+いななき
  // レジェンド
  crown()    { brass(392, 0.18, 0.06); brass(523, 0.18, 0.06, 0.16); [659, 784].forEach(f => brass(f, 0.5, 0.055, 0.32)); kick(0.2, 0.32); bellTone(2093, 0.05, 0.6); }, // 戴冠ファンファーレ
  ryu()      { glide(160, 75, 0.55, 'sawtooth', 0.11); boomNoise(0.18, 0.5, 0.05); bellTone(220, 0.09, 0.5); bellTone(110, 0.07, 0.5); }, // 咆哮+銅鑼
  taiyo()    { [523, 659, 784].forEach(f => brass(f, 0.7, 0.05)); for (let i = 0; i < 5; i++) bellTone(1568 + i * 330, 0.04, 0.25 + i * 0.09); }, // 陽光の長和音+燦々
  ryusei()   { for (let i = 0; i < 3; i++) noiseSweep(2800, 500, 0.3, 0.07, i * 0.18); for (let i = 0; i < 5; i++) bellTone(1760 + Math.random() * 1400, 0.045, 0.6 + i * 0.08); }, // 流星3連+着弾キラ
  joker()    { [466, 494, 523, 554].forEach((f, i) => beep(f, 0.07, 'square', 0.06, i * 0.08)); glide(660, 520, 0.1, 'sawtooth', 0.05, 0.36); glide(640, 500, 0.1, 'sawtooth', 0.05, 0.5); }, // 忍び足+ケケケ
};
function symbolWinSound(id) {
  if (!sndOK()) return;
  const j = SYMBOL_JINGLES[id];
  if (j) j();
}
// FEVER突入: キックロール→サイレン2連→ブラス駆け上がり→ベルの雨+群衆スウェル
function feverStartSound() {
  if (!sndOK()) return;
  for (let i = 0; i < 4; i++) kick(0.22, i * 0.11);
  glide(500, 1050, 0.5, 'sawtooth', 0.05);
  glide(500, 1050, 0.5, 'sawtooth', 0.05, 0.25);
  noiseSweep(300, 1400, 0.9, 0.05, 0, 1);
  [523, 659, 784, 1047].forEach((f, i) => brass(f, i === 3 ? 0.85 : 0.22, 0.06, 0.45 + i * 0.13));
  crash(0.13, 1.6, 0.45);
  for (let i = 0; i < 8; i++) bellTone(1568 + Math.random() * 1500, 0.045, 0.8 + i * 0.09);
}
function feverEndSound() {
  if (!sndOK()) return;
  [784, 659, 523].forEach((f, i) => brass(f, 0.28, 0.05, i * 0.16));
  bellTone(1047, 0.06, 0.5);
  crash(0.05, 0.8, 0.45);
}
// 金額ティア別の大当たりファンファーレ(パチンコ級)
function megawinSound(tierMin) {
  if (!sndOK()) return;
  // 駆け上がりグリス
  for (let i = 0; i < 10; i++) beep(400 * Math.pow(2, i / 6), 0.05, 'square', 0.05, i * 0.04);
  kick(0.26, 0.42);
  crash(0.15, 1.6, 0.42);
  boomNoise(0.2, 0.5);
  // ブラスファンファーレ C→F→G→C
  const prog = [[262, 330, 392], [349, 440, 523], [392, 494, 587], [523, 659, 784]];
  prog.forEach((ch, i) => {
    ch.forEach(fq => brass(fq, i === 3 ? 0.9 : 0.32, 0.05, 0.42 + i * 0.3));
    kick(0.16, 0.42 + i * 0.3);
  });
  crash(0.11, 1.8, 1.32);
  if (tierMin >= 1500) { // SUPER以上: キラキラベルの雨
    for (let i = 0; i < 9; i++) bellTone(1568 + Math.random() * 1400, 0.045, 1.25 + i * 0.15);
  }
  if (tierMin >= 4000) { // FEVER: 1オクターブ上で二周目+追いクラッシュ
    prog.forEach((ch, i) => ch.forEach(fq => brass(fq * 2, i === 3 ? 1.1 : 0.28, 0.04, 1.85 + i * 0.28)));
    kick(0.24, 1.85); kick(0.24, 2.4);
    crash(0.12, 2.2, 1.85);
    for (let i = 0; i < 10; i++) bellTone(2093 + Math.random() * 1600, 0.04, 2.4 + i * 0.14);
  }
}
function sfx(kind) {
  if (!AC || S.simMode || !S.sndOn) return;
  switch (kind) {
    case 'fire': beep(180, 0.05, 'square', 0.025); break;
    case 'tick': {
      const now = performance.now();
      if (now - lastTick < 50) return;
      lastTick = now;
      beep(2200 + Math.random() * 800, 0.02, 'sine', 0.02); break;
    }
    case 'heso': beep(880, 0.09, 'sine', 0.08); beep(1320, 0.12, 'sine', 0.06, 0.06); break;
    case 'tulip': beep(660, 0.08, 'sine', 0.06); break;
    case 'stop': beep(300, 0.05, 'square', 0.05); break;
    case 'reelstop': beep(200, 0.06, 'square', 0.07); beep(120, 0.09, 'triangle', 0.06, 0.01); break;
    case 'atsu': for (let i = 0; i < 5; i++) beep(600 + i * 220, 0.09, 'sawtooth', 0.06, i * 0.06); break;
    case 'push': beep(90, 0.16, 'square', 0.14); beep(1800, 0.05, 'sine', 0.07); boomNoise && boomNoise(0.1, 0.06); break;
    case 'ren': boomNoise && boomNoise(0.16, 0.1); beep(220, 0.14, 'square', 0.1); beep(110, 0.22, 'square', 0.09, 0.05); break;
    case 'revive': boomNoise && boomNoise(0.5, 0.16); for (let i = 0; i < 4; i++) beep(523 * Math.pow(1.334, i), 0.16, 'sawtooth', 0.08, 0.05 + i * 0.07); break;
    case 'two': beep(700, 0.08, 'square', 0.06); beep(1050, 0.1, 'square', 0.05, 0.06); break;
    case 'reach': for (let i = 0; i < 8; i++) beep(400 + i * 90, 0.07, 'sawtooth', 0.04, i * 0.08); break;
    case 'jackpot': {
      // 駆け上がり→ブラス2連+ティンパニ+クラッシュ
      for (let i = 0; i < 7; i++) beep(500 * Math.pow(2, i / 7), 0.06, 'square', 0.05, i * 0.045);
      kick(0.24, 0.32);
      crash(0.12, 1.2, 0.32);
      [523, 659, 784].forEach(f => brass(f, 0.45, 0.055, 0.32));
      [659, 830, 988].forEach(f => brass(f, 0.55, 0.05, 0.64));
      break;
    }
    case 'bigwin':
      [659, 880, 1174, 1568].forEach((f, i) => beep(f, 0.14, 'square', 0.07, i * 0.09));
      kick(0.16, 0.05);
      crash(0.07, 0.7, 0.05);
      break;
    case 'shower': for (let i = 0; i < 10; i++) beep(900 + rng() * 900, 0.06, 'sine', 0.05, i * 0.09); break;
    case 'catch': beep(440, 0.05, 'square', 0.05); beep(880, 0.07, 'square', 0.045, 0.03); break;
    case 'round': beep(523, 0.1, 'square', 0.06); beep(784, 0.12, 'square', 0.055, 0.09); break;
    case 'pay': beep(1200, 0.08, 'sine', 0.08); beep(1600, 0.14, 'sine', 0.07, 0.07); break;
    case 'stage': beep(392, 0.2, 'triangle', 0.07); beep(523, 0.2, 'triangle', 0.07, 0.16); beep(659, 0.34, 'triangle', 0.07, 0.32); break;
    case 'boom': beep(90, 0.3, 'sawtooth', 0.1); boomNoise(0.14, 0.35); break;
    case 'zap': beep(2400, 0.05, 'sawtooth', 0.06); beep(1200, 0.09, 'sawtooth', 0.05, 0.03); break;
    case 'death': beep(110, 0.9, 'sawtooth', 0.1); beep(82, 1.2, 'sawtooth', 0.08, 0.15); break;
    case 'megawin': megawinSound(500); break;
  }
}
// ノイズ爆発音(WebAudioバッファ合成)
let noiseBuf = null;
function boomNoise(gain = 0.15, dur = 0.35, delay = 0) {
  if (!AC || S.simMode || !S.sndOn) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, (AC.sampleRate * 0.5) | 0, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = AC.currentTime + delay;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 850;
  const g = AC.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(OUT());
  src.start(t); src.stop(t + dur);
}
// RUSH中のBGMシーケンサー + 激アツ心音(フレーム駆動の先行スケジューリング)
function audioTick() {
  if (!AC || !S.sndOn || S.simMode) return;
  const now = AC.currentTime;
  if (S.fever && S.phase === 'play') {
    // FEVER専用BGM: メジャーキーの16分アップテンポ+4つ打ちキック+裏拍チャリン
    if (!S.bgmNext || S.bgmNext < now) { S.bgmNext = now + 0.05; S.bgmStep = 0; }
    const patF = [0, 4, 7, 12, 4, 7, 12, 16, 5, 9, 14, 17, 7, 12, 16, 19];
    while (S.bgmNext < now + 0.25) {
      const st = S.bgmStep % 16;
      const f = 262 * Math.pow(2, patF[st] / 12);
      beep(f, 0.09, 'square', 0.034, S.bgmNext - now);
      beep(f / 2, 0.11, 'triangle', 0.03, S.bgmNext - now);
      if (st % 4 === 0) { kick(0.12, S.bgmNext - now); S.beatT = 1; }
      if (st % 2 === 1) coinTick(S.bgmNext - now, 0.013);
      S.bgmStep++;
      S.bgmNext += 0.095;
    }
  } else if (S.rush && S.phase === 'play') {
    if (!S.bgmNext || S.bgmNext < now) { S.bgmNext = now + 0.05; S.bgmStep = 0; }
    const pat = [0, 7, 12, 7, 3, 10, 15, 12];
    while (S.bgmNext < now + 0.25) {
      const f = 220 * Math.pow(2, pat[S.bgmStep % 8] / 12);
      beep(f, 0.1, 'square', 0.03, S.bgmNext - now);
      beep(f / 2, 0.1, 'triangle', 0.028, S.bgmNext - now);
      if (S.bgmStep % 4 === 0) { boomNoise(0.02, 0.08); S.beatT = 1; }
      S.bgmStep++;
      S.bgmNext += 0.115;
    }
  } else S.bgmNext = 0;
  if (S.spin && S.spin.reachPlayed && S.spin.hot && S.phase === 'play') {
    if (!S.hbNext || S.hbNext < now) S.hbNext = now + 0.05;
    while (S.hbNext < now + 0.3) {
      beep(60, 0.13, 'sine', 0.15, S.hbNext - now);
      beep(54, 0.15, 'sine', 0.13, S.hbNext - now + 0.17);
      S.hbNext += 0.85;
    }
  } else S.hbNext = 0;
  // 祝祭カウントアップ中はドル箱ジャラジャラ(進むほど密度と音量が上がる)
  if (S.celebrate && S.celebrate.prog < 1) {
    if (!S.payNext || S.payNext < now) S.payNext = now + 0.02;
    while (S.payNext < now + 0.2) {
      coinTick(S.payNext - now, 0.032 + S.celebrate.prog * 0.022);
      if (Math.random() < 0.45) coinTick(S.payNext - now + 0.013, 0.028);
      if (Math.random() < 0.08) bellTone(1800 + Math.random() * 1200, 0.03, S.payNext - now);
      S.payNext += 0.036;
    }
  } else S.payNext = 0;
}

// ---------- シンボル描画(ベクター) ----------
// 生成した和風メダル絵柄(あれば画像、無ければ手続き描画)
const SYM_IMG = {};
for (const id of Object.keys(SYMBOLS)) {
  const im = new Image();
  im.onload = () => { SYM_IMG[id] = im; };
  im.src = `assets/sym_${id}_art.webp`;
}
function drawSymbol(c, id, x, y, s) {
  const im = SYM_IMG[id];
  if (im) { // 和風メダル画像(枠込み)。窓いっぱいに映えるようやや大きめ
    const d = s * 1.5;
    c.drawImage(im, x - d / 2, y - d / 2, d, d);
    return;
  }
  c.save();
  c.translate(x, y);
  switch (id) {
    case 'seven': {
      const g = c.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
      g.addColorStop(0, '#ff8a8a'); g.addColorStop(1, '#e03131');
      c.fillStyle = g;
      c.font = `900 ${s * 1.15}px "Arial Black", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#ff5d5d'; c.shadowBlur = 12;
      c.fillText('7', 0, s * 0.04);
      c.shadowBlur = 0;
      c.strokeStyle = '#fff'; c.lineWidth = 1.4;
      c.strokeText('7', 0, s * 0.04);
      break;
    }
    case 'bar': {
      c.fillStyle = '#191a1e';
      c.strokeStyle = '#e8e8e8'; c.lineWidth = 2;
      const w = s * 1.05, h = s * 0.5;
      c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, 4); c.fill(); c.stroke();
      c.fillStyle = '#fff';
      c.font = `900 ${s * 0.36}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('BAR', 0, 1);
      break;
    }
    case 'cherry': {
      c.strokeStyle = '#6dbb63'; c.lineWidth = 2.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-s * 0.16, s * 0.16); c.quadraticCurveTo(-s * 0.06, -s * 0.4, s * 0.14, -s * 0.42); c.stroke();
      c.beginPath(); c.moveTo(s * 0.2, s * 0.2); c.quadraticCurveTo(s * 0.18, -s * 0.2, s * 0.14, -s * 0.42); c.stroke();
      for (const [px, py] of [[-s * 0.16, s * 0.2], [s * 0.2, s * 0.26]]) {
        const g = c.createRadialGradient(px - 2, py - 2, 1, px, py, s * 0.22);
        g.addColorStop(0, '#ff9c9c'); g.addColorStop(1, '#d92121');
        c.fillStyle = g;
        c.beginPath(); c.arc(px, py, s * 0.21, 0, 7); c.fill();
      }
      break;
    }
    case 'clover': {
      c.fillStyle = '#31c463';
      for (let i = 0; i < 4; i++) {
        c.save(); c.rotate(i * Math.PI / 2);
        c.beginPath();
        c.arc(-s * 0.11, -s * 0.24, s * 0.13, 0, 7);
        c.arc(s * 0.11, -s * 0.24, s * 0.13, 0, 7);
        c.arc(0, -s * 0.13, s * 0.13, 0, 7);
        c.fill();
        c.restore();
      }
      c.strokeStyle = '#1f8443'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, s * 0.1); c.quadraticCurveTo(s * 0.1, s * 0.3, s * 0.06, s * 0.46); c.stroke();
      break;
    }
    case 'bell': {
      const g = c.createLinearGradient(0, -s * 0.4, 0, s * 0.3);
      g.addColorStop(0, '#ffe08a'); g.addColorStop(1, '#e09c1a');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, -s * 0.05, s * 0.32, Math.PI, 0);
      c.quadraticCurveTo(s * 0.36, s * 0.22, s * 0.42, s * 0.28);
      c.lineTo(-s * 0.42, s * 0.28);
      c.quadraticCurveTo(-s * 0.36, s * 0.22, -s * 0.32, -s * 0.05);
      c.fill();
      c.fillStyle = '#b57614';
      c.beginPath(); c.arc(0, s * 0.36, s * 0.09, 0, 7); c.fill();
      c.fillStyle = '#fff5d6';
      c.beginPath(); c.arc(-s * 0.12, -s * 0.16, s * 0.06, 0, 7); c.fill();
      break;
    }
    case 'moon': {
      c.fillStyle = '#d8ccff';
      c.shadowColor = '#c4b5fd'; c.shadowBlur = 10;
      c.beginPath(); c.arc(0, 0, s * 0.34, 0, 7); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = S.theme.bg2;
      c.beginPath(); c.arc(s * 0.16, -s * 0.1, s * 0.28, 0, 7); c.fill();
      break;
    }
    case 'diamond': {
      const g = c.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
      g.addColorStop(0, '#c8f4ff'); g.addColorStop(0.5, '#4cc9f0'); g.addColorStop(1, '#2196c4');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, -s * 0.4); c.lineTo(s * 0.34, -s * 0.08); c.lineTo(0, s * 0.42); c.lineTo(-s * 0.34, -s * 0.08);
      c.closePath(); c.fill();
      c.strokeStyle = '#ffffffaa'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-s * 0.34, -s * 0.08); c.lineTo(s * 0.34, -s * 0.08); c.stroke();
      c.beginPath(); c.moveTo(0, -s * 0.4); c.lineTo(-s * 0.12, -s * 0.08); c.lineTo(0, s * 0.42); c.moveTo(0, -s * 0.4); c.lineTo(s * 0.12, -s * 0.08); c.lineTo(0, s * 0.42); c.stroke();
      break;
    }
    case 'star': {
      c.fillStyle = '#ffe793';
      c.shadowColor = '#fde68a'; c.shadowBlur = 12;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s * 0.42 : s * 0.18;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        c[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill();
      c.shadowBlur = 0;
      break;
    }
    case 'house': {
      c.fillStyle = '#7dd3a0';
      c.beginPath(); c.moveTo(0, -s * 0.4); c.lineTo(s * 0.4, -s * 0.02); c.lineTo(-s * 0.4, -s * 0.02); c.closePath(); c.fill();
      c.fillStyle = '#dcefe4';
      c.fillRect(-s * 0.27, -s * 0.02, s * 0.54, s * 0.4);
      c.fillStyle = '#3f6e53';
      c.fillRect(-s * 0.08, s * 0.12, s * 0.16, s * 0.26);
      break;
    }
    default: {
      // 新シンボルは発光グリフ描画
      const sym = SYMBOLS[id];
      c.font = `900 ${s * 0.92}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = sym ? sym.color : '#fff'; c.shadowBlur = 12;
      c.fillStyle = '#fff';
      c.fillText(sym ? sym.glyph : '?', 0, s * 0.06);
      c.shadowBlur = 0;
    }
  }
  c.restore();
}

// ---------- ポストプロセス(無駄な技術ゾーン) ----------
const cv = document.getElementById('board');
// ---------- WebGL最終合成 ----------
// 対応環境: 2Dはオフスクリーンに描き、可視canvasへGPUシェーダ(本物のブルーム/ガラス映り込み/ビネット)で提示。
// 非対応環境: 従来どおり可視canvasに2D直描画。
function createGLPresenter(canvas, srcCanvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) return null;
  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = (fs, vs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs || VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  // 明部抽出(1/4解像度)
  const P_BRIGHT = prog(`precision mediump float;varying vec2 v;uniform sampler2D t;
    void main(){vec3 c=texture2D(t,v).rgb;float l=dot(c,vec3(.299,.587,.114));
    gl_FragColor=vec4(c*smoothstep(.6,.9,l),1.);}`);
  // 9タップガウス(方向可変・2パス)
  const P_BLUR = prog(`precision mediump float;varying vec2 v;uniform sampler2D t;uniform vec2 d;
    void main(){vec3 s=texture2D(t,v).rgb*.227;
    s+=(texture2D(t,v+d*1.384).rgb+texture2D(t,v-d*1.384).rgb)*.316;
    s+=(texture2D(t,v+d*3.230).rgb+texture2D(t,v-d*3.230).rgb)*.0702;
    gl_FragColor=vec4(s,1.);}`);
  // 合成: ベース+ブルーム+ストリーク+ガラス反射+彩度+ビネット+衝撃波歪み+ラジアルブラー
  const P_COMP = prog(`precision mediump float;varying vec2 v;
    uniform sampler2D t,b,s;uniform float time,bloom,fxon,streak,radial;uniform vec3 shock;
    void main(){
      vec2 vv=v;
      if(shock.z>0.){
        vec2 dv=v-shock.xy; float dist=length(dv);
        float r=shock.z*.55;
        float w=exp(-pow((dist-r)*16.,2.))*(1.-shock.z)*.05;
        vv+=normalize(dv+vec2(1e-4))*w;
      }
      vec3 base=texture2D(t,vv).rgb;
      if(radial>0.){
        vec2 dir=(vec2(.5,.5)-vv)*.016*radial;
        base+=texture2D(t,vv+dir).rgb+texture2D(t,vv+dir*2.).rgb+texture2D(t,vv+dir*3.).rgb+texture2D(t,vv+dir*4.).rgb;
        base/=5.0;
      }
      vec3 c=base+texture2D(b,vv).rgb*bloom;
      c+=texture2D(s,vv).rgb*vec3(.5,.72,1.)*streak;
      float sweep=sin(time*.13)*1.6;
      float g=v.x*.8-v.y*.55+sweep;
      float band=smoothstep(.0,.25,g)*smoothstep(.5,.25,g);
      float band2=smoothstep(.55,.72,g)*smoothstep(.9,.72,g);
      c+=vec3(1.,1.,1.06)*(band*.05+band2*.022)*fxon;
      c+=vec3(.9,1.,.95)*smoothstep(.62,1.,v.y)*.03*fxon;
      float lum=dot(c,vec3(.299,.587,.114));
      c=mix(vec3(lum),c,1.09);
      vec2 q=v-.5;
      c*=1.-dot(q,q)*.34;
      gl_FragColor=vec4(c,1.);
    }`);
  // GPUパーティクル(ポイントスプライト・加算合成)
  const VSP = `attribute vec2 ap;attribute float asz;attribute vec4 ac;uniform vec2 res;varying vec4 vc;
    void main(){vc=ac;gl_PointSize=asz;
    gl_Position=vec4(ap.x/res.x*2.-1.,1.-ap.y/res.y*2.,0.,1.);}`;
  const P_PART = prog(`precision mediump float;varying vec4 vc;
    void main(){float d=length(gl_PointCoord-.5);
    float a=smoothstep(.5,.05,d);float core=smoothstep(.22,.0,d)*.7;
    gl_FragColor=vec4((vc.rgb+core)*a*vc.a,a*vc.a);}`, VSP);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const bindQuad = p => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  };
  const mkTex = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const srcTex = mkTex();
  const BW = (CFG.CW / 4) | 0, BH = (CFG.CH / 4) | 0;
  const fbo = [0, 1].map(() => {
    const t = mkTex(BW, BH);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f, t };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  let texInit = false;
  // ---- パーティクルプール(最大4096・CPU更新1バッファ・GPU1ドローコール) ----
  const PMAX = 4096, STRIDE = 7;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX);
  const pvx = new Float32Array(PMAX), pvy = new Float32Array(PMAX);
  const pl = new Float32Array(PMAX), pml = new Float32Array(PMAX);
  const ps = new Float32Array(PMAX), pg = new Float32Array(PMAX), pdr = new Float32Array(PMAX);
  const pr = new Float32Array(PMAX), pgn = new Float32Array(PMAX), pb = new Float32Array(PMAX);
  const ptw = new Float32Array(PMAX);
  const buf = new Float32Array(PMAX * STRIDE);
  const pbuf = gl.createBuffer();
  let cursor = 0, alive = 0;
  const PRESETS = {
    gold:   { cols: [[1, .84, .3], [1, .95, .6], [1, .7, .18]], speed: 330, grav: 620, drag: .988, life: [0.6, 1.4], size: [4, 11], tw: .8, up: -.55 },
    ember:  { cols: [[1, .55, .15], [1, .8, .3], [.9, .3, .1]], speed: 120, grav: -70, drag: .97, life: [1.0, 2.2], size: [3, 8], tw: .9, up: -.3 },
    rainbow:{ cols: [[1, .3, .4], [1, .9, .3], [.35, 1, .5], [.4, .7, 1], [.85, .5, 1]], speed: 380, grav: 480, drag: .985, life: [0.8, 1.8], size: [5, 12], tw: .6, up: -.7 },
    white:  { cols: [[1, 1, 1], [.9, .97, 1]], speed: 460, grav: 220, drag: .975, life: [0.35, 0.9], size: [3, 9], tw: .3, up: 0 },
  };
  function burst(x, y, n, preset, spreadUp) {
    const P = PRESETS[preset] || PRESETS.gold;
    for (let i = 0; i < n; i++) {
      const k = cursor; cursor = (cursor + 1) % PMAX;
      const a = Math.random() * Math.PI * 2;
      const sp = P.speed * (0.25 + Math.random() * 0.95);
      px[k] = x + (Math.random() - 0.5) * 14; py[k] = y + (Math.random() - 0.5) * 14;
      pvx[k] = Math.cos(a) * sp;
      pvy[k] = Math.sin(a) * sp + P.speed * (spreadUp != null ? spreadUp : P.up);
      pml[k] = pl[k] = P.life[0] + Math.random() * (P.life[1] - P.life[0]);
      ps[k] = P.size[0] + Math.random() * (P.size[1] - P.size[0]);
      pg[k] = P.grav; pdr[k] = P.drag; ptw[k] = P.tw;
      const c = P.cols[(Math.random() * P.cols.length) | 0];
      pr[k] = c[0]; pgn[k] = c[1]; pb[k] = c[2];
    }
    alive = Math.min(PMAX, alive + n);
  }
  let shockS = { x: 0.5, y: 0.5, t: 0 }, radialT = 0, lastT = 0;
  return {
    burst(x, y, n, preset, up) { burst(x, y, n, preset, up); },
    shock(x, y) { shockS = { x: x / CFG.CW, y: 1 - y / CFG.CH, t: 0.0001 }; },
    radialBurst(v) { radialT = Math.max(radialT, v || 1); },
    present(time, fxMax, boost = 0) {
      const dt = Math.min(0.05, Math.max(0, time - lastT)); lastT = time;
      if (shockS.t > 0) { shockS.t += dt * 1.9; if (shockS.t >= 1) shockS.t = 0; }
      if (radialT > 0) radialT = Math.max(0, radialT - dt * 2.4);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      if (!texInit) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas); texInit = true; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
      gl.useProgram(P_BRIGHT); bindQuad(P_BRIGHT);
      gl.uniform1i(gl.getUniformLocation(P_BRIGHT, 't'), 0);
      gl.viewport(0, 0, BW, BH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[0].f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(P_BLUR); bindQuad(P_BLUR);
      gl.uniform1i(gl.getUniformLocation(P_BLUR, 't'), 0);
      gl.bindTexture(gl.TEXTURE_2D, fbo[0].t);
      gl.uniform2f(gl.getUniformLocation(P_BLUR, 'd'), 1 / BW, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1].f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, fbo[1].t);
      gl.uniform2f(gl.getUniformLocation(P_BLUR, 'd'), 0, 1 / BH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[0].f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, fbo[0].t);
      gl.uniform2f(gl.getUniformLocation(P_BLUR, 'd'), 5.5 / BW, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1].f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(P_COMP); bindQuad(P_COMP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fbo[0].t);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fbo[1].t);
      gl.uniform1i(gl.getUniformLocation(P_COMP, 't'), 0);
      gl.uniform1i(gl.getUniformLocation(P_COMP, 'b'), 1);
      gl.uniform1i(gl.getUniformLocation(P_COMP, 's'), 2);
      gl.uniform1f(gl.getUniformLocation(P_COMP, 'time'), time);
      // 大当り/FEVER中(boost)はブルームを強めず、むしろ下げて白飛びを防ぐ(キャラ顔・髪が飛ぶ対策)
      gl.uniform1f(gl.getUniformLocation(P_COMP, 'bloom'), fxMax ? (0.5 - boost * 0.26) : 0.22);
      gl.uniform1f(gl.getUniformLocation(P_COMP, 'fxon'), fxMax ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(P_COMP, 'streak'), (fxMax ? 0.16 : 0.06) + boost * 0.14);
      gl.uniform3f(gl.getUniformLocation(P_COMP, 'shock'), shockS.x, shockS.y, shockS.t);
      gl.uniform1f(gl.getUniformLocation(P_COMP, 'radial'), radialT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // ---- パーティクル更新+1ドローコール ----
      if (alive > 0) {
        let n = 0;
        for (let k = 0; k < PMAX; k++) {
          if (pl[k] <= 0) continue;
          pl[k] -= dt;
          if (pl[k] <= 0) continue;
          pvy[k] += pg[k] * dt;
          pvx[k] *= pdr[k]; pvy[k] *= pdr[k];
          px[k] += pvx[k] * dt; py[k] += pvy[k] * dt;
          const lf = pl[k] / pml[k];
          const twk = ptw[k] > 0 ? (1 - ptw[k] * 0.5) + Math.sin((pl[k] * 31 + k) * 1.7) * ptw[k] * 0.5 : 1;
          const o = n * STRIDE;
          buf[o] = px[k]; buf[o + 1] = py[k];
          buf[o + 2] = ps[k] * (0.5 + lf * 0.8);
          buf[o + 3] = pr[k]; buf[o + 4] = pgn[k]; buf[o + 5] = pb[k];
          buf[o + 6] = Math.min(1, lf * 2.2) * twk;
          n++;
        }
        alive = n;
        if (n > 0) {
          gl.useProgram(P_PART);
          gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
          gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
          const lp = gl.getAttribLocation(P_PART, 'ap');
          const ls = gl.getAttribLocation(P_PART, 'asz');
          const lc = gl.getAttribLocation(P_PART, 'ac');
          gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, STRIDE * 4, 0);
          gl.enableVertexAttribArray(ls); gl.vertexAttribPointer(ls, 1, gl.FLOAT, false, STRIDE * 4, 8);
          gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 4, gl.FLOAT, false, STRIDE * 4, 12);
          gl.uniform2f(gl.getUniformLocation(P_PART, 'res'), CFG.CW, CFG.CH);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.drawArrays(gl.POINTS, 0, n);
          gl.disable(gl.BLEND);
          gl.disableVertexAttribArray(ls); gl.disableVertexAttribArray(lc);
        }
      }
    },
  };
}
const srcCv = document.createElement('canvas');
srcCv.width = CFG.CW; srcCv.height = CFG.CH;
let GLP = null;
try { GLP = createGLPresenter(cv, srcCv); } catch (e) { GLP = null; }
const c2 = GLP ? srcCv.getContext('2d') : cv.getContext('2d');
const bloomCv = document.createElement('canvas');
bloomCv.width = CFG.CW / 4; bloomCv.height = CFG.CH / 4;
const bloomCx = bloomCv.getContext('2d');
const copyCv = document.createElement('canvas');
copyCv.width = CFG.CW; copyCv.height = CFG.CH;
const copyCx = copyCv.getContext('2d');
const scanCv = document.createElement('canvas');
scanCv.width = CFG.CW; scanCv.height = CFG.CH;
{
  const sc = scanCv.getContext('2d');
  sc.fillStyle = '#000';
  for (let y = 0; y < CFG.CH; y += 3) sc.fillRect(0, y, CFG.CW, 1);
}
const grainTiles = [];
for (let i = 0; i < 3; i++) {
  const g = document.createElement('canvas');
  g.width = 160; g.height = 272;
  const gc = g.getContext('2d');
  const im = gc.createImageData(160, 272);
  for (let p = 0; p < im.data.length; p += 4) {
    const v = 118 + Math.random() * 22;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = Math.random() < 0.5 ? 26 : 0;
  }
  gc.putImageData(im, 0, 0);
  grainTiles.push(g);
}
let grainFrame = 0;
let grainTick = 0;

function hitStop(scale, dur) { S.timeScale = scale; S.tsTimer = dur; } // 時間停止/スロー

// ---------- スプライト事前描画(金属質感の釘・玉・コイン) ----------
const SPRITES = { pin: null, pinKey: null, guide: null, balls: {}, coin: null };
function buildSprites() {
  const mk = (size, fn) => {
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = size;
    fn(cnv.getContext('2d'), size);
    return cnv;
  };
  const pinSprite = tint => mk(26, g => {
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(13, 16.5, 7, 4, 0, 0, 7); g.fill();
    const gr = g.createRadialGradient(10.5, 10, 1, 13, 13, 8.5);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, tint);
    gr.addColorStop(0.8, '#4a5157');
    gr.addColorStop(1, '#1b1f22');
    g.fillStyle = gr;
    g.beginPath(); g.arc(13, 13, 7.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.beginPath(); g.arc(10.5, 10, 1.8, 0, 7); g.fill();
  });
  SPRITES.pin = pinSprite('#cfd8de');
  SPRITES.pinKey = pinSprite('#7dffc0');
  SPRITES.guide = pinSprite('#aeb9c2');
  for (const [id, b] of Object.entries(BALLS)) {
    SPRITES.balls[id] = mk(36, g => {
      const gr = g.createRadialGradient(13, 11.5, 2, 18, 18, 15.5);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.3, b.color);
      gr.addColorStop(0.75, b.color);
      gr.addColorStop(1, 'rgba(0,0,0,.92)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(18, 18, 15.2, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.28)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(18, 18, 13.2, Math.PI * 0.22, Math.PI * 0.78); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.ellipse(12.6, 11, 3.4, 2.3, -0.6, 0, 7); g.fill();
    });
  }
  SPRITES.coin = mk(26, g => {
    const gr = g.createRadialGradient(10, 9, 1, 13, 13, 12);
    gr.addColorStop(0, '#fff6cf');
    gr.addColorStop(0.4, '#ffd76a');
    gr.addColorStop(0.85, '#b8860b');
    gr.addColorStop(1, '#6e4e05');
    g.fillStyle = gr;
    g.beginPath(); g.arc(13, 13, 11.5, 0, 7); g.fill();
    g.strokeStyle = '#8a6508'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(13, 13, 8.4, 0, 7); g.stroke();
    g.fillStyle = '#8a6508';
    g.font = '900 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('玉', 13, 13.5);
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.beginPath(); g.ellipse(9.5, 8.5, 2.6, 1.6, -0.6, 0, 7); g.fill();
  });
}

// ---------- 面テーマの描き込み背景(プリレンダ) ----------
const bgCv = document.createElement('canvas');
bgCv.width = CFG.W; bgCv.height = CFG.H;
function buildBackdrop() {
  const g = bgCv.getContext('2d');
  const T = S.theme, W = CFG.W, H = CFG.H;
  if (ART.backdrop) {
    // AIアートを基層に(cover-fit)。釘と玉の視認性のため暗めに整え、テーマ色へ寄せる
    const img = ART.backdrop;
    const sc = Math.max(W / img.width, H / img.height);
    const dw = img.width * sc, dh = img.height * sc;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    g.fillStyle = 'rgba(4,9,7,0.52)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'color';
    g.globalAlpha = 0.15;
    g.fillStyle = T.accent;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  } else {
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, T.bg1); base.addColorStop(1, T.bg2);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
  }
  const glowAt = (x, y, r, col, a) => {
    const gr = g.createRadialGradient(x, y, 1, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = a; g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.globalAlpha = 1;
  };
  switch (T.ambient) {
    case 'dust': // 場末: 天井灯の光条
      for (const lx of [90, 230, 370]) {
        g.globalAlpha = 0.05; g.fillStyle = '#b8ffd9';
        g.beginPath(); g.moveTo(lx - 12, 0); g.lineTo(lx + 12, 0); g.lineTo(lx + 78, H); g.lineTo(lx - 78, H); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      glowAt(230, H - 60, 240, T.accent, 0.06);
      break;
    case 'petal': { // 桜: 巨木のシルエット+花霞
      glowAt(90, 120, 220, '#ff7eb6', 0.1);
      glowAt(390, 620, 260, '#ff7eb6', 0.07);
      g.fillStyle = 'rgba(255,160,200,.10)';
      for (let i = 0; i < 26; i++) {
        const x = rngStatic(i * 7.3) * W, y = rngStatic(i * 3.1) * H;
        g.beginPath(); g.ellipse(x, y, 5 + i % 4, 3, i, 0, 7); g.fill();
      }
      break;
    }
    case 'bubble': // 深海: 光の柱と暗い海底
      for (const lx of [140, 250, 330]) {
        g.globalAlpha = 0.06; g.fillStyle = '#9adcff';
        g.beginPath(); g.moveTo(lx - 8, 0); g.lineTo(lx + 26, 0); g.lineTo(lx + 90, H); g.lineTo(lx - 60, H); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      glowAt(230, H + 40, 300, '#062a44', 0.5);
      break;
    case 'lantern': // 夏祭: 山影と提灯の灯り
      g.fillStyle = 'rgba(0,0,0,.4)';
      g.beginPath(); g.moveTo(0, 190); g.quadraticCurveTo(120, 90, 240, 180); g.quadraticCurveTo(350, 250, 460, 150); g.lineTo(460, 0); g.lineTo(0, 0); g.closePath(); g.fill();
      for (let i = 0; i < 6; i++) glowAt(40 + i * 76, 60 + (i % 2) * 26, 42, '#ffb057', 0.16);
      break;
    case 'star': { // 銀河: 星雲と星々
      glowAt(140, 200, 200, '#7c4dff', 0.13);
      glowAt(340, 460, 230, '#3d5afe', 0.1);
      glowAt(240, 640, 180, '#d500f9', 0.07);
      g.fillStyle = '#fff';
      for (let i = 0; i < 130; i++) {
        g.globalAlpha = 0.25 + rngStatic(i * 1.7) * 0.6;
        g.fillRect(rngStatic(i * 2.9) * W, rngStatic(i * 5.3) * H, 1.4, 1.4);
      }
      g.globalAlpha = 1;
      break;
    }
    case 'rain': // 雷雲: 黒雲と遠雷
      g.fillStyle = 'rgba(0,0,0,.45)';
      for (const [cx0, cy0, r] of [[80, 40, 90], [200, 20, 110], [340, 50, 100], [440, 30, 80]]) {
        g.beginPath(); g.arc(cx0, cy0, r, 0, 7); g.fill();
      }
      glowAt(300, 90, 130, '#57d4ff', 0.1);
      break;
    case 'emberUp': // 紅蓮: 溶岩の照り返しと岩影
      glowAt(230, H + 60, 380, '#ff3d00', 0.22);
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.beginPath(); g.moveTo(0, H); g.lineTo(0, H - 120); g.lineTo(90, H - 60); g.lineTo(150, H - 130); g.lineTo(240, H - 40); g.lineTo(330, H - 110); g.lineTo(460, H - 70); g.lineTo(460, H); g.closePath(); g.fill();
      break;
    case 'snow': // 氷牢: 氷晶ファセット
      g.strokeStyle = 'rgba(190,240,255,.10)'; g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const x = rngStatic(i * 4.7) * W, y = rngStatic(i * 8.9) * H, r = 40 + rngStatic(i) * 70;
        g.beginPath();
        for (let k2 = 0; k2 < 6; k2++) {
          const a = k2 * Math.PI / 3 + i;
          g[k2 ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath(); g.stroke();
      }
      glowAt(230, 120, 220, '#a5f3fc', 0.07);
      break;
    case 'glitch': { // 電脳: 奥行きグリッド
      g.strokeStyle = 'rgba(255,77,255,.14)'; g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * W;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(230 + (x - 230) * 0.25, H); g.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const y = Math.pow(i / 14, 1.7) * H;
        g.globalAlpha = 0.05 + (i / 14) * 0.1;
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      g.globalAlpha = 1;
      glowAt(230, 700, 260, '#ff4dff', 0.08);
      break;
    }
    case 'shine': // 天上: 中央の御来光と雲
      glowAt(230, 300, 320, '#ffffff', 0.1);
      g.fillStyle = 'rgba(255,255,255,.05)';
      for (const [cx0, cy0, r] of [[100, 600, 70], [220, 650, 90], [360, 610, 75]]) {
        g.beginPath(); g.arc(cx0, cy0, r, 0, 7); g.fill();
      }
      break;
  }
  // 共通ビネット
  const vg = g.createRadialGradient(230, 390, 240, 230, 390, 560);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.4)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}
function rngStatic(n) { // 背景用の決定的な疑似乱数(ゲームのRNGを消費しない)
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------- 大当たり祝祭演出(金額ティア制の画面ジャック) ----------
const WIN_TIERS = [
  { min: 4000, name: 'JACKPOT FEVER', kanji: '超大当り', dur: 4.6, coins: 150, fw: 8, slow: 0.12 },
  { min: 1500, name: 'SUPER BIG WIN', kanji: '大当り',   dur: 3.4, coins: 100, fw: 5, slow: 0.18 },
  { min: 500,  name: 'BIG WIN',       kanji: '当り',     dur: 2.4, coins: 60,  fw: 3, slow: 0.3 },
];
function celebrate(amount) {
  if (S.simMode) return;
  const tier = WIN_TIERS.find(t => amount >= t.min);
  if (!tier) return;
  if (S.celebrate && S.celebrate.amount >= amount) return; // 大きい演出を優先
  S.celebrate = { t: 0, amount, tier, prog: 0 };
  hitStop(tier.slow, 0.55);
  S.cam.punch = 0.22;
  S.aberr = 2.2;
  S.boardFlash = 1;
  fx.flashDOM();
  fx.confettiBurst(tier.coins);
  if (GLP) { // GPU粒子: ティアで物量が跳ね上がる
    const cx = CFG.CW / 2, cy = CFG.CH * 0.42;
    GLP.shock(cx, cy);
    GLP.burst(cx, cy, tier.min >= 4000 ? 1200 : tier.min >= 1500 ? 700 : 380, tier.min >= 4000 ? 'rainbow' : 'gold');
    if (tier.min >= 1500) GLP.radialBurst(tier.min >= 4000 ? 1 : 0.6);
  }
  megawinSound(tier.min);
  for (let i = 0; i < tier.fw; i++) {
    setTimeout(() => { if (!S.simMode) fx.fireworks(50 + rng() * 360, 120 + rng() * 280); }, i * 240);
  }
  // コインの雨(スクリーン空間)
  for (let i = 0; i < tier.coins; i++) {
    S.coinRain.push({
      x: rng() * CFG.CW, y: -30 - rng() * CFG.CH * 0.9,
      vy: 300 + rng() * 260, vx: (rng() - 0.5) * 50,
      rot: rng() * 7, vr: (rng() - 0.5) * 9,
      ph: rng() * 7, size: 14 + rng() * 14,
    });
  }
  fountainBurst(Math.round(tier.coins * 0.5)); // 下皿からも溢れる
  if (tier.min >= 1500) charCutin('win', Math.min(2.6, tier.dur * 0.7)); // SUPER以上でキャラ歓喜
  sfx('megawin');
}
// 下皿からコインが吹き上がる噴水(勝利のコイン溢れ)
function fountainBurst(n, spread = 150) {
  if (S.simMode) return;
  for (let i = 0; i < n; i++) {
    S.coinRain.push({
      x: CFG.CW / 2 + (rng() - 0.5) * spread, y: CFG.CH - 46 - rng() * 22,
      vy: -(360 + rng() * 400), vx: (rng() - 0.5) * 260, g: 760 + rng() * 260,
      rot: rng() * 7, vr: (rng() - 0.5) * 12, ph: rng() * 7, size: 13 + rng() * 12,
    });
  }
}
function drawCoinRain(c, dt) {
  if (!S.coinRain.length) return;
  for (const cn of S.coinRain) {
    if (cn.g) cn.vy += cn.g * dt; // 噴水コインは重力で落ちて画面外へ溢れる
    cn.y += cn.vy * dt; cn.x += cn.vx * dt; cn.rot += cn.vr * dt; cn.ph += dt * 7;
    const flip = Math.max(0.08, Math.abs(Math.cos(cn.ph)));
    c.save();
    c.translate(cn.x, cn.y);
    c.rotate(cn.rot * 0.3);
    c.drawImage(SPRITES.coin, -cn.size / 2 * flip, -cn.size / 2, cn.size * flip, cn.size);
    c.restore();
  }
  S.coinRain = S.coinRain.filter(cn => cn.y < CFG.CH + 40);
}
function drawCelebration(c, dt) {
  const ce = S.celebrate;
  if (!ce) { drawCoinRain(c, dt); return; } // 祝祭終了後も降りきるまで描く
  ce.t += dt;
  const tier = ce.tier;
  if (ce.t >= tier.dur) { S.celebrate = null; return; }
  const a = Math.min(1, ce.t * 5, (tier.dur - ce.t) * 2.5);
  const W = CFG.CW, cx = W / 2, cy = CFG.CH * 0.4;
  c.save();
  c.fillStyle = `rgba(0,0,0,${0.55 * a})`;
  c.fillRect(0, 0, W, CFG.CH);
  // 金の放射(2層逆回転)
  c.globalCompositeOperation = 'lighter';
  for (const [spd, alpha, len] of [[0.7, 0.15, 560], [-0.45, 0.09, 600]]) {
    c.globalAlpha = alpha * a;
    c.fillStyle = '#ffd76a';
    const a0 = S.time * spd;
    for (let i = 0; i < 14; i++) {
      const ang = a0 + i * Math.PI / 7;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      c.lineTo(cx + Math.cos(ang + 0.13) * len, cy + Math.sin(ang + 0.13) * len);
      c.closePath(); c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';
  // コインの雨(暗転・放射の上、文字の下)
  c.globalAlpha = 1;
  drawCoinRain(c, dt);
  c.globalAlpha = a;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // ティア名
  c.fillStyle = '#fff';
  c.font = '20px "Mochiy", sans-serif';
  c.letterSpacing = '6px';
  c.fillText(tier.name, cx, cy - 128);
  c.letterSpacing = '0px';
  // 漢字ドン(着地バウンド)
  const pop = ce.t < 0.45 ? 1 + (0.45 - ce.t) * 2.4 : 1 + Math.sin(S.time * 6) * 0.02;
  c.save();
  c.translate(cx, cy - 52);
  c.scale(pop, pop);
  c.font = '86px "Mochiy", sans-serif';
  c.lineWidth = 10; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(130,20,20,.95)';
  c.strokeText(tier.kanji, 0, 0);
  const gg = c.createLinearGradient(0, -44, 0, 44);
  gg.addColorStop(0, '#fff8d8'); gg.addColorStop(0.45, '#ffd76a'); gg.addColorStop(0.55, '#f5a623'); gg.addColorStop(1, '#fff2b8');
  c.fillStyle = gg;
  c.shadowColor = '#ffd76a'; c.shadowBlur = 34;
  c.fillText(tier.kanji, 0, 0);
  c.shadowBlur = 0;
  c.restore();
  // 巨大カウントアップ
  const cp = Math.min(1, ce.t / (tier.dur * 0.55));
  ce.prog = cp;
  const eased = 1 - Math.pow(1 - cp, 3);
  const val = Math.round(ce.amount * eased);
  const jit = cp < 1 ? 2.5 : 0;
  // ドーパミン: ぷっくりダメージ数字(太い茶縁 + 黄→橙グラデ)
  c.font = '52px "Mochiy", sans-serif';
  const jx = cx + (rng() - 0.5) * jit, jy = cy + 58 + (rng() - 0.5) * jit;
  const winTxt = '+' + val.toLocaleString();
  c.lineWidth = 9; c.lineJoin = 'round'; c.strokeStyle = '#5a3410';
  c.strokeText(winTxt, jx, jy);
  const ng = c.createLinearGradient(0, jy - 30, 0, jy + 30);
  ng.addColorStop(0, '#fff4b0'); ng.addColorStop(0.5, '#ffd23e'); ng.addColorStop(1, '#ff9e2e');
  c.fillStyle = ng;
  c.shadowColor = '#ff8a2e'; c.shadowBlur = 9;
  c.fillText(winTxt, jx, jy);
  c.shadowBlur = 0;
  c.font = '900 15px "Nikumaru", sans-serif';
  c.fillStyle = '#ffd76a';
  c.fillText('― 玉 GET ―', cx, cy + 108);
  c.restore();
  c.globalAlpha = 1;
}

// ---------- FEVER TIME演出(虹ストロボ+バナー+ゲージ) ----------
function drawFever(c, dt) {
  // FEVERゲージ: リールユニット下端のバー(蓄積中は虹がじわじわ満ちる)
  // スピン/リーチ中はリール窓・リーチ文字と重なるので隠す
  if (S.phase === 'play' && !S.spin) {
    const gx = CFG.FX + BLOCK.x + 16, gw = BLOCK.w - 32;
    const gy = CFG.FY + BLOCK.y + BLOCK.h - 13, gh = 7;
    const pct = S.fever ? S.fever.shots / S.fever.total : Math.min(1, (S.feverGauge || 0) / feverReq());
    c.save();
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.fillRect(gx - 1, gy - 1, gw + 2, gh + 2);
    if (pct > 0) {
      const hue = (S.time * (S.fever ? 300 : 40)) % 360;
      const gr = c.createLinearGradient(gx, 0, gx + gw, 0);
      gr.addColorStop(0, `hsl(${hue},95%,60%)`);
      gr.addColorStop(1, `hsl(${(hue + 90) % 360},95%,62%)`);
      c.fillStyle = gr;
      const pulse = pct > 0.8 && !S.fever ? 1 + Math.sin(S.time * 10) * 0.5 : 1;
      c.globalAlpha = Math.min(1, 0.75 * pulse);
      c.fillRect(gx, gy, gw * pct, gh);
      c.globalAlpha = 1;
    }
    c.font = '800 8px "Mochiy", monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = pct > 0.8 || S.fever ? '#fff' : 'rgba(255,255,255,.5)';
    c.fillText(S.fever ? `FEVER ${S.fever.shots}` : `🌷 ${S.feverGauge || 0}/20`, gx + gw / 2, gy + gh / 2 + 0.5);
    c.restore();
  }
  if (!S.fever || S.simMode) return;
  // 下皿からコインがちょろちょろ溢れ続ける
  if (rng() < dt * 20) fountainBurst(2, 220);
  const hue = (S.time * 260) % 360;
  c.save();
  c.globalCompositeOperation = 'lighter';
  // 虹の額縁ストロボ(4辺)
  const bw = 10 + Math.sin(S.time * 9) * 4;
  const edge = (x, y, w, h, hOff) => {
    c.fillStyle = `hsla(${(hue + hOff) % 360},95%,58%,${0.34 + Math.sin(S.time * 12 + hOff) * 0.14})`;
    c.fillRect(x, y, w, h);
  };
  edge(0, 0, CFG.CW, bw, 0);
  edge(0, CFG.CH - bw, CFG.CW, bw, 90);
  edge(0, 0, bw, CFG.CH, 180);
  edge(CFG.CW - bw, 0, bw, CFG.CH, 270);
  // FEVERバナー(盤面上部で脈動)
  const bob = 1 + Math.sin(S.time * 8) * 0.06;
  c.translate(CFG.CW / 2, CFG.FY + 78);
  c.scale(bob, bob);
  c.font = '34px "Mochiy", sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 7; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(0,0,0,.7)';
  c.strokeText('FEVER TIME', 0, 0);
  c.fillStyle = `hsl(${hue},100%,66%)`;
  c.shadowColor = `hsl(${hue},100%,60%)`; c.shadowBlur = 26;
  c.fillText('FEVER TIME', 0, 0);
  c.shadowBlur = 0;
  c.restore();
}

// ---------- AIアート資産(実機級グラフィック。無ければ手続き描画のまま) ----------
// 生成: gpt-image-2 / 役物枠はPILで事前クロマキー抜き済み(assets/内の *_art.webp が本番用)
const ART = { cabinet: null, bezel: null, backdrop: null, lcdBg: null };
const LCD_CREATURES = []; // 液晶内を泳ぐ生き物スプライト(6種)
function loadArt(key, src) {
  const img = new Image();
  img.onload = () => {
    ART[key] = img;
    if (key === 'backdrop') buildBackdrop();
    else if (key !== 'lcdBg' && !key.startsWith('char')) buildCabinet();
  };
  img.src = src; // 404なら onerror → 手続き描画のまま
}
loadArt('cabinet', 'assets/cabinet_art.webp');
loadArt('bezel', 'assets/bezel_art.webp');
loadArt('backdrop', 'assets/backdrop_art.webp');
loadArt('charN', 'assets/char_normal_art.webp'); // 幸運の女神(通常/激アツ/大当り)
loadArt('charH', 'assets/char_hot_art.webp');
loadArt('charW', 'assets/char_win_art.webp');
loadArt('lcdBg', 'assets/lcd_bg_art.webp'); // 液晶の既定背景(竜宮城)。面別が無い時のフォールバック
// 面ごとの液晶背景(場末/桜/深海/夏祭/銀河/雷雲/紅蓮/氷牢/電脳/天上) — S.stageで切替
const LCD_STAGE_BG = [];
for (let s = 1; s <= 10; s++) {
  const im = new Image();
  im.onload = ((idx) => () => { LCD_STAGE_BG[idx] = im; })(s);
  im.src = `assets/lcd_${s}_art.webp`;
}
function stageLcdBg() { return LCD_STAGE_BG[S.free ? S.freeTheme : S.stage] || ART.lcdBg; } // その面の背景(フリーは選択テーマ)
for (let i = 0; i < 6; i++) { // 泳ぐ生き物(金鯉/紅白鯉/カメ/フグ/タコ/招き猫魚)
  const im = new Image();
  im.onload = () => { LCD_CREATURES[i] = im; if (swimmers.length === 0) seedSwimmers(); };
  im.src = `assets/creature_${i}_art.webp`;
}
// ---------- 液晶の泳ぐ生き物システム ----------
const swimmers = []; // {sp, x, y, vx, scale, bob, flip}
let lcdSchoolT = 0;   // 群予告の残り時間
function spawnSwimmer(sp, opts = {}) {
  const rightward = opts.dir != null ? opts.dir > 0 : rng() < 0.5;
  const sc = opts.scale != null ? opts.scale : 0.34 + rng() * 0.2;
  swimmers.push({
    sp,
    x: opts.x != null ? opts.x : (rightward ? -0.15 : 1.15),
    y: opts.y != null ? opts.y : 0.18 + rng() * 0.62,
    vx: (rightward ? 1 : -1) * (opts.speed != null ? opts.speed : 0.06 + rng() * 0.06),
    scale: sc, bob: rng() * 7, bobAmp: 0.01 + rng() * 0.02,
    flip: !rightward, // スプライトは右向き基準。左進行なら反転
    life: opts.life != null ? opts.life : 999,
    cheer: 0,
  });
}
function seedSwimmers() { // 平常時の常駐回遊(3匹)
  swimmers.length = 0;
  if (!LCD_CREATURES.length) return;
  for (let i = 0; i < 3; i++) {
    spawnSwimmer((i * 2) % LCD_CREATURES.length, { x: 0.15 + rng() * 0.7 });
  }
}
function updateSwimmers(dt) {
  // 平常時は3匹前後を維持
  if (!S.spin && !S.rush && !S.celebrate && swimmers.filter(s => s.life > 900).length < 3 && LCD_CREATURES.length && rng() < dt * 0.6) {
    spawnSwimmer((rng() * LCD_CREATURES.length) | 0);
  }
  // リーチ突入で「鯉群予告」(激アツほど大群)
  if (lcdSchoolT > 0) {
    lcdSchoolT -= dt;
    if (LCD_CREATURES.length && rng() < dt * (S.spin && S.spin.hot ? 7 : 4)) {
      spawnSwimmer(rng() < 0.5 ? 0 : 1, { dir: 1, y: 0.2 + rng() * 0.55, speed: 0.2 + rng() * 0.14, scale: 0.42 + rng() * 0.18, life: 5 });
    }
  }
  for (const s of swimmers) {
    s.x += s.vx * dt;
    s.bob += dt * 2.2;
    if (s.life < 900) s.life -= dt;
    if (s.cheer > 0) s.cheer -= dt;
  }
  // 画面外/寿命切れを除去
  for (let i = swimmers.length - 1; i >= 0; i--) {
    const s = swimmers[i];
    if (s.x < -0.3 || s.x > 1.3 || s.life <= 0) swimmers.splice(i, 1);
  }
}
function cheerSwimmers() { for (const s of swimmers) s.cheer = 1.2; }

// ---------- 視差(疑似3D): マウス/ジャイロで筐体と盤面背景が別々に動く ----------
const PARA = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener('mousemove', e => {
  PARA.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  PARA.ty = (e.clientY / window.innerHeight - 0.5) * 2;
});
function bindTilt() {
  window.addEventListener('deviceorientation', e => {
    if (e.gamma == null) return;
    PARA.tx = Math.max(-1, Math.min(1, e.gamma / 28));
    PARA.ty = Math.max(-1, Math.min(1, (e.beta - 45) / 32));
  });
}
if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
  // iOS: 初回タップで許可を求める(拒否/未対応でも何も起きないだけ)
  document.addEventListener('touchstart', () => {
    DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') bindTilt(); }).catch(() => {});
  }, { once: true });
} else if (window.DeviceOrientationEvent) bindTilt();

// ---------- キャラカットイン(実機の液晶キャラ演出) ----------
function charCutin(kind, dur = 2.2) {
  const img = ART[{ normal: 'charN', hot: 'charH', win: 'charW' }[kind]];
  if (!img || S.simMode) return;
  S.charFx = { img, kind, t: 0, dur };
}
function drawCharFx(c, dt) {
  const cf = S.charFx;
  if (!cf) return;
  cf.t += dt;
  if (cf.t >= cf.dur) { S.charFx = null; return; }
  const W = CFG.CW, H = CFG.CH;
  const inT = Math.min(1, cf.t / 0.28);
  const ease = 1 - Math.pow(1 - inT, 3);
  const outT = Math.max(0, (cf.t - (cf.dur - 0.3)) / 0.3);
  const ch = H * 0.56;   /* 巨大キャラの占有と白飛び面積を軽減(ドーパミン演出として大きめは維持) */
  const cw = ch * (cf.img.width / cf.img.height);
  const x = W - (cw * 0.92) * ease + (rng() - 0.5) * (cf.kind === 'hot' ? 3 : 0);
  const y = H - ch * (1 - outT * 0.25) + Math.sin(S.time * 2.2) * 6;
  const a = Math.min(1, inT * 2) * (1 - outT);
  c.save();
  c.globalAlpha = a;
  // 背後のオーラ + 集中線
  const auraCol = cf.kind === 'hot' ? '#ff3355' : cf.kind === 'win' ? '#ffd76a' : '#7ef0a8';
  const gcx = x + cw / 2, gcy = y + ch * 0.4;
  const gr = c.createRadialGradient(gcx, gcy, 10, gcx, gcy, ch * 0.62);
  gr.addColorStop(0, auraCol + 'aa'); gr.addColorStop(1, auraCol + '00');
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = gr;
  c.fillRect(gcx - ch * 0.7, gcy - ch * 0.7, ch * 1.4, ch * 1.4);
  if (S.fxMax) {
    c.strokeStyle = auraCol + '55';
    c.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const ang = i * 0.393 + S.time * (cf.kind === 'hot' ? 1.6 : 0.5);
      c.beginPath();
      c.moveTo(gcx + Math.cos(ang) * ch * 0.34, gcy + Math.sin(ang) * ch * 0.34);
      c.lineTo(gcx + Math.cos(ang) * ch * 0.85, gcy + Math.sin(ang) * ch * 0.85);
      c.stroke();
    }
  }
  c.globalCompositeOperation = 'source-over';
  c.drawImage(cf.img, x, y, cw, ch);
  c.restore();
}

// ---------- 筐体(キャビネット) ----------
const cabCv = document.createElement('canvas');
cabCv.width = CFG.CW; cabCv.height = CFG.CH;
const LEDS = [];
for (let y = 100; y <= CFG.CH - 120; y += 38) { LEDS.push({ x: 35, y }); LEDS.push({ x: CFG.CW - 16, y }); }
for (let x = 150; x <= CFG.CW - 150; x += 38) LEDS.push({ x, y: 14 });

function buildCabinet() {
  const c = cabCv.getContext('2d');
  const T = S.theme;
  const W = CFG.CW, H = CFG.CH;
  c.clearRect(0, 0, W, H);
  // 本体(プラ筐体)
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#26292c'); g.addColorStop(0.08, '#17191b');
  g.addColorStop(0.5, '#101214'); g.addColorStop(1, '#0a0b0c');
  c.fillStyle = g;
  roundRectPath(c, 2, 2, W - 4, H - 4, 26); c.fill();
  // プラの艶(縦ハイライト)
  g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(0.12, 'rgba(255,255,255,0)');
  g.addColorStop(0.88, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.05)');
  c.fillStyle = g;
  roundRectPath(c, 2, 2, W - 4, H - 4, 26); c.fill();
  // 外周クロムトリム
  g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#8b949b'); g.addColorStop(0.3, '#d8dee2'); g.addColorStop(0.6, '#5a6167'); g.addColorStop(1, '#9aa2a8');
  c.strokeStyle = g; c.lineWidth = 3;
  roundRectPath(c, 6, 6, W - 12, H - 12, 22); c.stroke();
  c.strokeStyle = T.accent + '55'; c.lineWidth = 1.5;
  roundRectPath(c, 11, 11, W - 22, H - 22, 18); c.stroke();
  // フィールド窓ベゼル
  c.fillStyle = '#000';
  roundRectPath(c, CFG.FX - 12, CFG.FY - 12, CFG.W + 24, CFG.H + 24, 18); c.fill();
  g = c.createLinearGradient(0, CFG.FY - 12, 0, CFG.FY + CFG.H + 12);
  g.addColorStop(0, '#c9d2d8'); g.addColorStop(0.5, '#4a5157'); g.addColorStop(1, '#aab3b9');
  c.strokeStyle = g; c.lineWidth = 4;
  roundRectPath(c, CFG.FX - 10, CFG.FY - 10, CFG.W + 20, CFG.H + 20, 16); c.stroke();
  c.strokeStyle = T.accent; c.lineWidth = 1.5;
  c.shadowColor = T.accent; c.shadowBlur = 10;
  roundRectPath(c, CFG.FX - 6, CFG.FY - 6, CFG.W + 12, CFG.H + 12, 14); c.stroke();
  c.shadowBlur = 0;
  // ネームプレート(上部中央)
  c.fillStyle = '#050607';
  roundRectPath(c, W / 2 - 120, 22, 240, 30, 8); c.fill();
  c.strokeStyle = '#6a7178'; c.lineWidth = 1.5;
  roundRectPath(c, W / 2 - 120, 22, 240, 30, 8); c.stroke();
  c.font = '18px "Mochiy", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = T.accent;
  c.shadowColor = T.accent; c.shadowBlur = 12;
  c.fillText('幸 運 の パ チ ン コ', W / 2, 38);
  c.shadowBlur = 0;
  // データカウンター台座(左上)
  c.fillStyle = '#050607';
  roundRectPath(c, 22, 20, 118, 34, 6); c.fill();
  c.strokeStyle = '#3a4147'; c.lineWidth = 1;
  roundRectPath(c, 22, 20, 118, 34, 6); c.stroke();
  // 回転灯ベース(右上)
  c.fillStyle = '#1a1d1f';
  c.beginPath(); c.ellipse(W - 60, 44, 30, 12, 0, 0, 7); c.fill();
  // スピーカーグリル(左下)
  c.fillStyle = '#050607';
  roundRectPath(c, 24, H - 66, 66, 48, 8); c.fill();
  c.fillStyle = '#2c3236';
  for (let gy = 0; gy < 4; gy++)
    for (let gx = 0; gx < 6; gx++) {
      c.beginPath(); c.arc(34 + gx * 9.5, H - 56 + gy * 10, 2.2, 0, 7); c.fill();
    }
  // 上皿(トレー)ベース
  g = c.createLinearGradient(0, H - 70, 0, H - 10);
  g.addColorStop(0, '#2a2e31'); g.addColorStop(1, '#131517');
  c.fillStyle = g;
  roundRectPath(c, 104, H - 68, 300, 52, 22); c.fill();
  c.fillStyle = '#08090a';
  roundRectPath(c, 114, H - 60, 280, 36, 16); c.fill();
  c.strokeStyle = '#4a5157'; c.lineWidth = 2;
  roundRectPath(c, 104, H - 68, 300, 52, 22); c.stroke();
  // ハンドル台座(右下)
  c.fillStyle = '#17191b';
  c.beginPath(); c.arc(W - 78, H - 44, 42, 0, 7); c.fill();
  g = c.createLinearGradient(W - 120, H - 86, W - 36, H - 2);
  g.addColorStop(0, '#9aa2a8'); g.addColorStop(0.5, '#3a4147'); g.addColorStop(1, '#7a828a');
  c.strokeStyle = g; c.lineWidth = 3;
  c.beginPath(); c.arc(W - 78, H - 44, 42, 0, 7); c.stroke();
  // コーナーボルト
  for (const [bx, by] of [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20]]) {
    c.fillStyle = '#5a6167';
    c.beginPath(); c.arc(bx, by, 5, 0, 7); c.fill();
    c.strokeStyle = '#23272a'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(bx - 3, by); c.lineTo(bx + 3, by); c.moveTo(bx, by - 3); c.lineTo(bx, by + 3); c.stroke();
  }
  // LEDソケット
  c.fillStyle = '#050607';
  for (const l of LEDS) { c.beginPath(); c.arc(l.x, l.y, 7, 0, 7); c.fill(); }
  // AIアート筐体: アートの黒窓(実測 x12.60-87.21%, y16.60-85.61%)を盤面矩形に正確に一致させて無歪み描画
  if (ART.cabinet) {
    const wx0 = 0.126, wx1 = 0.8721, wy0 = 0.166, wy1 = 0.8561;
    const dw = CFG.W / (wx1 - wx0), dh = CFG.H / (wy1 - wy0);
    c.drawImage(ART.cabinet, CFG.FX - wx0 * dw, CFG.FY - wy0 * dh, dw, dh);
  }
}

// 動的な筐体演出(毎フレーム)
function drawCabinetFX(c, dt) {
  const T = S.theme, W = CFG.CW, H = CFG.CH;
  // LEDチェイス
  const hot = S.spin && S.spin.reachPlayed && S.spin.hot;
  for (let i = 0; i < LEDS.length; i++) {
    const l = LEDS[i];
    let on, col;
    if (S.fever) { on = (Math.floor(S.time * 24) + i) % 4 !== 0; col = `hsl(${(S.time * 320 + i * 24) % 360},95%,62%)`; }
    else if (S.celebrate) { on = (Math.floor(S.time * 20) + i) % 3 < 2; col = i % 2 ? '#ffd76a' : '#ffffff'; }
    else if (S.rush) { on = (Math.floor(S.time * 14) + i) % 2 === 0; col = on && i % 4 < 2 ? '#ff5252' : '#ffffff'; }
    else if (hot) { on = Math.sin(S.time * 12) > 0; col = '#ff3355'; }
    else { on = ((Math.floor(S.time * 8) - i) % LEDS.length + LEDS.length) % LEDS.length < 5; col = T.accent; }
    if (!on) { c.fillStyle = '#1c2023'; c.beginPath(); c.arc(l.x, l.y, 4, 0, 7); c.fill(); continue; }
    c.fillStyle = col;
    c.shadowColor = col; c.shadowBlur = 9 + (S.beatT || 0) * 8; // BGMのキックで電飾が脈打つ
    c.beginPath(); c.arc(l.x, l.y, 4.2 + (S.beatT || 0) * 0.9, 0, 7); c.fill();
    c.shadowBlur = 0;
  }
  // データカウンター
  c.font = '12px "Mochiy", monospace';
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillStyle = '#ff5252';
  c.shadowColor = '#ff5252'; c.shadowBlur = 6;
  c.fillText(`当${String(S.stat.rush).padStart(3, '0')}`, 30, 31);
  c.fillStyle = T.accent;
  c.shadowColor = T.accent;
  c.fillText(`回${String(S.stat.heso).padStart(4, '0')}`, 30, 46);
  c.shadowBlur = 0;
  // 回転灯(RUSH中に回る)
  const lx = W - 60, ly = 32;
  if (S.rush) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const a = S.time * 5;
    for (const off of [0, Math.PI]) {
      c.fillStyle = '#ff525233';
      c.beginPath();
      c.moveTo(lx, ly);
      c.lineTo(lx + Math.cos(a + off) * 90, ly + Math.sin(a + off) * 90 - 20);
      c.lineTo(lx + Math.cos(a + off + 0.5) * 90, ly + Math.sin(a + off + 0.5) * 90 - 20);
      c.closePath(); c.fill();
    }
    c.restore();
  }
  c.fillStyle = S.rush ? '#ff5252' : '#5a2026';
  if (S.rush) { c.shadowColor = '#ff5252'; c.shadowBlur = 16; }
  c.beginPath(); c.ellipse(lx, ly, 16, 18, 0, Math.PI, 0); c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = '#6a7178'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(lx, ly, 16, 18, 0, Math.PI, 0); c.stroke();
  // 上皿の玉(持ち玉に応じて積まれる)
  const n = Math.max(0, Math.min(33, Math.round(S.balls / 120)));
  for (let i = 0; i < n; i++) {
    const bx = 126 + (i % 11) * 24 + (((i / 11) | 0) % 2) * 12;
    const by = H - 34 - ((i / 11) | 0) * 9;
    const gb = c.createRadialGradient(bx - 2, by - 2, 0.5, bx, by, 6);
    gb.addColorStop(0, '#fff'); gb.addColorStop(0.6, '#c9d2cc'); gb.addColorStop(1, '#6a737b');
    c.fillStyle = gb;
    c.beginPath(); c.arc(bx, by, 6, 0, 7); c.fill();
  }
  // 大型パワーメーター(筐体右の縦ゲージ)
  {
    const gx = W - 44, gy1 = 150, gy2 = 700;
    c.fillStyle = '#07090a';
    roundRectPath(c, gx - 10, gy1 - 12, 20, gy2 - gy1 + 24, 10);
    c.fill();
    c.strokeStyle = '#3a4147'; c.lineWidth = 1.5;
    roundRectPath(c, gx - 10, gy1 - 12, 20, gy2 - gy1 + 24, 10);
    c.stroke();
    const fh = (gy2 - gy1) * S.power;
    const gpw = c.createLinearGradient(0, gy2, 0, gy1);
    gpw.addColorStop(0, T.accent2); gpw.addColorStop(1, T.accent);
    c.fillStyle = gpw;
    roundRectPath(c, gx - 5, gy2 - fh, 10, Math.max(4, fh), 5);
    c.fill();
    c.shadowColor = T.accent; c.shadowBlur = 10;
    c.fillStyle = '#fff';
    c.fillRect(gx - 9, gy2 - fh - 2, 18, 4);
    c.shadowBlur = 0;
    c.font = '900 11px "Nikumaru", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#9aa49d';
    c.fillText('強', gx, gy1 - 26);
    c.fillText('弱', gx, gy2 + 26);
  }
  // ハンドル(パワー連動で回る)
  const hx = W - 78, hy = H - 44;
  const ang = -2.2 + S.power * 2.4;
  c.save();
  c.translate(hx, hy); c.rotate(ang);
  const gh = c.createRadialGradient(-6, -6, 2, 0, 0, 34);
  gh.addColorStop(0, '#3a4147'); gh.addColorStop(1, '#17191b');
  c.fillStyle = gh;
  c.beginPath(); c.arc(0, 0, 32, 0, 7); c.fill();
  c.strokeStyle = '#8b949b'; c.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    c.rotate(Math.PI * 2 / 3);
    c.beginPath(); c.moveTo(0, 10); c.lineTo(0, 30); c.stroke();
  }
  c.restore();
  // パワーインジケーター弧
  c.strokeStyle = T.accent;
  c.lineWidth = 4; c.lineCap = 'round';
  c.beginPath(); c.arc(hx, hy, 38, Math.PI * 0.6, Math.PI * 0.6 + S.power * Math.PI * 1.3); c.stroke();
  // 発射LED
  c.fillStyle = S.fireCd > 0.15 ? '#ff5252' : '#3a1518';
  if (S.fireCd > 0.15) { c.shadowColor = '#ff5252'; c.shadowBlur = 8; }
  c.beginPath(); c.arc(hx - 46, hy - 30, 4, 0, 7); c.fill();
  c.shadowBlur = 0;
  // ガラス反射(フィールド上の斜めハイライト)
  const gg = c.createLinearGradient(CFG.FX, CFG.FY, CFG.FX + 200, CFG.FY + 320);
  gg.addColorStop(0, 'rgba(255,255,255,.05)');
  gg.addColorStop(0.45, 'rgba(255,255,255,.012)');
  gg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gg;
  roundRectPath(c, CFG.FX - 6, CFG.FY - 6, CFG.W + 12, CFG.H + 12, 14);
  c.fill();
}

function postFX(dt) {
  if (!S.fxMax) return;
  const c = c2;
  const needCopy = S.aberr > 0.02 || S.glitchT > 0;
  if (needCopy) { copyCx.clearRect(0, 0, CFG.CW, CFG.CH); copyCx.drawImage(c2.canvas, 0, 0); }
  // ブルーム: 1/4縮小をぼかして加算合成。ただしWebGL合成側でもブルームを掛けるため、GLPがある時は二重掛けを避けてスキップ
  if (!GLP) {
    bloomCx.clearRect(0, 0, bloomCv.width, bloomCv.height);
    bloomCx.drawImage(c2.canvas, 0, 0, bloomCv.width, bloomCv.height);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.15 + S.boardFlash * 0.25 + (S.rush ? 0.1 : 0);
    try { c.filter = 'blur(5px)'; } catch (e) {}
    c.drawImage(bloomCv, 0, 0, CFG.CW, CFG.CH);
    c.filter = 'none';
    c.restore();
  }
  // 色収差(当たり/RUSH突入時)
  if (S.aberr > 0.02) {
    S.aberr *= 0.88;
    const a = S.aberr * 7;
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = 0.3;
    c.drawImage(copyCv, -a, 0);
    c.drawImage(copyCv, a, 0);
    c.restore();
  }
  // グリッチスライス(電脳/レジェンド入手)
  if (S.glitchT > 0) {
    S.glitchT -= dt;
    for (let i = 0; i < 7; i++) {
      const sy = rng() * CFG.CH, sh = 3 + rng() * 22;
      const dx = (rng() - 0.5) * 30;
      c.drawImage(copyCv, 0, sy, CFG.CW, sh, dx, sy, CFG.CW, sh);
    }
  }
  // 走査線 + フィルムグレイン
  c.globalAlpha = 0.07;
  c.drawImage(scanCv, 0, 0);
  grainTick = (grainTick + 1) % 3;               // 毎フレームだとチラつきが強いので3フレームに1回だけ更新
  if (grainTick === 0) grainFrame = (grainFrame + 1) % 3;
  c.globalAlpha = 0.55;
  c.drawImage(grainTiles[grainFrame], 0, 0, CFG.CW, CFG.CH);
  c.globalAlpha = 1;
}
function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function draw(dt) {
  const c = c2, T = S.theme;
  // バーチャルカメラ: リーチで寄り、当たりでズームパンチ、揺れは回転込み
  const cam = S.cam;
  let tz = 1, ty = 390;
  if (S.spin && S.spin.reachPlayed) { tz = 1.08; ty = 362; } // 寄りは強め＆パンは控えめに(上に振りすぎると筐体上端の電飾/データ帯が露出して「砂嵐」に見えるため)
  if (S.rush) { tz = 1.025 + Math.sin(S.time * 6) * 0.007; ty = 430; }
  cam.z += ((tz + cam.punch) - cam.z) * Math.min(1, dt * 7);
  cam.py += (ty - cam.py) * Math.min(1, dt * 5);
  if (dt > 0) cam.punch *= Math.pow(0.03, dt);
  cam.rot = S.shake > 0.5 ? (rng() - 0.5) * 0.0045 * S.shake : 0;
  // 筐体アート・電飾・窓クリップ・盤面を「同一カメラ変換」で束ねる
  //   → リーチ/RUSHズームやパンで枠(筐体)と中身(盤面)が別々に動いて分離しないようにする
  c.clearRect(0, 0, CFG.CW, CFG.CH);
  const shx = S.shake > 0.5 ? (rng() - 0.5) * S.shake : 0;
  const shy = S.shake > 0.5 ? (rng() - 0.5) * S.shake : 0;
  if (S.shake > 0.5) S.shake *= 0.86;
  c.save(); // (A) 共有カメラ(ズーム/パン/回転/手ブレ) — 筐体も盤面もこの中で描く
  c.translate(CFG.FX + CFG.W / 2, CFG.FY + CFG.H / 2);
  c.scale(cam.z, cam.z);
  c.rotate(cam.rot);
  c.translate(-(CFG.FX + CFG.W / 2) + shx, -(CFG.FY + cam.py) + shy);
  c.drawImage(cabCv, 0, 0);  // 筐体アート(視差は廃止して枠と盤面を完全一体化)
  drawCabinetFX(c, dt);       // 電飾・データカウンター・回転灯も同じカメラで動く
  c.save(); // (B) 盤面: 窓クリップ(共有カメラ空間なので筐体の窓とぴったり一致)
  roundRectPath(c, CFG.FX - 6, CFG.FY - 6, CFG.W + 12, CFG.H + 12, 14);
  c.clip();
  c.translate(CFG.FX, CFG.FY); // 以降は盤面フィールド座標(0..W,0..H)で描く(旧カメラと等価)
  // 背景(テーマごとの描き込みプリレンダ)
  c.fillStyle = T.bg2;
  c.fillRect(-30, -30, CFG.W + 60, CFG.H + 60);
  // 視差: 背景は奥レイヤーとして逆方向に少し動く(2%オーバースキャンで端切れ防止)
  c.drawImage(bgCv, -4.6 - PARA.x * 3, -7.8 - PARA.y * 2.5, CFG.W * 1.02, CFG.H * 1.02);

  // アンビエント粒子(釘の背面)
  for (const a of S.ambient) drawAmbient(c, a);

  // RUSH中: 背景で回転する放射レイ
  if (S.fxMax && S.rush) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.055 + Math.sin(S.time * 3) * 0.02;
    c.fillStyle = T.accent;
    const a0 = S.time * 0.5;
    for (let i = 0; i < 10; i++) {
      const a = a0 + i * Math.PI / 5;
      c.beginPath();
      c.moveTo(230, 390);
      c.lineTo(230 + Math.cos(a) * 640, 390 + Math.sin(a) * 640);
      c.lineTo(230 + Math.cos(a + 0.16) * 640, 390 + Math.sin(a + 0.16) * 640);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  // 外レール
  c.strokeStyle = '#ffffff22'; c.lineWidth = 6;
  c.strokeRect(9, 9, CFG.W - 18, CFG.H - 18);
  c.strokeStyle = '#ffffff12'; c.lineWidth = 2;
  for (const s of BOARD.segs) {
    if (s.leftEntry && S.rightHit) continue;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
  }
  if (S.rightHit) {
    c.beginPath(); c.moveTo(RIGHT_ENTRY_SEG.x1, RIGHT_ENTRY_SEG.y1); c.lineTo(RIGHT_ENTRY_SEG.x2, RIGHT_ENTRY_SEG.y2); c.stroke();
  }

  // センター役物(リール) — 液晶拡大モード時は中心から1.32倍にズーム表示
  const zoom = S.reelZoom;
  if (zoom) {
    c.save();
    const zx = BLOCK.x + BLOCK.w / 2, zy = BLOCK.y + BLOCK.h / 2;
    c.translate(zx, zy); c.scale(1.32, 1.32); c.translate(-zx, -zy);
  }
  drawReels(c, dt);
  if (ART.bezel) { // 金鯉の和彫り飾り枠(AIアート、リールユニットに被せる)
    c.drawImage(ART.bezel, BLOCK.x - 26, BLOCK.y - 22, BLOCK.w + 52, BLOCK.h + 48);
  }
  if (zoom) c.restore();

  // 釘(金属スプライト)。玉を主役にするため通常釘は少し落とし、ヘソ(key)だけ全輝度で残す
  for (const p of BOARD.pins) {
    if (!p.alive) continue;
    c.globalAlpha = p.key ? 1 : 0.7;
    c.drawImage(p.key ? SPRITES.pinKey : (p.guide ? SPRITES.guide : SPRITES.pin), p.x - 6.5, p.y - 6.5, 13, 13);
  }
  c.globalAlpha = 1;
  // 風車
  for (const w of BOARD.windmills) {
    w.ang += w.dir * 3.2 * dt;
    c.save(); c.translate(w.x, w.y); c.rotate(w.ang);
    c.fillStyle = '#00000055';
    c.beginPath(); c.arc(0, 0, w.r, 0, 7); c.fill();
    c.strokeStyle = T.pin; c.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      c.rotate(Math.PI * 2 / 3);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w.r - 2, 0); c.stroke();
    }
    c.fillStyle = T.accent;
    c.beginPath(); c.arc(0, 0, 3.5, 0, 7); c.fill();
    c.restore();
  }
  // チューリップ
  for (const t of TULIPS) {
    c.strokeStyle = '#ff9ecb'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(t.x - 11, t.y - 12); c.quadraticCurveTo(t.x - 13, t.y + 6, t.x - 5, t.y + 10); c.stroke();
    c.beginPath(); c.moveTo(t.x + 11, t.y - 12); c.quadraticCurveTo(t.x + 13, t.y + 6, t.x + 5, t.y + 10); c.stroke();
  }
  // ---- 発射まわりの可視化(左打ち=右レール / 右打ち=左レール) ----
  const mzX = S.rightHit ? 20 : 440;
  c.strokeStyle = S.rightHit ? '#ffffff14' : '#ffffff26';
  c.lineWidth = 5; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(453, 715); c.lineTo(453, 62); c.quadraticCurveTo(453, 20, 412, 20);
  c.stroke();
  c.strokeStyle = S.rightHit ? '#ffffff26' : '#ffffff14';
  c.beginPath();
  c.moveTo(7, 715); c.lineTo(7, 62); c.quadraticCurveTo(7, 20, 48, 20);
  c.stroke();
  // 発射口
  c.fillStyle = '#141a17';
  c.strokeStyle = T.accent; c.lineWidth = 2;
  c.beginPath(); c.arc(mzX, 26, 9, 0, 7); c.fill(); c.stroke();
  if (S.muzzle > 0) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = T.accent;
    c.globalAlpha = S.muzzle * 0.8;
    c.beginPath(); c.arc(mzX, 26, 9 + (1 - S.muzzle) * 16, 0, 7); c.fill();
    c.restore();
    S.muzzle -= dt * 4;
  }
  // 着弾予測(いまの強さだと玉がどの辺に飛ぶか)
  if (S.phase === 'play') {
    const vx = 170 + S.power * 460;
    const px = S.rightHit ? Math.min(432, 20 + vx * 0.305) : Math.max(28, 440 - vx * 0.305);
    c.setLineDash([3, 7]);
    c.strokeStyle = T.accent + '77';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(mzX, 24);
    c.quadraticCurveTo((mzX + px) / 2, 4, px, 78);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = T.accent;
    c.globalAlpha = 0.6 + Math.sin(S.time * 6) * 0.25;
    c.beginPath(); c.moveTo(px, 98); c.lineTo(px - 6, 84); c.lineTo(px + 6, 84); c.closePath(); c.fill();
    c.globalAlpha = 1;
  }
  // 役物スロット(空き=点線サークル。配置モード中は光らせて設置候補を強調)
  for (const sl of PART_SLOTS) {
    if (S.parts.some(p => p.x === sl.x && p.y === sl.y)) continue;
    if (S.placing) {
      c.strokeStyle = T.accent; c.lineWidth = 2.4;
      c.globalAlpha = 0.55 + Math.sin(S.time * 6) * 0.35;
      c.beginPath(); c.arc(sl.x, sl.y, 16, 0, 7); c.stroke();
      c.globalAlpha = 1;
    } else {
      c.strokeStyle = '#ffffff16'; c.lineWidth = 1.5;
      c.setLineDash([4, 5]);
      c.beginPath(); c.arc(sl.x, sl.y, 13, 0, 7); c.stroke();
      c.setLineDash([]);
    }
  }
  // 設置済み役物
  for (const pt of S.parts) drawPart(c, pt, dt);
  // ヘソ(金の受け口)
  const hw = hesoHalfW();
  c.fillStyle = '#00000088';
  c.fillRect(HESO.x - hw - 2, HESO.y - 4, hw * 2 + 4, 16);
  const hesoG = c.createLinearGradient(0, HESO.y - 4, 0, HESO.y + 12);
  hesoG.addColorStop(0, '#f7e7b0'); hesoG.addColorStop(0.5, '#c9971a'); hesoG.addColorStop(1, '#f3dfa0');
  c.strokeStyle = hesoG; c.lineWidth = 2.5;
  c.shadowColor = T.accent; c.shadowBlur = S.rush ? 14 : 7;
  c.strokeRect(HESO.x - hw - 2, HESO.y - 4, hw * 2 + 4, 16);
  c.shadowBlur = 0;
  // 狙点マーカー: ヘソ(得点の受け口)を示す静かな脈動リング。「どこを狙うか」を一目で示す
  if (!S.celebrate && !S.simMode) {
    const pulse = 0.5 + Math.sin(S.time * 2.6) * 0.5;
    c.save();
    c.strokeStyle = T.accent;
    c.globalAlpha = 0.22 + pulse * 0.18;
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(HESO.x, HESO.y + 4, hw + 8 + pulse * 3, 12 + pulse * 3, 0, 0, 7); c.stroke();
    c.restore();
  }
  // アタッカー
  const open = S.rush && S.rush.phase === 'open';
  c.fillStyle = open ? '#ffffff18' : '#00000066';
  c.fillRect(ATTACKER.x - ATTACKER.halfW, ATTACKER.y - 4, ATTACKER.halfW * 2, open ? 20 : 8);
  c.strokeStyle = open ? '#fff' : '#ffffff44';
  c.lineWidth = 2.5;
  if (open) { c.shadowColor = T.accent; c.shadowBlur = 18; }
  c.strokeRect(ATTACKER.x - ATTACKER.halfW, ATTACKER.y - 4, ATTACKER.halfW * 2, open ? 20 : 8);
  c.shadowBlur = 0;
  if (open) {
    c.strokeStyle = T.accent; c.lineWidth = 4; c.lineCap = 'round';
    c.shadowColor = T.accent; c.shadowBlur = 10;
    for (const s of ATT_WINGS) { c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); }
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    c.font = '700 11px "Mochiy", sans-serif'; c.textAlign = 'center';
    c.fillText(`ROUND ${S.rush.round}/${S.rush.totalRounds}  ${S.rush.catches}/${CFG.countPerRound + mods().roundCountAdd}`, ATTACKER.x, ATTACKER.y + 36);
  }
  // 玉
  for (const b of S.ballsOnBoard) {
    const bd = BALLS[b.type];
    // 尾
    if (b.trail.length >= 4) {
      c.strokeStyle = b.type === 'niji' ? `hsl(${(S.time * 260) % 360} 90% 70% / .55)` : bd.trail;
      c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(b.trail[0], b.trail[1]);
      for (let i = 2; i < b.trail.length; i += 2) c.lineTo(b.trail[i], b.trail[i + 1]);
      c.stroke();
    }
    const R = b.r + (bd.fx.pinCoinCap ? b.grown * 0.14 : 0);
    const spr = SPRITES.balls[b.type] || SPRITES.balls.shiro;
    c.drawImage(spr, b.x - R - 1, b.y - R - 1, (R + 1) * 2, (R + 1) * 2);
    if (bd.fx.sparkle && rng() < 0.25) fx.spark(b.x, b.y, bd.color, 1);
  }
  // 集中線(激アツリーチ中)
  if (S.fxMax && S.spin && S.spin.reachPlayed && S.spin.hot) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = '#ff5d5d';
    const cx0 = BLOCK.x + BLOCK.w / 2, cy0 = BLOCK.y + BLOCK.h / 2;
    for (let i = 0; i < 22; i++) {
      if (rng() < 0.45) continue;
      const a = rng() * Math.PI * 2;
      const r1 = 300 + rng() * 140, r2 = r1 - (70 + rng() * 100);
      c.globalAlpha = 0.05 + rng() * 0.13;
      c.lineWidth = 1 + rng() * 2.5;
      c.beginPath();
      c.moveTo(cx0 + Math.cos(a) * r1, cy0 + Math.sin(a) * r1);
      c.lineTo(cx0 + Math.cos(a) * r2, cy0 + Math.sin(a) * r2);
      c.stroke();
    }
    c.restore();
  }
  // 花火ロケット
  for (const r of S.rockets) {
    r.t += dt; r.y -= 640 * dt; r.x += r.vx * dt;
    if (rng() < 0.7) S.particles.push({ x: r.x, y: r.y, vx: (rng() - 0.5) * 20, vy: 50, t: 0, life: 0.3, color: r.color, g: 0 });
    c.fillStyle = '#fff';
    c.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);
    if (r.y <= r.ty) {
      r.dead = true;
      for (let i = 0; i < 30; i++) {
        const a = rng() * Math.PI * 2, sp = 90 + rng() * 230;
        S.particles.push({
          x: r.x, y: r.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          t: 0, life: 0.9 + rng() * 0.4, g: 260,
          color: rng() < 0.3 ? '#ffffff' : r.color,
        });
      }
      fx.ring(r.x, r.y, r.color);
      boomNoise(0.07, 0.3);
    }
  }
  S.rockets = S.rockets.filter(r => !r.dead && r.y > -30);
  // FXパーティクル
  for (const p of S.particles) {
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.g != null ? p.g : 500) * dt;
    c.globalAlpha = Math.max(0, 1 - p.t / (p.life || 0.45));
    c.fillStyle = p.color;
    c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  c.globalAlpha = 1;
  S.particles = S.particles.filter(p => p.t < (p.life || 0.45));
  // リング衝撃波
  for (const r of S.rings) {
    r.t += dt; r.r += 260 * dt;
    c.globalAlpha = Math.max(0, 0.9 - r.t * 1.8);
    c.strokeStyle = r.color; c.lineWidth = 3;
    c.beginPath(); c.arc(r.x, r.y, r.r, 0, 7); c.stroke();
    if (r.bolt && r.t < 0.22) {
      c.strokeStyle = '#e0fbff'; c.lineWidth = 2.5;
      c.beginPath();
      let bx = r.bolt.x, by = 0;
      c.moveTo(bx, by);
      while (by < r.bolt.y) { bx += (rng() - 0.5) * 34; by += 34; c.lineTo(bx, by); }
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  S.rings = S.rings.filter(r => r.t < 0.55);
  // コイン飛翔
  for (const cn of S.coins) {
    cn.t += dt;
    if (cn.t < 0) continue;
    const k = Math.min(1, cn.t / 0.6);
    const ease = k * k * (3 - 2 * k);
    const px = cn.x + (cn.tx - cn.x) * ease;
    const py = cn.y + (cn.ty - cn.y) * ease - Math.sin(k * Math.PI) * 60;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(px, py, 3.4, 0, 7); c.fill();
    c.fillStyle = T.accent;
    c.beginPath(); c.arc(px, py, 1.8, 0, 7); c.fill();
    if (k >= 1) { cn.dead = true; sfx('tick'); }
  }
  S.coins = S.coins.filter(cn => !cn.dead);
  // 紙吹雪
  for (const f of S.confetti) {
    f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
    c.save(); c.translate(f.x, f.y); c.rotate(f.rot);
    c.globalAlpha = Math.max(0, 1.1 - f.t * 0.45);
    c.fillStyle = f.color;
    c.fillRect(-f.w / 2, -f.h / 2, f.w, f.h * (0.4 + Math.abs(Math.sin(f.t * 9 + f.rot))));
    c.restore();
  }
  c.globalAlpha = 1;
  S.confetti = S.confetti.filter(f => f.y < CFG.H + 30 && f.t < 2.6);
  // フロートテキスト
  c.textAlign = 'center';
  for (const p of S.floats) {
    p.t += dt;
    c.globalAlpha = Math.max(0, 1 - p.t * 1.3);
    c.fillStyle = p.color;
    c.font = '14px "Mochiy", sans-serif';
    c.fillText(p.txt, p.x, p.y - p.t * 36);
  }
  c.globalAlpha = 1;
  S.floats = S.floats.filter(p => p.t < 0.8);
  // 全画面フラッシュ(盤面)
  if (S.boardFlash > 0.02) {
    c.fillStyle = T.accent;
    c.globalAlpha = S.boardFlash * 0.22;
    c.fillRect(-30, -30, CFG.W + 60, CFG.H + 60);
    c.globalAlpha = 1;
    S.boardFlash *= 0.9;
  }
  c.restore(); // (B) 盤面おわり
  c.restore(); // (A) 共有カメラおわり
  // 以下は画面固定オーバーレイ(ズームで動かさない): FEVER/キャラ/祝祭/ポストFX
  drawFever(c, dt);
  drawCharFx(c, dt);
  drawCelebration(c, dt);
  postFX(dt);
}
function drawAmbient(c, a) {
  const T = S.theme;
  c.save();
  switch (a.kind) {
    case 'dust': c.globalAlpha = 0.25; c.fillStyle = T.accent; c.fillRect(a.x, a.y, a.size, a.size); break;
    case 'petal':
      c.globalAlpha = 0.7; c.fillStyle = '#ffb3d1';
      c.translate(a.x, a.y); c.rotate(Math.sin(S.time * 2 + a.ph) * 0.9);
      c.beginPath(); c.ellipse(0, 0, a.size, a.size * 0.55, 0, 0, 7); c.fill();
      break;
    case 'bubble':
      c.globalAlpha = 0.4; c.strokeStyle = '#9adcff'; c.lineWidth = 1;
      c.beginPath(); c.arc(a.x + Math.sin(S.time * 2 + a.ph) * 8, a.y, a.size, 0, 7); c.stroke();
      break;
    case 'lantern': {
      c.globalAlpha = 0.16 + Math.sin(S.time * 2.4 + a.ph) * 0.08;
      const g = c.createRadialGradient(a.x, a.y, 1, a.x, a.y, a.size * 3);
      g.addColorStop(0, '#ffb057'); g.addColorStop(1, 'transparent');
      c.fillStyle = g;
      c.beginPath(); c.arc(a.x, a.y, a.size * 3, 0, 7); c.fill();
      break;
    }
    case 'star':
      c.globalAlpha = 0.35 + Math.sin(S.time * 3 + a.ph) * 0.3;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(a.x, a.y, a.size, 0, 7); c.fill();
      break;
    case 'rain':
      c.globalAlpha = 0.32; c.strokeStyle = '#9ad8ff'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x - 3, a.y + 14); c.stroke();
      break;
    case 'emberUp':
      c.globalAlpha = 0.6; c.fillStyle = pick(['#ff8a5c', '#ffb347', '#ff5252']);
      c.beginPath(); c.arc(a.x + Math.sin(S.time * 3 + a.ph) * 6, a.y, a.size, 0, 7); c.fill();
      break;
    case 'snow':
      c.globalAlpha = 0.65; c.fillStyle = '#eef7ff';
      c.beginPath(); c.arc(a.x, a.y, a.size, 0, 7); c.fill();
      break;
    case 'glitch':
      c.globalAlpha = 0.3; c.fillStyle = pick(['#ff4dff', '#4dfff9', '#ffffff']);
      c.fillRect(a.x, a.y, a.size * 2.4, 2);
      break;
    case 'shine':
      c.globalAlpha = 0.3 + Math.sin(S.time * 2 + a.ph) * 0.25;
      c.fillStyle = `hsl(${(S.time * 40 + a.ph * 60) % 360} 80% 85%)`;
      c.beginPath(); c.arc(a.x, a.y, a.size, 0, 7); c.fill();
      break;
  }
  c.restore();
}
// 役物パーツの描画
function drawPart(c, pt, dt) {
  pt.flash = Math.max(0, pt.flash - dt * 3);
  const fl = pt.flash;
  c.save();
  c.translate(pt.x, pt.y);
  switch (pt.type) {
    case 'bumper': {
      const R = 12 + fl * 3;
      const g = c.createRadialGradient(-3, -3, 2, 0, 0, R);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.4, pt.id === 'goldbump' ? '#ffd166' : '#ff6b81');
      g.addColorStop(1, pt.id === 'goldbump' ? '#8a6a1a' : '#8a2a3a');
      c.fillStyle = g;
      if (fl > 0) { c.shadowColor = '#fff'; c.shadowBlur = 16 * fl; }
      c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#ffffff99'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, R - 4, 0, 7); c.stroke();
      break;
    }
    case 'windmill': {
      pt.ang += pt.dir * 3.4 * dt;
      c.rotate(pt.ang);
      c.fillStyle = '#00000055';
      c.beginPath(); c.arc(0, 0, 14, 0, 7); c.fill();
      c.strokeStyle = S.theme.pin; c.lineWidth = 3;
      for (let i = 0; i < 3; i++) { c.rotate(Math.PI * 2 / 3); c.beginPath(); c.moveTo(0, 0); c.lineTo(12, 0); c.stroke(); }
      c.fillStyle = S.theme.accent;
      c.beginPath(); c.arc(0, 0, 3.5, 0, 7); c.fill();
      break;
    }
    case 'pocket': {
      const hw = pt.narrow ? 7 : 11;
      c.fillStyle = '#00000088';
      c.fillRect(-hw - 2, -4, hw * 2 + 4, 14);
      c.strokeStyle = '#ffd166'; c.lineWidth = 2 + fl * 2;
      if (fl > 0) { c.shadowColor = '#ffd166'; c.shadowBlur = 14 * fl; }
      c.strokeRect(-hw - 2, -4, hw * 2 + 4, 14);
      c.shadowBlur = 0;
      c.font = '900 10px sans-serif'; c.textAlign = 'center';
      c.fillStyle = '#ffd166';
      c.fillText(`+${pt.pay}`, 0, 24);
      break;
    }
    case 'vpocket': {
      c.strokeStyle = '#ff3355'; c.lineWidth = 3; c.lineCap = 'round';
      if (fl > 0 || (S.time % 1) < 0.5) { c.shadowColor = '#ff3355'; c.shadowBlur = 12; }
      c.beginPath(); c.moveTo(-9, -10); c.lineTo(0, 8); c.lineTo(9, -10); c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#00000088';
      c.fillRect(-9, 8, 18, 8);
      break;
    }
    case 'warp': {
      pt.ang += dt * 4;
      c.strokeStyle = '#c084fc'; c.lineWidth = 2.5;
      c.shadowColor = '#c084fc'; c.shadowBlur = 8 + fl * 12;
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.arc(0, 0, 11, pt.ang + i * 2.1, pt.ang + i * 2.1 + 1.3); c.stroke();
      }
      c.shadowBlur = 0;
      break;
    }
    case 'magnet': {
      const pulse = 0.5 + Math.sin(S.time * 5) * 0.5;
      c.strokeStyle = '#40c4ff'; c.lineWidth = 2.5;
      c.globalAlpha = 0.35 + pulse * 0.3;
      c.beginPath(); c.arc(0, 0, 10 + pulse * 4, Math.PI * 0.15, Math.PI * 0.85, true); c.stroke();
      c.beginPath(); c.arc(0, 0, 16 + pulse * 5, Math.PI * 0.2, Math.PI * 0.8, true); c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = '#40c4ff';
      c.fillRect(-8, -3, 5, 8); c.fillRect(3, -3, 5, 8);
      break;
    }
    case 'splitter': {
      pt.ang += dt * 1.6;
      c.rotate(pt.ang);
      c.strokeStyle = '#f0f0ff'; c.lineWidth = 1.6;
      c.globalAlpha = 0.5 + Math.sin(S.time * 4) * 0.25;
      c.strokeRect(-16, -16, 32, 32);
      c.rotate(Math.PI / 4);
      c.strokeRect(-16, -16, 32, 32);
      c.globalAlpha = 1;
      break;
    }
    case 'jumper': {
      c.fillStyle = '#9ccc65';
      c.beginPath();
      c.moveTo(-15, 8); c.lineTo(15, 8); c.lineTo(Math.sign(230 - pt.x) * 15, -6);
      c.closePath(); c.fill();
      if (fl > 0) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      break;
    }
  }
  c.restore();
}

function drawReels(c, dt) {
  const T = S.theme;
  // 当たりサンバースト(役物の背後から放射)
  if (S.winFx) {
    S.winFx.t += dt;
    if (S.winFx.t > 1.5) S.winFx = null;
    else {
      const cx0 = BLOCK.x + BLOCK.w / 2, cy0 = BLOCK.y + BLOCK.h / 2;
      const a0 = S.winFx.t * 1.1;
      c.save();
      c.globalAlpha = Math.max(0, 0.5 - S.winFx.t * 0.33);
      c.fillStyle = SYMBOLS[S.winFx.symbol] ? SYMBOLS[S.winFx.symbol].color : '#fff';
      for (let i = 0; i < 12; i++) {
        const a = a0 + i * Math.PI / 6;
        c.beginPath();
        c.moveTo(cx0, cy0);
        c.lineTo(cx0 + Math.cos(a) * 340, cy0 + Math.sin(a) * 340);
        c.lineTo(cx0 + Math.cos(a + 0.11) * 340, cy0 + Math.sin(a + 0.11) * 340);
        c.closePath(); c.fill();
      }
      c.restore();
    }
  }
  // 金装飾リム(二重)+筐体
  const goldRim = c.createLinearGradient(0, BLOCK.y - 6, 0, BLOCK.y + BLOCK.h + 6);
  goldRim.addColorStop(0, '#f3dfa0'); goldRim.addColorStop(0.35, '#b8860b'); goldRim.addColorStop(0.6, '#f7e7b0'); goldRim.addColorStop(1, '#7a5b08');
  c.strokeStyle = goldRim; c.lineWidth = 3;
  roundRectPath(c, BLOCK.x - 7, BLOCK.y - 7, BLOCK.w + 14, BLOCK.h + 14, BLOCK.r + 6);
  c.stroke();
  const rim = c.createLinearGradient(0, BLOCK.y - 4, 0, BLOCK.y + BLOCK.h + 4);
  rim.addColorStop(0, '#79817b'); rim.addColorStop(0.5, '#d4dcd6'); rim.addColorStop(1, '#454c47');
  c.strokeStyle = rim; c.lineWidth = 5;
  roundRectPath(c, BLOCK.x - 3, BLOCK.y - 3, BLOCK.w + 6, BLOCK.h + 6, BLOCK.r + 3);
  c.stroke();
  // 電飾クラスタ(役物の左右+クラウン)
  {
    const lampsPos = [];
    for (let i = 0; i < 5; i++) {
      lampsPos.push([BLOCK.x - 14, BLOCK.y + 22 + i * 32]);
      lampsPos.push([BLOCK.x + BLOCK.w + 14, BLOCK.y + 22 + i * 32]);
    }
    for (let i = -2; i <= 2; i++) lampsPos.push([BLOCK.x + BLOCK.w / 2 + i * 30, BLOCK.y - 15 - (2 - Math.abs(i)) * 4]);
    for (let i = 0; i < lampsPos.length; i++) {
      const [lx, ly] = lampsPos[i];
      let col, on;
      if (S.celebrate) { on = (Math.floor(S.time * 18) + i) % 3 < 2; col = i % 2 ? '#ffd76a' : '#ffffff'; }
      else if (S.rush) { on = (Math.floor(S.time * 12) + i) % 2 === 0; col = '#ff5252'; }
      else if (S.spin && S.spin.reachPlayed) { on = Math.sin(S.time * 10 + i) > 0; col = S.spin.hot ? '#ff3355' : T.accent; }
      else { on = Math.sin(S.time * 2.2 + i * 0.9) > -0.2; col = T.accent; }
      c.fillStyle = on ? col : '#181c1a';
      if (on) { c.shadowColor = col; c.shadowBlur = 9; }
      c.beginPath(); c.arc(lx, ly, 4, 0, 7); c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#00000066'; c.lineWidth = 1;
      c.beginPath(); c.arc(lx, ly, 4.6, 0, 7); c.stroke();
    }
  }
  // ===== 液晶パネル(竜宮城の水中+泳ぐ生き物) =====
  c.save();
  roundRectPath(c, BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h, BLOCK.r);
  c.clip();
  const lcdImg = stageLcdBg();
  if (lcdImg) {
    // その面のテーマ背景をcover-fit+ゆっくり横スクロールで動きを出す
    const img = lcdImg;
    const sc = Math.max(BLOCK.w / img.width, (BLOCK.h + 8) / img.height) * 1.08;
    const dw = img.width * sc, dh = img.height * sc;
    const dx = BLOCK.x + (BLOCK.w - dw) / 2 + Math.sin(S.time * 0.15) * 6;
    const dy = BLOCK.y + (BLOCK.h - dh) / 2;
    c.drawImage(img, dx, dy, dw, dh);
    // エミッシブ加算: 液晶を「自発光する明るい画面」にしてブルームを乗せる
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.28;
    c.drawImage(img, dx, dy, dw, dh);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    // リーチ/RUSH中は水中を暗転させて緊張感(生き物と数字を目立たせる)
    if (S.spin && S.spin.reachPlayed) { c.fillStyle = S.spin.hot ? 'rgba(40,0,10,0.4)' : 'rgba(0,10,20,0.3)'; c.fillRect(BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h); }
  } else {
    c.fillStyle = '#04121f'; c.fillRect(BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h);
  }
  // 泳ぐ生き物(BLOCK相対座標→絶対座標)
  for (const s of swimmers) {
    const sp = LCD_CREATURES[s.sp];
    if (!sp) continue;
    const px = BLOCK.x + s.x * BLOCK.w;
    let py = BLOCK.y + s.y * BLOCK.h + Math.sin(s.bob) * BLOCK.h * s.bobAmp;
    const cheer = s.cheer > 0 ? Math.abs(Math.sin(s.cheer * 12)) : 0;
    py -= cheer * 10; // 歓喜バウンス
    const h = BLOCK.h * s.scale, w = h * (sp.width / sp.height);
    c.save();
    c.translate(px, py);
    if (s.flip) c.scale(-1, 1);
    c.drawImage(sp, -w / 2, -h / 2, w, h);
    c.restore();
  }
  // 泡(常時ゆらぐ)
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const bx = BLOCK.x + ((i * 37 + S.time * 9) % BLOCK.w);
    const by = BLOCK.y + BLOCK.h - ((S.time * 22 + i * 53) % BLOCK.h);
    c.fillStyle = 'rgba(200,240,255,0.14)';
    c.beginPath(); c.arc(bx, by, 2 + (i % 3), 0, 7); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  c.restore();
  const glow = S.rush ? 18 : S.spin && S.spin.reachPlayed ? 22 : 8;
  c.strokeStyle = S.spin && S.spin.reachPlayed && S.spin.hot ? '#ff3355' : T.accent;
  c.lineWidth = S.rush ? 3 : 2;
  c.shadowColor = c.strokeStyle; c.shadowBlur = glow + Math.sin(S.time * 5) * 4;
  roundRectPath(c, BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h, BLOCK.r);
  c.stroke();
  c.shadowBlur = 0;
  // 3本の縦ストリップ(上下の境界なし=リールが枠まで一続き)
  let ids = Object.keys(S.symbolPool).filter(id => S.symbolPool[id] > 0);
  if (ids.length === 0) ids = ['seven', 'cherry', 'clover', 'bell', 'diamond'];
  const winW = REEL.winW, winH = REEL.winH, gap = REEL.gap;
  const x0 = BLOCK.x + BLOCK.w / 2 - (winW * 1.5 + gap);
  const y0 = BLOCK.y + REEL.y0off;
  const sy0 = BLOCK.y + 2, syH = BLOCK.h - 4; // ストリップは液晶の上下端まで
  for (let i = 0; i < 3; i++) {
    const wx = x0 + i * (winW + gap), wy = y0;
    const cy = wy + winH / 2; // 有効ライン(勝負ライン)の中心
    if (S.reelCards !== false) {
      const gg = c.createLinearGradient(wx, sy0, wx, sy0 + syH);
      gg.addColorStop(0, 'rgba(11,15,25,0.9)');
      gg.addColorStop(0.5, 'rgba(22,30,46,0.6)');
      gg.addColorStop(1, 'rgba(7,10,17,0.92)');
      c.fillStyle = gg;
      c.fillRect(wx, sy0, winW, syH);
      // 左右の縁だけ描く(上下の境界はなし)
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(wx - 1, sy0, 1, syH);
      c.fillRect(wx + winW, sy0, 1, syH);
    }
    c.save();
    c.beginPath(); c.rect(wx, sy0, winW, syH); c.clip();
    const settled = !S.spin || S.spin.t >= S.spin.stopAt[i];
    // 静止中も上下に隣の絵柄を薄く見せる(連続したリール帯の実在感)
    const drawNeighbors = (faceId) => {
      const idx = Math.max(0, ids.indexOf(faceId));
      for (const k of [-2, -1, 1, 2]) {
        const nid = ids[((idx + k) % ids.length + ids.length) % ids.length];
        const yy = cy + k * winH * 0.92;
        if (yy < sy0 - 30 || yy > sy0 + syH + 30) continue;
        c.globalAlpha = 0.3;
        drawSymbol(c, nid, wx + winW / 2, yy, REEL.drum);
      }
      c.globalAlpha = 1;
    };
    if (!S.spin) {
      const faces = S.lastDigits || ['seven', 'seven', 'seven'];
      drawNeighbors(faces[i]);
      drawSymbol(c, faces[i], wx + winW / 2, cy, REEL.sym);
    } else if (settled) {
      const pop = Math.max(0, 1 - (S.spin.t - S.spin.stopAt[i]) * 5);
      drawNeighbors(S.spin.faces[i]);
      drawSymbol(c, S.spin.faces[i], wx + winW / 2, cy, REEL.sym + pop * 6);
    } else {
      // 回転中: ストリップ全域を絵柄列が流れる(端の潰れ欠片は出さない)
      const slow = i === 2 && S.spin.reachPlayed;
      let off;
      if (slow) {
        const raw = S.spin.t * 2.6 + i * 1.7;
        const st = Math.floor(raw), fr = raw - st;
        off = (st + (fr > 0.72 ? (fr - 0.72) / 0.28 : 0)) % ids.length;
      } else {
        off = (S.spin.t * 16 + i * 1.7) % ids.length;
      }
      const span = Math.ceil((syH / 2) / (winH * 0.92)) + 1;
      for (let k = -span; k <= span; k++) {
        const idx = ((Math.floor(off) + k) % ids.length + ids.length) % ids.length;
        const yy = cy + (k - (off % 1)) * winH * 0.92;
        if (yy < sy0 - 30 || yy > sy0 + syH + 30) continue;
        const rel = (yy - cy) / (syH * 0.55);
        const sq = Math.max(0.84, Math.cos(rel * 0.5)); // ドラム感はごく弱く(潰れない)
        const fade = Math.max(0.22, 1 - Math.abs(rel) * 0.6);
        c.save();
        c.translate(wx + winW / 2, yy);
        c.scale(1, sq);
        c.globalAlpha = (slow ? 0.95 : 0.62) * fade;
        drawSymbol(c, ids[idx], 0, 0, REEL.drum);
        c.restore();
      }
      c.globalAlpha = 1;
      if (!slow) {
        // モーションブラーの縦スジ(ストリップ全域)
        c.fillStyle = '#ffffff10';
        c.fillRect(wx, sy0, winW, syH);
        for (let s2 = 0; s2 < 3; s2++) {
          const sy = (S.time * 900 + s2 * 47 + i * 29) % syH;
          c.fillStyle = '#ffffff1a';
          c.fillRect(wx + 7 + s2 * 17, sy0 + sy - 18, 4, 36);
        }
      }
    }
    // ガラス反射(ストリップ全体)
    const gl = c.createLinearGradient(wx, sy0, wx + winW, sy0 + syH);
    gl.addColorStop(0, 'rgba(255,255,255,.1)');
    gl.addColorStop(0.4, 'rgba(255,255,255,.02)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl;
    c.fillRect(wx, sy0, winW, syH);
    c.restore();
  }
  // 有効ライン: 上下の細いラインと両サイドの▶◀マーカー(カード枠の代わり)
  {
    const lx0 = x0 - 4, lx1 = x0 + winW * 3 + gap * 2 + 4;
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(lx0, y0); c.lineTo(lx1, y0);
    c.moveTo(lx0, y0 + winH); c.lineTo(lx1, y0 + winH); c.stroke();
    const my = y0 + winH / 2;
    c.fillStyle = S.spin && S.spin.reachPlayed && S.spin.hot ? '#ff3355' : T.accent;
    c.beginPath(); c.moveTo(lx0 - 7, my - 6); c.lineTo(lx0 - 7, my + 6); c.lineTo(lx0 + 1, my); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(lx1 + 7, my - 6); c.lineTo(lx1 + 7, my + 6); c.lineTo(lx1 - 1, my); c.closePath(); c.fill();
  }
  // ラベル(ストリップの上に後描き)
  c.font = '900 11px sans-serif'; c.textAlign = 'center';
  c.shadowColor = '#000'; c.shadowBlur = 6;
  c.fillStyle = S.rush ? '#fff' : T.accent;
  const label = S.rush ? `⚡ RUSH ${S.rush.label} ⚡` : `${T.num}「${T.name}」`;
  c.fillText(label, BLOCK.x + BLOCK.w / 2, BLOCK.y + 20);
  c.shadowBlur = 0;
  // リーチ演出: 有効ライン行の外周が脈打つ
  if (S.spin && S.spin.reachPlayed) {
    const rc = S.spin.hot ? '#ff3355' : T.accent;
    c.strokeStyle = rc;
    c.globalAlpha = 0.5 + Math.sin(S.time * (S.spin.hot ? 16 : 10)) * 0.4;
    c.lineWidth = S.spin.hot ? 4 : 3;
    roundRectPath(c, x0 - 5, y0 - 5, winW * 3 + gap * 2 + 10, winH + 10, 9);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = S.spin.hot ? '#ff6b81' : '#fff';
    c.font = '15px "Mochiy", sans-serif';
    c.fillText(S.spin.hot ? '激アツ！！' : 'リーチ！', BLOCK.x + BLOCK.w / 2, y0 + winH + 22);
  }
  // ランプ列 / WINカウントアップ
  const lampY = BLOCK.y + BLOCK.h - 36;
  if (S.winFx && S.winFx.amount > 0) {
    const k = Math.min(1, S.winFx.t / 0.9);
    c.fillStyle = '#fff';
    c.shadowColor = T.accent; c.shadowBlur = 14;
    c.font = '24px "Mochiy", sans-serif'; c.textAlign = 'center';
    c.fillText(`+${Math.round(S.winFx.amount * k)}`, BLOCK.x + BLOCK.w / 2, lampY + 12);
    c.shadowBlur = 0;
  } else {
    for (let i = 0; i < 12; i++) {
      const lx = BLOCK.x + 22 + i * ((BLOCK.w - 44) / 11);
      const on = S.rush
        ? (Math.floor(S.time * 12) + i) % 2 === 0
        : (Math.floor(S.time * 6) + i) % 12 < 3;
      c.fillStyle = on ? (S.rush ? '#ff5252' : T.accent) : '#ffffff14';
      if (on) { c.shadowColor = c.fillStyle; c.shadowBlur = 6; }
      c.beginPath(); c.arc(lx, lampY + 4, 3, 0, 7); c.fill();
      c.shadowBlur = 0;
    }
  }
  // 保留ドット(金/赤保留=先読み示唆)
  const max = CFG.holdMax + mods().holdAdd;
  for (let i = 0; i < max; i++) {
    const hx = BLOCK.x + BLOCK.w / 2 - ((max - 1) * 14) / 2 + i * 14;
    const hy = BLOCK.y + BLOCK.h - 13;
    let col = '#ffffff1a', rr = 4.4;
    if (i < S.hold.length) {
      const hint = S.hold[i].hint;
      col = hint === 'red' ? '#ff5252' : hint === 'gold' ? '#ffd166' : T.accent;
      if (hint) {
        rr = 4.4 + Math.sin(S.time * 8 + i) * 1.5;
        c.shadowColor = col; c.shadowBlur = 8;
      }
    }
    c.fillStyle = col;
    c.beginPath(); c.arc(hx, hy, rr, 0, 7); c.fill();
    c.shadowBlur = 0;
    if (i < S.hold.length) {
      c.fillStyle = '#ffffff88';
      c.beginPath(); c.arc(hx - 1, hy - 1, 1.4, 0, 7); c.fill();
    }
  }
}

// ---------- おまかせ照準 ----------
let aimTimer = 0;
function autoAimStep(dt) {
  aimTimer += dt;
  if (aimTimer > 6) {
    aimTimer = 0;
    if (rng() < 0.3) {
      S.targetPower = 0.25 + rng() * 0.7; // 探索
    } else {
      let best = 0, bestV = -1;
      S.aimBins.forEach((b, i) => {
        const v = (b.heso + 1) / (b.shots + 10);
        if (v > bestV) { bestV = v; best = i; }
      });
      S.targetPower = 0.25 + best * 0.1 + (rng() - 0.5) * 0.04;
    }
  }
  S.power += (S.targetPower - S.power) * Math.min(1, dt * 2.4);
  S.power = Math.max(0.1, Math.min(1, S.power));
}

// ---------- メインループ ----------
let lastT = 0, acc = 0;
const FIXED = 1 / 120;
function frame(t) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  // ヒットストップ/スローモーション
  if (S.tsTimer > 0) {
    S.tsTimer -= raw;
    if (S.tsTimer <= 0) S.timeScale = 1;
  }
  if (S.muteT > 0) S.muteT -= raw; // 復活演出の無音タメ(実時間で解除)
  let dt = raw * S.speed * S.timeScale;
  audioTick();
  if (S.phase === 'play') {
    S.time += dt;
    if (S.autoAim) autoAimStep(dt);
    S.fireCd -= dt;
    // 面開始カード表示中(introLock)と大当り演出中(celebrate)は新規発射を止める(見えない裏で玉/発射数が減るのを防ぐ)
    if (S.fireCd <= 0 && !S.introLock && !S.celebrate && (S.shotsLeft > 0 || S.rush) && S.balls > 0) {
      if (fireBall(S.power)) {
        const quick = (BALLS[S.lastFiredType] || BALLS.shiro).fx.quickNext;
        S.fireCd = quick ? 0.08 : CFG.fireInterval * mods().fireFast * (S.fever ? 0.45 : 1);
      }
    }
    // 玉シャワー(スター3揃い)の消化 — ゲーム内時間駆動
    if (S.shower > 0) {
      S.showerCd -= dt;
      if (S.showerCd <= 0) {
        // x上限340: 右打ち時の返し斜面(x382〜)のポケットに挟まらないように
        fireBall(0, { free: true, type: rng() < 0.3 ? 'hoshi' : 'shiro', x: 40 + rng() * 340, y: 20, vx: (rng() - 0.5) * 80, vy: 40 });
        S.shower--; S.showerCd = 0.09;
      }
    }
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n++ < 30) { physStep(FIXED); acc -= FIXED; }
    spinStep(dt);
    rushStep(dt);
    trySettle();
    spawnAmbient(dt);
  } else {
    S.time += dt;
    spawnAmbient(dt);
  }
  PARA.x += (PARA.tx - PARA.x) * Math.min(1, dt * 4); // 視差スムージング
  PARA.y += (PARA.ty - PARA.y) * Math.min(1, dt * 4);
  S.beatT = Math.max(0, (S.beatT || 0) - dt * 3.5);   // BGMビート減衰
  if (!S.simMode) updateSwimmers(dt);                 // 液晶の生き物
  draw(dt);
  if (GLP) GLP.present(S.time, S.fxMax, (S.fever || S.celebrate) ? 1 : 0); // WebGL最終合成
}

// ---------- 入力 ----------
cv.addEventListener('mousemove', e => {
  if (S.autoAim || S.phase !== 'play') return;
  const r = cv.getBoundingClientRect();
  S.power = S.targetPower = Math.max(0.1, Math.min(1, 1.15 - ((e.clientY - r.top) / r.height) * 1.25));
});
// スマホ: 盤面を縦になぞってハンドル調整
cv.addEventListener('touchmove', e => {
  if (S.autoAim || S.phase !== 'play') return;
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const y = (e.touches[0].clientY - r.top) / r.height;
  S.power = S.targetPower = Math.max(0.1, Math.min(1, 1.15 - y * 1.25));
}, { passive: false });
document.addEventListener('touchstart', () => ensureAudio(), { once: true }); // iOSの音声解錠
function setAutoAim(v) {
  S.autoAim = v;
  const b = document.getElementById('aimBtn');
  b.classList.toggle('on', v);
  b.textContent = v ? 'おまかせ照準' : '手動照準';
  leverDraw();
}
document.getElementById('aimBtn').onclick = () => setAutoAim(!S.autoAim);
// ---------- スマホ右下のハンドルレバー(回すと発射のつよさを調整) ----------
const leverEl = document.getElementById('lever');
function leverDraw() {
  if (!leverEl) return;
  const p = Math.max(0, Math.min(1, (S.power - 0.1) / 0.9));
  leverEl.style.setProperty('--ang', (-135 + p * 270) + 'deg');
  leverEl.style.setProperty('--pct', (p * 75) + '%'); // 270度=円の75%
  const v = leverEl.querySelector('.lvVal');
  if (v) v.textContent = S.autoAim ? 'AUTO' : Math.round(p * 100);
  leverEl.classList.toggle('auto', !!S.autoAim);
}
if (leverEl) {
  let lvDrag = false;
  const onLv = e => {
    const r = leverEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let a = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI; // 上=0°, 時計回り+
    a = Math.max(-135, Math.min(135, a));
    const p = 0.1 + ((a + 135) / 270) * 0.9;
    S.power = S.targetPower = p;
    leverDraw();
    updateHUD();
  };
  leverEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureAudio();
    lvDrag = true;
    try { leverEl.setPointerCapture(e.pointerId); } catch (er) {}
    if (S.autoAim) setAutoAim(false); // レバーを握ったら手動照準へ
    onLv(e);
  });
  leverEl.addEventListener('pointermove', e => { if (lvDrag) onLv(e); });
  leverEl.addEventListener('pointerup', () => { lvDrag = false; });
  leverEl.addEventListener('pointercancel', () => { lvDrag = false; });
  leverEl.addEventListener('dblclick', () => setAutoAim(true)); // ダブルタップでおまかせに戻す
  leverDraw();
}
document.getElementById('speedBtn').onclick = function () {
  S.speed = S.speed === 1 ? 2 : 1;
  this.classList.toggle('on', S.speed === 2);
  this.textContent = `倍速 ×${S.speed}`;
};
document.getElementById('zoomBtn').onclick = function () {
  S.reelZoom = !S.reelZoom;
  this.classList.toggle('on', S.reelZoom);
  this.textContent = S.reelZoom ? '🔍拡大中' : '🔍液晶拡大';
};
document.getElementById('cardBtn').onclick = function () {
  S.reelCards = S.reelCards === false; // OFF→ON / ON→OFF
  this.classList.toggle('on', S.reelCards !== false);
  this.textContent = S.reelCards !== false ? 'カード背景' : '背景なし';
};
document.getElementById('sndBtn').onclick = function () {
  S.sndOn = !S.sndOn;
  this.classList.toggle('on', S.sndOn);
  this.textContent = S.sndOn ? '音 ON' : '音 OFF';   // 状態を色だけでなく文言でも示す
  this.setAttribute('aria-pressed', String(S.sndOn));
};
document.getElementById('fxBtn').onclick = function () {
  S.fxMax = !S.fxMax;
  this.classList.toggle('on', S.fxMax);
  this.textContent = S.fxMax ? '演出MAX' : '演出 控えめ';
};
// OSで「視覚効果を減らす」が有効なら、初期状態を「演出 控えめ」にして光過敏/前庭障害に配慮
(function () {
  if (reduceMotion()) {
    S.fxMax = false;
    const b = document.getElementById('fxBtn');
    if (b) { b.classList.remove('on'); b.textContent = '演出 控えめ'; }
  }
})();
document.getElementById('hitBtn').onclick = function () {
  S.rightHit = !S.rightHit;
  this.classList.toggle('on', S.rightHit);
  this.textContent = S.rightHit ? '右打ち' : '左打ち';
  // 打ち分けで弾道が変わるので、おまかせ照準の学習をやり直す
  S.aimBins = Array.from({ length: 8 }, () => ({ shots: 0, heso: 0 }));
  addLog(S.rightHit ? '👉 右打ちに切替（役物の右側を狙え）' : '👈 左打ちに切替');
};
// ---------- スマホ: 装備シート(下スライド)の開閉 ----------
{
  const sheet = document.getElementById('sheetCards');
  const backdrop = document.getElementById('sheetBackdrop');
  const toggle = document.getElementById('sheetToggle');
  function setSheet(open) {
    sheet.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
  }
  toggle.addEventListener('click', () => setSheet(!sheet.classList.contains('open')));
  backdrop.addEventListener('click', () => setSheet(false));
  // 大当たり演出やオーバーレイ表示中はシートを畳んで視界を確保
  const closeOnOverlay = new MutationObserver(() => {
    if (document.querySelector('.overlay.show')) setSheet(false);
  });
  document.querySelectorAll('.overlay').forEach(el =>
    closeOnOverlay.observe(el, { attributes: true, attributeFilter: ['class'] }));
}
// ---------- スマホ: 上下固定バーの実測高さをCSS変数へ反映 ----------
{
  const root = document.documentElement;
  const topBar = document.getElementById('topBar');
  const bottomBar = document.getElementById('bottomBar');
  const applySize = () => {
    if (window.innerWidth > 940) return; // デスクトップでは無関係
    root.style.setProperty('--mtop-h', topBar.offsetHeight + 'px');
    root.style.setProperty('--mbottom-h', bottomBar.offsetHeight + 'px');
  };
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(applySize);
    ro.observe(topBar); ro.observe(bottomBar);
  }
  window.addEventListener('resize', applySize);
  window.addEventListener('orientationchange', () => setTimeout(applySize, 60));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(applySize);
  setTimeout(applySize, 0);
  setTimeout(applySize, 300); // フォント/レイアウト確定後の保険
}
// ---------- 発射つよさ ◀▶ ----------
{
  const bar = document.getElementById('pwBar');
  for (let i = 0; i < 12; i++) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    bar.appendChild(seg);
  }
  function adjustPower(d) {
    if (S.autoAim) { // 手動に切替
      S.autoAim = false;
      const b = document.getElementById('aimBtn');
      b.classList.remove('on');
      b.textContent = '手動照準(◀▶)';
    }
    S.power = S.targetPower = Math.max(0.1, Math.min(1, S.power + d));
    updateHUD();
  }
  let rep = null;
  function bindHold(el, d) {
    const start = e => {
      e.preventDefault();
      ensureAudio();
      adjustPower(d);
      clearInterval(rep);
      rep = setInterval(() => adjustPower(d), 110);
    };
    const stop = () => clearInterval(rep);
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
  }
  bindHold(document.getElementById('pwDown'), -0.05);
  bindHold(document.getElementById('pwUp'), +0.05);
  window.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft') adjustPower(-0.05);
    if (e.code === 'ArrowRight') adjustPower(+0.05);
  });
}
// ---------- スタートメニュー / 図鑑(スルメ収集要素) ----------
const DEX_TABS = [
  { key: 'sym', label: '絵柄', all: () => Object.keys(SYMBOLS) },
  { key: 'ball', label: '玉', all: () => Object.keys(BALLS) },
  { key: 'relic', label: 'お守り', all: () => RELICS.map(r => r.id) },
  { key: 'part', label: '役物', all: () => Object.keys(PARTS) },
  { key: 'recipe', label: '特殊役', all: () => RECIPES.map(r => r.name) },
  { key: 'syn', label: 'シナジー', all: () => SYNERGIES.map(s => s.id) },
];
let dexTab = 'sym';
function dexDiscovered(key, id) {
  if (key === 'ball' && id === 'shiro') return true; // 白玉は最初から所持
  return dexHas(key, id);
}
function dexTabCount(key) {
  const t = DEX_TABS.find(t => t.key === key);
  const ids = t.all();
  return { got: ids.filter(id => dexDiscovered(key, id)).length, total: ids.length };
}
function dexTotals() {
  let got = 0, total = 0;
  for (const t of DEX_TABS) { const c = dexTabCount(t.key); got += c.got; total += c.total; }
  return { got, total };
}
function dexCardHTML(key, id) {
  const seen = dexDiscovered(key, id);
  let rar = 'normal', icon = '？', name = '？？？', desc = '未発見';
  if (key === 'sym') {
    const s = SYMBOLS[id]; rar = s.rarity;
    icon = seen ? `<img class="dg" src="assets/sym_${id}_art.webp" alt="">` : '<span class="dg">？</span>';
    if (seen) { name = s.name; desc = s.desc.split(' / ')[0].replace('3揃い: ', ''); }
    else if (!symbolUnlocked(id)) { name = '🔒 未解禁'; desc = SYMBOL_UNLOCKS[id] && SYMBOL_UNLOCKS[id].stages != null ? `${SYMBOL_UNLOCKS[id].stages}面クリアで解禁` : '周回クリアで解禁'; }
  } else if (key === 'ball') {
    const b = BALLS[id]; rar = b.rarity;
    icon = seen ? `<span class="dg" style="width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,${b.color})"></span>` : '<span class="dg">？</span>';
    if (seen) { name = b.name; desc = b.desc; }
  } else if (key === 'relic') {
    const r = RELICS.find(x => x.id === id); rar = r.rarity;
    icon = seen ? `<span class="dg">${r.icon}</span>` : '<span class="dg">？</span>';
    if (seen) { name = r.name; desc = r.desc; }
  } else if (key === 'part') {
    const p = PARTS[id]; rar = p.rarity;
    icon = seen ? `<span class="dg">${p.icon}</span>` : '<span class="dg">？</span>';
    if (seen) { name = p.name; desc = p.desc; }
  } else if (key === 'recipe') {
    const rc = RECIPES.find(r => r.name === id); rar = 'rare';
    icon = seen ? `<span class="dg">${recipeGlyphs(rc)}</span>` : '<span class="dg">？</span>';
    if (seen) { name = rc.name; desc = rc.desc; }
  } else if (key === 'syn') {
    const sy = SYNERGIES.find(s => s.id === id); rar = 'legend';
    icon = seen ? '<span class="dg">🔗</span>' : '<span class="dg">？</span>';
    if (seen) { name = sy.name; desc = sy.desc; }
  }
  return `<div class="dexCard ${rar} ${seen ? '' : 'locked'}">${icon}<div class="dn">${name}</div><div class="dd">${desc}</div></div>`;
}
function renderDex() {
  const tot = dexTotals();
  document.getElementById('dexSummary').innerHTML =
    `発見 <b style="color:var(--accent)">${tot.got}</b> / ${tot.total} 種（${Math.round(tot.got / tot.total * 100)}%）　集めて図鑑をコンプせよ`;
  document.getElementById('dexTabs').innerHTML = DEX_TABS.map(t => {
    const c = dexTabCount(t.key);
    return `<button class="dexTab ${t.key === dexTab ? 'on' : ''}" data-tab="${t.key}">${t.label} ${c.got}/${c.total}</button>`;
  }).join('');
  document.querySelectorAll('#dexTabs .dexTab').forEach(b => b.onclick = () => { dexTab = b.dataset.tab; renderDex(); });
  const t = DEX_TABS.find(t => t.key === dexTab);
  document.getElementById('dexGrid').innerHTML = t.all().map(id => dexCardHTML(dexTab, id)).join('');
}
function openDex() { renderDex(); document.getElementById('dexOverlay').classList.add('show'); }

// ---------- 役ガイド(カテゴリ制の役一覧・いつでも開ける) ----------
const GUIDE_FAMS = [
  { key: 'カテゴリ役', icon: '🎯' },
  { key: '覚醒役', icon: '🌟' },
  { key: '大当り役', icon: '💥' },
];
const TIER_CLS = { 'ゴミ': 'gomi', '中': 'chu', '爆発': 'bang', '倍率': 'mult' };
const TIER_LABEL = { 'ゴミ': 'ゴミ級', '中': '中級', '爆発': '爆発級', '倍率': '倍率操作' };
let guideTab = 'all';
function guideRowHTML(rc) {
  const cls = TIER_CLS[rc.tier] || 'chu';
  const inRun = S.phase && S.phase !== 'title' && poolTotal() > 0;
  const ready = inRun && recipeReady(rc);
  const eff = rc.desc.includes('→') ? rc.desc.split('→').pop().trim() : rc.desc;
  const yt = roleYieldText(rc);
  const goldY = (yt.startsWith('約') || yt.endsWith('のランダム')) ? ` <span class="gyield">${yt}</span>` : '';
  return `<div class="gRow ${ready ? 'ready' : ''}"><div class="gtx">` +
    `<div class="gnm">${rc.name}${ready ? '<span class="rd">狙える</span>' : ''}<span class="gt tier-${cls}">${TIER_LABEL[rc.tier] || rc.tier || ''}</span></div>` +
    `<div class="gpat">${recipePatternHTML(rc)} <span class="garrow">→</span> ${eff}${goldY}</div>` +
    `</div></div>`;
}
function renderGuide() {
  document.getElementById('guideLegend').innerHTML =
    ['ゴミ', '中', '爆発', '倍率'].map(t => `<span class="lg tier-${TIER_CLS[t]}">${TIER_LABEL[t]}</span>`).join('') +
    `<span class="lg" style="background:#1c2620;color:var(--accent)">🔗 シナジー ${SYNERGIES.length}</span>`;
  const tabs = [{ key: 'all', label: `全${RECIPES.length}` }].concat(GUIDE_FAMS.map(f => ({ key: f.key, label: f.icon })));
  document.getElementById('guideTabs').innerHTML = tabs.map(t =>
    `<button class="dexTab ${t.key === guideTab ? 'on' : ''}" data-g="${t.key}">${t.label}</button>`).join('');
  document.querySelectorAll('#guideTabs .dexTab').forEach(b => b.onclick = () => { guideTab = b.dataset.g; renderGuide(); });
  const fams = guideTab === 'all' ? GUIDE_FAMS : GUIDE_FAMS.filter(f => f.key === guideTab);
  let html = '';
  for (const f of fams) {
    const rs = RECIPES.filter(r => r.family === f.key);
    if (!rs.length) continue;
    html += `<div class="gFam"><div class="gFamH">${f.icon} ${f.key}<span class="n">${rs.length}役</span></div>` +
      rs.map(guideRowHTML).join('') + '</div>';
  }
  if (guideTab === 'all') {
    html += `<div class="gFam"><div class="gFamH">🔗 シナジー<span class="n">所持で全獲得に相乗倍率</span></div>` +
      SYNERGIES.map(sy => `<div class="gRow"><div class="gg">🔗</div><div class="gtx"><div class="gnm">${sy.name}</div><div class="gds">${sy.desc}</div></div><div class="gt tier-mult">×${sy.mult}</div></div>`).join('') + '</div>';
  }
  document.getElementById('guideBody').innerHTML = html;
}
function openGuide() { renderGuide(); document.getElementById('guideOverlay').classList.add('show'); }

// ---------- チュートリアル(初回自動＋あとで再表示。役の理解を助ける) ----------
const TUT_PAGES = [
  { ico: "⏱️", h: "30秒でわかる遊び方", html: "玉はこのゲームのお金。増やして、面の終わりに<b>家賃(ノルマ)を玉で支払います</b>。払えたら次の面へ、足りないと閉店(ゲームオーバー)。全10面。撃つのは全部おまかせで、あなたは<b>「何を集めるか」選ぶだけ</b>。", flow: [["撃つ", "玉は全自動で飛んでいく"], ["入る", "真ん中の穴「ヘソ」に入るとスロットが回る"], ["揃う", "絵柄が揃うと当たり。玉がドッと増える"], ["払う", "面の終わりに家賃(ノルマ)を納めて次へ"]] },
  { ico: "🎰", h: "当たりの正体は「役」", html: "スロットの3つの窓に、決まった組み合わせの絵柄が出ると当たり。これを<b>「役」</b>と呼びます。ぴったり同じ絵柄じゃなくてOK。<b>同じ系統(仲間)を3つ</b>集めれば役になります。系統は果物🍒 植物🍀 動物🐾 天体🌙 財宝💎 博打🎲 祭🎆 仕掛🔧の8つ。", ex: ["🍒🍇🍉", "バラバラでも全部果物の仲間。これで当たり!"] },
  { ico: "🛒", h: "集める物は4種類", html: "面をクリアするたび、ご褒美を<b>1つ無料</b>で持ち帰れます。屋台では玉を使った買い物も。選べるのはこの4種類。", flow: [["絵柄", "スロットに追加。同じ絵柄を増やすほど揃いやすい"], ["特殊な玉", "撃つ玉そのものが強くなる"], ["お守り", "持っているだけでずっと効く応援"], ["役物", "盤面に置く装置。台そのものを改造できる"]] },
  { ico: "💥", h: "覚醒役はカテゴリごとに個性が違う", html: "系統の絵柄を2つ＋その系統の<b>主レジェンド</b>を揃えると「覚醒役」が発動。中身はカテゴリごとに全然違う特殊能力です。天体は<b>納品が軽くなる</b>、財宝は<b>その場で大金</b>、博打は<b>大振れの一撃</b>、仕掛は<b>役物が無料設置</b>、祭は<b>連チャンで倍率が伸びる</b>…など。倍率が上がった分、当たりでもらえる玉が全部この倍になります(<b>×2なら100玉が200玉</b>)。相性のいい組み合わせ・玉と絵柄の色合わせ・FEVERも掛け算で重なるので、育てたビルドの個性がハマると一気に爆発します。", ex: ["🔔🔔🎆", "祭2つ＋主のレジェンド(尺玉)＝連チャンで倍率が伸びる「宴覚醒」"] },
  { ico: "🏮", h: "さあ、開店", html: "分からない言葉が出たら、画面の表示(運・倍率・玉デッキなど)を<b>そのままタップ</b>。説明がすぐ開きます。役の一覧は役ガイド、言葉の意味は用語集に。<br>まずは同じ系統を3つ。それだけで玉は増え始めます。増やして、家賃を払って、爆発させろ。", last: true },
];
let tutIdx = 0;
function renderTut() {
  const p = TUT_PAGES[tutIdx];
  let body = `<div class="tico">${p.ico}</div><h2>${p.h}</h2><p>${p.html}</p>`;
  if (p.ex) body += `<div class="ex"><span style="font-size:20px">${p.ex[0]}</span><b>→ ${p.ex[1]}</b></div>`;
  if (p.flow) body += `<div class="flow4">${p.flow.map(f => `<div class="f"><b>${f[0]}</b>　${f[1]}</div>`).join('')}</div>`;
  document.getElementById('tutPage').innerHTML = body;
  document.getElementById('tutDots').innerHTML = TUT_PAGES.map((_, i) => `<span class="dot ${i === tutIdx ? 'on' : ''}"></span>`).join('');
  document.getElementById('tutNext').textContent = p.last ? '役ガイドを見る' : '次へ ▶';
  document.getElementById('tutSkip').textContent = p.last ? 'とじる' : 'スキップ';
}
function openTut() { tutIdx = 0; renderTut(); document.getElementById('tutOverlay').classList.add('show'); }
function closeTut() { document.getElementById('tutOverlay').classList.remove('show'); try { localStorage.setItem('luckyPachiTutSeen', '1'); } catch (e) {} }
function maybeFirstTut() {
  let seen = false; try { seen = localStorage.getItem('luckyPachiTutSeen') === '1'; } catch (e) {}
  if (!seen) openTut();
}

// ---------- 用語集(ゲームの言葉を全部定義。HUDの語をタップでも開く) ----------
const GLOSSARY = [
  { g: '基本ルール', terms: [
    { id: 'tama', t: '玉（たま）', d: '一言でいうと、このゲームのお金。撃って増やして、面の終わりのノルマ(家賃)を払うのに使う。' },
    { id: 'mochidama', t: '持ち玉', d: '一言でいうと、いまの所持金。手元にある玉の数。面の終わりにノルマより多ければ生き残れる。' },
    { id: 'hassha', t: '発射（はっしゃ）', d: '一言でいうと、玉を撃つこと。全部自動で、あなたの操作はいらない。1つの面で撃てる数には上限がある。' },
    { id: 'heso', t: 'ヘソ', d: '一言でいうと、盤面ど真ん中の穴。玉が入るとスロットが回る。すべての当たりの入り口。' },
    { id: 'norma', t: '納品ノルマ', d: '一言でいうと、面ごとの家賃。面の終わりに玉で支払う。払えたら次の面へ、足りないとゲームオーバー。' },
    { id: 'men', t: '面（めん）', d: '一言でいうと、ステージのこと。全部で10面。面ごとに撃てる玉の数とノルマが決まっている。' },
  ] },
  { g: 'ステータス（右上の3つ）', terms: [
    { id: 'un', t: '運（うん）', d: '一言でいうと、絵柄の揃いやすさ。クローバー🍀などで上がる。高いほど当たりが出やすくなる。' },
    { id: 'bairitsu', t: '倍率（ばいりつ）', d: '一言でいうと、当たりの玉が何倍になるかの数字。×2なら100玉の当たりが200玉。天体絵柄(🌙)で上がる。「宴覚醒」は連チャン中だけ一時的に上がる(途切れると0に戻る)。覚醒役は系統ごとに効果が違う。' },
    { id: 'total', t: '合計倍率（今、何倍か）', d: '一言でいうと、いまの倍率ぜんぶの掛け算。倍率×相乗×FEVER×役倍率をまとめた数字で、画面右上にいつも出ている。' },
    { id: 'soujou', t: '相乗（そうじょう）', d: '一言でいうと、相性ボーナスの倍率。相性のいい持ち物の組み合わせ(シナジー)が成立すると上がる。' },
    { id: 'yakubairitsu', t: '役倍率（やくばいりつ）', d: '一言でいうと、一時的なブースト。金龍昇天(🐉×2)の「次の当たり×4」のように、次の当たりを丸ごと何倍にもする。' },
    { id: 'hesoshou', t: 'ヘソ賞球', d: '一言でいうと、ヘソのお駄賃。ヘソに玉が入るたび、揃わなくても必ずもらえる基本の玉。' },
  ] },
  { g: 'ビルドの4本柱（集めて強くする）', terms: [
    { id: 'deck', t: '玉デッキ', d: '一言でいうと、撃つ玉のラインナップ。ここに特殊な玉を加えると、その玉が順番に発射されていく。' },
    { id: 'reel', t: 'リール構成', d: '一言でいうと、スロットの中身。どの絵柄が何枚入っているか。同じ絵柄を増やすほど揃いやすい。' },
    { id: 'yakumono', t: '役物（やくもの）', d: '一言でいうと、盤面に置く装置。台そのものを改造して、玉の流れや稼ぎを良くする。' },
    { id: 'omamori', t: 'お守り', d: '一言でいうと、持っているだけでずっと効く応援。一度手に入れれば、以後は自動で働き続けてくれる。' },
  ] },
  { g: '当たりの仕組み', terms: [
    { id: 'sanzoroi', t: '3揃い（さんぞろい）', d: '一言でいうと、同じ絵柄が3つ並ぶこと。いちばん基本の当たりで、その絵柄の効果が発動して玉がもらえる。' },
    { id: 'yaku', t: '役（やく）', d: '一言でいうと、当たりの種類。決まった絵柄の組み合わせが揃うと成立する。狙える役はカードや役ガイドで見られる。' },
    { id: 'category', t: 'カテゴリ', d: '一言でいうと、絵柄の系統。果物🍒 植物🍀 動物🐾 天体🌙 財宝💎 博打🎲 祭🎆 仕掛🔧の8つ。同じ系統3つで役になる。' },
    { id: 'synergy', t: 'シナジー', d: '一言でいうと、持ち物どうしの相性。相性のいい組み合わせを揃えると「相乗」の倍率が上がる。' },
    { id: 'rush', t: 'RUSH（ラッシュ）', d: '一言でいうと、連チャン。当たりが立て続けに出るボーナスタイム。大当り役などで突入する。' },
    { id: 'fever', t: 'FEVER（フィーバー）', d: '一言でいうと、お祭りタイム。盤面のチューリップ🌷に玉が20回入ると発動し、しばらく獲得2倍+高速連射になる。' },
    { id: 'colorSyn', t: '色共鳴（いろきょうめい）', d: '一言でいうと、色合わせボーナス。撃った玉の色と、揃った絵柄の系統色が同じだと、もらえる玉が増える。' },
  ] },
];
function renderGlossary() {
  const box = document.getElementById('glossaryBody');
  if (!box) return;
  box.innerHTML = GLOSSARY.map(sec =>
    `<div class="glSec"><div class="glSecH">${sec.g}</div>` +
    sec.terms.map(t => `<div class="glItem" id="gl-${t.id}"><div class="glT">${t.t}</div><div class="glD">${t.d}</div></div>`).join('') +
    `</div>`).join('');
}
function openGlossary(anchor) {
  renderGlossary();
  document.getElementById('glossaryOverlay').classList.add('show');
  if (anchor) {
    const el = document.getElementById('gl-' + anchor);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); }
  } else {
    const b = document.getElementById('glossaryBody'); if (b) b.scrollTop = 0;
  }
}
// リール構成チップをタップ → その絵柄の「狙える役」フル説明を出す
function openSymDetail(id) {
  const s = SYMBOLS[id];
  if (!s) return;
  const n = S.symbolPool[id] || 0;
  document.getElementById('sdGlyph').textContent = s.glyph;
  document.getElementById('sdName').innerHTML = `${s.name}<span class="sdCnt">リールに ×${n}</span>`;
  document.getElementById('sdDesc').textContent = s.desc;
  const roles = symbolRoleTagsHTML(id);
  document.getElementById('sdBody').innerHTML = roles ||
    '<div class="sdNone">この絵柄が絡む特殊役はまだ無い。同じ絵柄を重ねて3揃いを狙おう。</div>';
  const b = document.getElementById('sdBody'); if (b) b.scrollTop = 0;
  document.getElementById('symDetailOverlay').classList.add('show');
}
function closeSymDetail() { document.getElementById('symDetailOverlay').classList.remove('show'); }
function updateDiffBtn() {
  const b = document.getElementById('diffBtn');
  const d = curDiff();
  b.textContent = `難易度: ${d.label}`;
  b.style.color = d.color;
  b.style.borderColor = 'color-mix(in srgb, ' + d.color + ' 45%, var(--line))';
  b.title = d.note;
}
function refreshMenu() {
  const cb = document.getElementById('continueBtn');
  cb.style.display = hasSave() ? 'block' : 'none';
  updateDiffBtn();
  const tot = dexTotals();
  const parts = [];
  if (META.loops > 0) parts.push(`🏆 最高 ${META.loops}周`);
  const lockedN = Object.keys(SYMBOL_UNLOCKS).filter(id => !symbolUnlocked(id)).length;
  parts.push(`絵柄解禁 ${Object.keys(SYMBOLS).length - lockedN}/${Object.keys(SYMBOLS).length}`);
  parts.push(`図鑑 ${tot.got}/${tot.total}`);
  if (META.games) parts.push(`プレイ ${META.games}回`);
  document.getElementById('titleStats').textContent = parts.join('　／　');
}
// ---------- フリーモード: テーマ(面)選択 ----------
function renderFreeGrid() {
  const grid = document.getElementById('freeGrid');
  grid.innerHTML = THEMES.map((t, i) => {
    const seen = i < 1 || META.stages >= i * 3 || META.loops > 0; // 参考: 到達目安。フリーは全部選べる
    return `<button class="freeCard" data-t="${i + 1}" style="border-color:color-mix(in srgb, ${t.accent} 40%, var(--line))">
      <span class="fbar" style="background:${t.accent}"></span>
      <span class="fnum" style="color:${t.accent}">${t.num}</span>
      <span class="fname">${t.name}</span></button>`;
  }).join('');
  grid.querySelectorAll('.freeCard').forEach(b => b.onclick = () => { ensureAudio(); resetGame({ free: true, theme: +b.dataset.t }); });
}
function openFree() { renderFreeGrid(); document.getElementById('freeOverlay').classList.add('show'); }
document.getElementById('continueBtn').onclick = () => { ensureAudio(); continueRun(); };
// 設定: 難易度/フリーモード/遊び方/用語集/役ガイド/図鑑 をここに集約(タイトルは最小化)
function closeSettings() { document.getElementById('settingsOverlay').classList.remove('show'); }
document.getElementById('settingsBtn').onclick = () => { sfx('tick'); document.getElementById('settingsOverlay').classList.add('show'); };
document.getElementById('settingsClose').onclick = () => closeSettings();
document.getElementById('dexBtn').onclick = () => { closeSettings(); openDex(); };
document.getElementById('dexClose').onclick = () => document.getElementById('dexOverlay').classList.remove('show');
document.getElementById('diffBtn').onclick = () => { setDiff(diffIdx + 1); updateDiffBtn(); sfx('tick'); };
document.getElementById('freeBtn').onclick = () => { closeSettings(); openFree(); };
document.getElementById('freeClose').onclick = () => document.getElementById('freeOverlay').classList.remove('show');
document.getElementById('homeBtn').onclick = () => { // フリーモードからメニューへ戻る
  S.free = false; S.phase = 'title';
  document.getElementById('homeBtn').style.display = 'none';
  document.getElementById('titleOverlay').classList.add('show');
  refreshMenu();
};

document.getElementById('startBtn').onclick = () => { ensureAudio(); resetGame(); maybeFirstTut(); };
document.getElementById('retryBtn').onclick = () => resetGame(); // 同じ周回で再挑戦
document.getElementById('gameoverHomeBtn').onclick = () => { // 廃業→タイトルへ
  document.getElementById('gameoverOverlay').classList.remove('show');
  S.free = false; S.phase = 'title';
  document.getElementById('homeBtn').style.display = 'none';
  document.getElementById('titleOverlay').classList.add('show');
  refreshMenu();
};
// 役ガイド＆チュートリアルの開閉
document.getElementById('guideBtn').onclick = () => { closeSettings(); openGuide(); };
document.getElementById('guideBtnBar').onclick = () => openGuide();
document.getElementById('guideClose').onclick = () => document.getElementById('guideOverlay').classList.remove('show');
document.getElementById('glossaryBtn').onclick = () => { closeSettings(); openGlossary(); };
document.getElementById('glossaryClose').onclick = () => document.getElementById('glossaryOverlay').classList.remove('show');
// HUDの用語・パネル見出しをタップ → その語の説明を用語集で開く
document.querySelectorAll('[data-gl]').forEach(el => el.addEventListener('click', () => openGlossary(el.dataset.gl)));
// リール構成チップ(sym)をタップ → 狙える役のフル説明ポップアップ。チップは動的に描き直すので委譲で拾う
document.addEventListener('click', e => {
  const symChip = e.target.closest('.chip.sym[data-sym]');
  if (symChip) { e.stopPropagation(); openSymDetail(symChip.dataset.sym); return; }
  // それ以外のチップ(玉/お守り/役物/シナジー)はhoverが効かないタッチでも、タップでtipを開閉できるようにする
  const chip = e.target.closest('.chip');
  const openedTip = chip && chip.querySelector('.tip');
  document.querySelectorAll('.chip.tipopen').forEach(c => { if (c !== chip) c.classList.remove('tipopen'); });
  if (openedTip) { e.stopPropagation(); chip.classList.toggle('tipopen'); }
});
document.getElementById('sdClose').onclick = () => closeSymDetail();
document.getElementById('symDetailOverlay').addEventListener('click', () => closeSymDetail()); // 情報ポップアップ=どこをタップしても閉じる(閉じられず詰まるのを防ぐ)
// 神社: 説明の「お参りする」で開始 → 以降は画面連打で寄進
(function () {
  const ov = document.getElementById('shrineOverlay');
  if (ov) ov.addEventListener('pointerdown', e => {
    if (!shrineCtx || !shrineCtx.active) return; // 説明中はボタン操作を優先
    e.preventDefault(); shrineTap(e.clientX, e.clientY);
  });
  const sb = document.getElementById('shrineStartBtn');
  if (sb) sb.onclick = () => startShrineTapping();
})();
document.getElementById('tutBtn').onclick = () => { closeSettings(); openTut(); };
document.getElementById('tutSkip').onclick = () => closeTut();
document.getElementById('tutNext').onclick = () => {
  if (TUT_PAGES[tutIdx].last) { closeTut(); openGuide(); }
  else { tutIdx++; renderTut(); }
};
document.getElementById('nextLoopBtn').onclick = () => { S.loop++; resetGame(); };
document.getElementById('clearRetryBtn').onclick = () => { S.loop = 0; resetGame(); };
document.getElementById('draftSkip').onclick = () => closeDraft();
document.getElementById('shopNext').onclick = () => closeShop();
document.getElementById('shopInvToggle').onclick = () => {
  document.getElementById('shopInv').classList.toggle('collapsed');
  sfx('tick');
};
document.getElementById('draftInvToggle').onclick = () => {
  document.getElementById('draftInv').classList.toggle('collapsed');
  sfx('tick');
};
document.getElementById('plCancel').onclick = () => cancelPlacement();
{ // モバイル: 下部バーは普段ハンドルだけ(盤面フルスクリーン)。タップで操作パネル展開
  const bh = document.getElementById('barHandle');
  const bb = document.getElementById('bottomBar');
  if (bh && bb) {
    if (window.innerWidth <= 940) bb.classList.add('collapsed');
    bh.onclick = () => {
      const c = bb.classList.toggle('collapsed');
      bh.textContent = c ? '操作 ▲' : 'とじる ▼';
      sfx('tick');
    };
  }
}
window.addEventListener('resize', () => { if (S.placing) layoutPlaceSlots(); });
document.getElementById('removeCancel').onclick = () => {
  document.getElementById('removeOverlay').classList.remove('show');
  const cancel = removeCtx && removeCtx.onCancel;
  removeCtx = null;
  if (cancel) cancel();
};

// ---------- 検証ハーネス ----------
window.__game = {
  S, CFG, THEMES, SYMBOLS, BALLS, RELICS,
  feverCount() { return FEVER_COUNT; },
  feverReset() { FEVER_COUNT = 0; },
  mods, hesoHalfW, decideOutcome, poolTotal,
  seed: setSeed,
  reset: resetGame,
  launch(power, opts) { return fireBall(power == null ? S.power : power, opts || {}); },
  step(dt) {
    const steps = Math.max(1, Math.round((dt || FIXED) / FIXED));
    for (let i = 0; i < steps; i++) {
      physStep(FIXED); spinStep(FIXED); rushStep(FIXED); trySettle();
    }
  },
  forceWin(sym) { S.hold.push({ ball: 'shiro' }); const o = { kind: 3, symbol: sym || 'seven' }; const f = facesFor(o); S.spin = { faces: f, out: o, ball: 'shiro', t: 99, stopAt: [0, 0, 0], reach: true, reachPlayed: true }; resolveSpin(); },
  forceRecipe(name) { const rc = RECIPES.find(r => r.name === name) || RECIPES[0]; S.hold.push({ ball: 'shiro' }); const o = { kind: 'recipe', recipe: rc }; const f = facesFor(o); S.spin = { faces: f, out: o, ball: 'shiro', t: 99, stopAt: [0, 0, 0], reach: true, reachPlayed: true }; resolveSpin(); return { name: rc.name, faces: S.lastDigits }; },
  goStage(n) { startStage(n); },
  openDraft, rollRarity, tryStartSpin,
  installPart, installPartAt, PARTS, PART_SLOTS, freeSlots,
  acquire, synDirty, activeSynergies, synergyMult, synergiesGainedBy, synergyGainHTML, RECIPES, SYNERGIES, recipeReady,
  autoBuild(pool) { // テスト/即スタート用: 初期リールを一括設定して第一面へ
    S.symbolPool = pool || { cherry: 3, bell: 3, clover: 2, house: 2, seven: 1 };
    buildStep = BUILD_STEPS.length;
    document.getElementById('buildOverlay').classList.remove('show');
    renderCollections();
    startStage(1);
  },
  renderCollections, updateHUD,
  fx,
  ambientBurst(sec) { const t = sec || 4; for (let i = 0; i < t / 0.016; i++) { S.time += 0.016; spawnAmbient(0.016); } },
  drawFrame() { draw(1 / 60); },
  // 実測: n発を撃って収支を測る(演出スキップ)
  // persist=true: 面またぎ計測用 — 抽選効果(運/倍率/ノルマ減/デッキ/お守り獲得)を残したまま玉収支だけ測る
  simulate(n, power = 0.62, persist = false) {
    const savedCore = { balls: S.balls, shotsLeft: S.shotsLeft, stat: S.stat };
    const savedBuild = persist ? null : JSON.stringify({
      luck: S.luck, mult: S.mult, quota: S.quota, hesoPayPerm: S.hesoPayPerm,
      deck: S.deck, symbolPool: S.symbolPool,
      fever: S.fever, feverGauge: S.feverGauge, // 単発計測はFEVER状態を汚さない(persist時は持ち越す)
    });
    const savedRelics = persist ? null : S.relics.slice();
    // 実行中の実プレイ状態を退避(参照ごと)
    const live = {
      phase: S.phase, hold: S.hold, spin: S.spin, rush: S.rush,
      ballsOnBoard: S.ballsOnBoard, shower: S.shower, showerCd: S.showerCd,
    };
    let res;
    try {
      S.simMode = true; S.phase = 'play';
      S.simRealBase = savedCore.balls - 1e9; // 実残高 = S.balls + simRealBase
      S.balls = 1e9; S.shotsLeft = 1e9;
      S.hold = []; S.spin = null; S.rush = null;
      S.ballsOnBoard = []; S.shower = 0;
      const st0 = { shots: 0, heso: 0, wins: 0, rush: 0, totalWon: 0, paid: 0 };
      S.stat = st0;
      const ballsBefore = S.balls;
      for (let i = 0; i < n; i++) {
        fireBall(power);
        let guard = 0;
        while (S.ballsOnBoard.length > 0 && guard++ < 2400) {
          physStep(FIXED); spinStep(FIXED); rushStep(FIXED);
        }
        let g2 = 0;
        while ((S.hold.length > 0 || S.spin || S.rush) && g2++ < 600) {
          spinStep(FIXED); rushStep(FIXED); tryStartSpin();
        }
        S.ballsOnBoard.length = 0;
      }
      const delta = S.balls - ballsBefore + n;
      res = {
        shots: st0.shots, heso: st0.heso, hesoRate: +(st0.heso / n).toFixed(4),
        wins: st0.wins, rush: st0.rush,
        net: delta - n, netPerShot: +((delta - n) / n).toFixed(3),
        power, luck: +S.luck.toFixed(2), mult: +S.mult.toFixed(2),
        quotaEnd: S.quota,
      };
    } finally {
      S.balls = savedCore.balls; S.shotsLeft = savedCore.shotsLeft; S.stat = savedCore.stat;
      if (savedBuild) {
        Object.assign(S, JSON.parse(savedBuild));
        S.relics = savedRelics;
      }
      S.hold = live.hold; S.spin = live.spin; S.rush = live.rush;
      S.ballsOnBoard = live.ballsOnBoard;
      S.shower = live.shower; S.showerCd = live.showerCd;
      S.bag = [];
      S.simMode = false; S.simRealBase = 0; S.phase = live.phase;
      modsDirty();
    }
    return res;
  },
  // フルラン自動プレイ(10面通し、ドラフト/屋台込み) — バランス計測用
  autoRun(arch = 'balanced', seed = 1, opts = {}) {
    setSeed(seed);
    resetGame();
    if (opts.rightHit != null) S.rightHit = !!opts.rightHit; // 計測用: 左/右打ちを固定
    const starts = {
      coin:     { cherry: 3, suika: 3, grape: 2, lemon: 2, diamond: 1 },
      rush:     { cherry: 3, bell: 3, sakura: 2, house: 2, seven: 1 },
      scale:    { sakura: 3, mitsuba: 3, clover: 2, house: 2, moon: 1 },
      balanced: { cherry: 3, bell: 3, clover: 2, house: 2, seven: 1 },
    };
    // 実プレイと同じ「ランダム3択×5回」で初期リールを組む(プリセット禁止=計測の公平性)
    S.allUnlock = true; // 計測は全解禁前提(メタ進行は汚さない)
    const pfPre = {
      coin: ['cherry', 'suika', 'grape', 'lemon', 'diamond', 'kinbukuro'],
      rush: ['seven', 'bar', 'cherry', 'bell'],
      scale: ['clover', 'sakura', 'mitsuba', 'moon', 'house'],
      balanced: ['cherry', 'bell', 'clover', 'seven', 'diamond'],
    }[arch] || [];
    S.symbolPool = {};
    if (opts.pool0) { // 神引き計測: 初期リールを固定(「最良のビルドを引けたら」の再現)
      S.symbolPool = { ...opts.pool0 };
    } else {
      for (const st of BUILD_STEPS) {
        const pool = Object.keys(SYMBOLS).filter(id => SYMBOLS[id].rarity === st.rarity && !S.symbolPool[id]);
        const opts3 = [];
        const tmp = pool.slice();
        while (opts3.length < 3 && tmp.length) opts3.push(tmp.splice((rng() * tmp.length) | 0, 1)[0]);
        opts3.sort((a, b) =>
          ((pfPre.includes(b) ? 2 : 0) + (SYMBOLS[b].three.t === 'coins' ? 1 : 0)) -
          ((pfPre.includes(a) ? 2 : 0) + (SYMBOLS[a].three.t === 'coins' ? 1 : 0)));
        S.symbolPool[opts3[0]] = (S.symbolPool[opts3[0]] || 0) + st.copies;
      }
    }
    buildStep = BUILD_STEPS.length;
    document.getElementById('buildOverlay').classList.remove('show');
    synDirty();
    renderCollections();
    startStage(1);
    S.allUnlock = true;
    S.loop = opts.loop || 0;
    S.quota = quotaFor(1);
    const RAR_SCORE = { normal: 1, rare: 2.2, legend: 3.5 };
    const prefs = {
      coin:  { syms: ['cherry','suika','grape','lemon','diamond','kinbukuro','ryu','buta','saikoro','fortune'], balls: ['kin','gin','kotei','yamabuki','guren','prism'], relics: ['uraROM','kamiwaza','manekineko','shiori'] },
      rush:  { syms: ['seven','bar','crown'], balls: ['nanahikari','horyudama'], relics: ['renchan','roundplus','tenjo','tamashii','valve','dedama','overkill','shippu','gunte','yuujou'] },
      scale: { syms: ['clover','sakura','mitsuba','moon','taiyo','nijiiro','unicorn'], balls: ['niji','kenja','biidama','hisui','shion'], relics: ['shiori','mangetsu','uraROM','kamiwaza','ema','manekineko','fuseki'] },
      balanced: { syms: [], balls: [], relics: [] },
    };
    // カテゴリ別バランス計測用: 8カテゴリそれぞれに「そのカテゴリ一筋で攻める」AIプリセットを追加(主レジェンドを最優先)
    const CAT_PRIMARY = { fruit: 'banana', plant: 'sekaiju', animal: 'ryu', sky: 'taiyo', treasure: 'crown', luck: 'joker', festival: 'shakudama', tool: 'karakuri' };
    for (const cat in CAT_PRIMARY) {
      prefs[cat] = { syms: Object.keys(SYMBOL_CAT).filter(id => SYMBOL_CAT[id] === cat), balls: [], relics: [], primary: CAT_PRIMARY[cat] };
    }
    const pf = prefs[arch] || prefs.balanced;
    const score = (card) => {
      let sc = RAR_SCORE[card.rarity] || 1;
      if (card.kind === 'symbol') {
        if (pf.syms.includes(card.id)) sc += 2.5;
        if (pf.primary && card.id === pf.primary) sc += 3; // 覚醒の主レジェンドは最優先で確保
        if (S.symbolPool[card.id]) sc += 1 + S.symbolPool[card.id] * 0.6; // 重ね積み(3乗)の価値
      }
      if (card.kind === 'ball' && pf.balls.includes(card.id)) sc += 2;
      if (card.kind === 'part') sc += 1.4; // 役物は常時そこそこ強い
      if (card.kind === 'relic' && pf.relics.includes(card.id)) sc += 2.5;
      if (card.kind === 'relic' && ['dekaheso', 'wazamono', 'amadeji', 'kuginuki', 'kintsuchi'].includes(card.id)) sc += 1.2; // 回転率は常に正義
      return sc;
    };
    const rollCards = (nc, forceLegend) => {
      const seen = new Set(), cards = [];
      for (let i = 0; i < nc; i++) {
        let c = rollDraftCard(0, forceLegend ? 'legend' : undefined), g = 0;
        while (seen.has(c.kind + c.id) && g++ < 15) c = rollDraftCard(0, forceLegend ? 'legend' : undefined);
        seen.add(c.kind + c.id); cards.push(c);
      }
      return cards;
    };
    const stages = [];
    let died = 0;
    for (let st = 1; st <= 10; st++) {
      const m = mods();
      const shots = stageShots(m);
      const r = this.simulate(shots, opts.power || 0.9, true);
      S.balls += r.net;
      if (r.quotaEnd != null) S.quota = r.quotaEnd;
      const bank = S.balls; // 決算時の持ち玉(ノルマ差引き前)
      const rec = { st, net: r.net, wins: r.wins, rush: r.rush, quota: S.quota,
                    bank, margin: bank - S.quota, marginPct: +((bank - S.quota) / S.quota).toFixed(3),
                    pass: bank >= S.quota, after: 0 };
      if (S.balls < S.quota) { died = st; rec.after = S.balls - S.quota; stages.push(rec); break; }
      S.balls -= S.quota;
      if (m.interest) S.balls += Math.round(S.balls * m.interest);
      rec.after = S.balls;
      stages.push(rec);
      if (st === 10) break;
      // 神引き計測: 指定カードでドラフト/購入(価格は正規。買えなければ見送り=経済は誠実)
      const specToCard = (sp) => {
        if (sp.kind === 'symbol') { const s = SYMBOLS[sp.id]; return { kind: 'symbol', rarity: s.rarity, id: sp.id, name: s.name }; }
        if (sp.kind === 'ball') { const b = BALLS[sp.id]; return { kind: 'ball', rarity: b.rarity, id: sp.id, name: b.name }; }
        if (sp.kind === 'relic') { const rel = RELICS.find(r => r.id === sp.id); return { kind: 'relic', rarity: rel.rarity, id: sp.id, name: rel.name, rel }; }
        if (sp.kind === 'part') { const p = PARTS[sp.id]; return { kind: 'part', rarity: p.rarity, id: sp.id, name: p.name }; }
        return null;
      };
      const plan = opts.plan && opts.plan[st];
      const reserve = Math.round(quotaFor(st + 1) * 0.4);
      if (plan) {
        if (plan.draft) { const c = specToCard(plan.draft); if (c) acquire(c); } // ドラフトは無料1枚
        for (const sp of (plan.buys || [])) {
          const c = specToCard(sp); if (!c) continue;
          const price = priceAt(RARITY_PRICE[c.rarity] + (c.kind === 'symbol' ? 40 : 0));
          if (S.balls - price > reserve) { S.balls -= price; acquire(c); }
        }
      } else {
        // ドラフト(無料1枚)。4面・7面クリア後は実プレイと同じく3択が全部レジェンド
        const dc = rollCards(3 + Math.min(2, m.draftExtra), st === 4 || st === 7);
        dc.sort((a, b) => score(b) - score(a));
        acquire(dc[0]);
        // 屋台
        const stock = rollCards(3).map(c => (c.price = priceAt(RARITY_PRICE[c.rarity] + (c.kind === 'symbol' ? 40 : 0)), c));
        stock.sort((a, b) => score(b) - score(a));
        for (const it of stock) {
          if (score(it) >= 2.5 && S.balls - it.price > reserve) { S.balls -= it.price; acquire(it); }
        }
      }
      if (S.deck.filter(d => d === 'shiro').length > 2) {
        const thinP = priceAt(120);
        if (S.balls - thinP > reserve) {
          S.balls -= thinP;
          const i = S.deck.indexOf('shiro');
          if (i >= 0) S.deck.splice(i, 1);
          S.bag = [];
        }
      }
      // 次の面(startStage相当の経済のみ)
      S.stage = st + 1;
      S.theme = THEMES[S.stage - 1];
      S.quota = quotaFor(S.stage);
      S.shotsLeft = 0;
      S.balls += mods().periodBalls;
    }
    return {
      arch, seed, died, cleared: died === 0,
      finalBalls: S.balls, luck: +effLuck().toFixed(1), mult: +effMult().toFixed(2),
      deckSize: S.deck.length, relics: S.relics.length,
      stages,
    };
  },
  sweep(nPer = 120) {
    const out = [];
    for (let p = 0.2; p <= 1.001; p += 0.1) out.push(this.simulate(nPer, +p.toFixed(2)));
    return out;
  },
};

// ---------- 起動 ----------
buildSprites();
buildBoard();
applyTheme();
renderCollections();
updateHUD();
requestAnimationFrame(frame);
// Webフォント読込後に筐体を再描画(ネームプレート等のフォント反映)
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildCabinet());
// スタートメニュー(つづきから表示・図鑑進捗・記録)を初期化
try { refreshMenu(); } catch (e) {}
