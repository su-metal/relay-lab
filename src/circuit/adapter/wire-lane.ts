/**
 * 配線のレーン分離（design.md §8.7）。
 *
 * `smoothstep` の経路は「端子から真っ直ぐ出る → 中間で 1 回折れる → 端子へ入る」の
 * 形で、**折れる位置（幹線）は既定で両端の中点に固定されている。** そのため同じ
 * あたりを走る配線は幹線がぴったり重なり、2 本が 1 本に見える。ラダー図では
 * 電源のレールから複数のリレーへ渡る線がまさにこの形になるので、実用上かなり困る。
 *
 * ここでは幹線の位置を配線ごとに数 px ずつずらして重なりを解く。
 *
 * 1. 配線ごとに **幹線（中間の直線区間）の向き・座標・伸びている範囲**を求める
 * 2. 幹線が近い配線を 1 つの束にまとめる
 * 3. 束の中で**区間が重なる配線どうしにだけ別のレーン番号を配る**（区間グラフの
 *    貪欲彩色）。重ならない配線は同じレーンのままでよい ―― 無闇にずらすと
 *    重なってもいない線まで図面から浮く
 * 4. レーン番号を中央から交互に振れる符号付きのずらし量へ写す
 *
 * **経路の計算そのものは React Flow の `getSmoothStepPath` に任せる。**
 * ここが返すのは「幹線をどれだけ動かすか」の px だけで、描画は
 * `components/edges/WireEdge.tsx` が `centerX` / `centerY` に足して行う。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  TerminalRef,
  TerminalSide,
} from "@/circuit/types";

import { layoutTerminals } from "./reactflow";
import type { Point } from "./selection";

/** レーン 1 本ぶんの間隔（キャンバス座標 px） */
export const LANE_STEP = 10;

/**
 * 幹線がこれだけしか離れていなければ「同じ道を通っている」とみなす。
 * `LANE_STEP` より少し広く取り、ずらした結果が隣の束とぶつからないようにする。
 */
const LANE_TOLERANCE = 12;

/**
 * 幹線の伸びがこれだけ近ければ重なっているとみなす余白。
 * 線幅（2〜3.5px）ぶんだけ離れていても読み手には重なって見える。
 */
const SPAN_MARGIN = 8;

/**
 * `smoothstep` が端子から真っ直ぐ伸ばす長さ。**React Flow の既定値と一致させること。**
 * ここがずれると幹線の座標を実際より手前／奥に見積もり、ずらし量の上限を誤る。
 */
const HANDLE_GAP = 20;

/** 角丸（`borderRadius` 既定 5）に食われるぶんの余白。幹線が潰れるまでは寄せない */
const CORNER_SLACK = 6;

/** 端子の辺 → 配線が出ていく向き（`getSmoothStepPath` の `handleDirections` と同じ） */
const SIDE_DIRECTION: Record<TerminalSide, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/** 幹線 1 本。座標系は「向き」に応じて x / y のどちらかを指す */
type Trunk = {
  /** `CircuitConnection.id` */
  id: string;
  /** 幹線が縦（この場合 `coord` は x）か横（`coord` は y）か */
  vertical: boolean;
  /** 幹線の位置 */
  coord: number;
  /** 幹線が伸びている範囲（縦なら y、横なら x） */
  start: number;
  end: number;
  /** ずらせる上限。これを超えると経路が折り返して図が破綻する */
  room: number;
};

/** 端子 1 個のキャンバス座標と、配線が出ていく辺 */
type Anchor = { point: Point; side: TerminalSide };

const anchorLookup = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
): ((ref: TerminalRef) => Anchor | null) => {
  const instances = new Map(
    document.components.map((component) => [component.id, component]),
  );

  return (ref) => {
    const instance = instances.get(ref.componentId);
    if (!instance) return null;
    const definition = registry.get(instance.definitionId);
    if (!definition) return null;
    // 反転を必ず通す。座標だけでなく辺も鏡像になっており、
    // 辺を取り違えると幹線の向きの判定ごと裏返る（design.md §8.1）
    const terminals = layoutTerminals(definition, instance.flipped === true);
    const terminal = terminals.find((current) => current.id === ref.terminalId);
    if (!terminal) return null;
    return {
      point: {
        x: instance.position.x + terminal.position.x * definition.visual.width,
        y: instance.position.y + terminal.position.y * definition.visual.height,
      },
      side: terminal.side,
    };
  };
};

/**
 * 配線 1 本の幹線を求める。**`getSmoothStepPath` の分岐をそのままなぞる。**
 *
 * 折れ方は端子の**辺**だけで決まり、両端の距離では決まらない
 * （`getDirection` は `sourcePosition` しか見ない）。ここを「横に長ければ縦の幹線」
 * のような当て推量にすると、実際の描画と違う幹線をずらして重なりが解けない。
 *
 * 向かい合っていない辺どうし（右 → 右など）では `getSmoothStepPath` が中点を
 * 使わないため、ずらす手段が無い。`null` を返して対象から外す。
 */
const trunkOf = (id: string, from: Anchor, to: Anchor): Trunk | null => {
  const fromDir = SIDE_DIRECTION[from.side];
  const toDir = SIDE_DIRECTION[to.side];
  // 端子から真っ直ぐ出たあとの点。幹線はこの 2 点の間に立つ
  const fromGap = {
    x: from.point.x + fromDir.x * HANDLE_GAP,
    y: from.point.y + fromDir.y * HANDLE_GAP,
  };
  const toGap = {
    x: to.point.x + toDir.x * HANDLE_GAP,
    y: to.point.y + toDir.y * HANDLE_GAP,
  };

  // 主軸は出口の辺で決まる。左右の端子なら x、上下なら y
  const horizontalExit = from.side === "left" || from.side === "right";
  const axis = horizontalExit ? "x" : "y";
  if (fromDir[axis] * toDir[axis] !== -1) return null;

  const forward = fromGap[axis] < toGap[axis] ? 1 : -1;
  // 出口の向きと進む向きが一致していれば主軸に直交する幹線、
  // 逆向き（back へ回り込む配線）なら主軸に沿った幹線になる
  const alongAxis = fromDir[axis] === forward;
  const vertical = horizontalExit ? alongAxis : !alongAxis;

  const spanAxis = vertical ? "y" : "x";
  const coordAxis = vertical ? "x" : "y";
  return {
    id,
    vertical,
    coord: (fromGap[coordAxis] + toGap[coordAxis]) / 2,
    start: Math.min(fromGap[spanAxis], toGap[spanAxis]),
    end: Math.max(fromGap[spanAxis], toGap[spanAxis]),
    room: Math.max(
      0,
      Math.abs(toGap[coordAxis] - fromGap[coordAxis]) / 2 - CORNER_SLACK,
    ),
  };
};

/**
 * レーン番号 → 符号付きのずらし量。
 *
 * 0, +1, -1, +2, -2 … と**中央から交互に**振る。片側へ積んでいくと束全体が
 * 元の位置から離れていき、部品との位置関係が読み取りにくくなる。
 */
export const laneShift = (lane: number): number =>
  lane === 0 ? 0 : Math.ceil(lane / 2) * LANE_STEP * (lane % 2 === 1 ? 1 : -1);

const overlaps = (a: Trunk, b: Trunk): boolean =>
  a.start - SPAN_MARGIN <= b.end && b.start - SPAN_MARGIN <= a.end;

/**
 * 幹線が重なり合う配線に別々のレーンを配る（区間グラフの貪欲彩色）。
 *
 * 開始位置の順に見て、**すでに置いた同じレーンの幹線と重ならない最小のレーン**を
 * 取る。重なっていない配線は 0 のままなので、混み合った場所だけがずれる。
 */
const assignCluster = (
  cluster: readonly Trunk[],
  shifts: Map<string, number>,
): void => {
  // 1 本しか通っていない道はずらす理由が無い
  if (cluster.length < 2) return;

  const placed: { lane: number; trunk: Trunk }[] = [];
  const ordered = [...cluster].sort(
    (a, b) => a.start - b.start || (a.id < b.id ? -1 : 1),
  );

  for (const trunk of ordered) {
    let lane = 0;
    while (
      placed.some((taken) => taken.lane === lane && overlaps(taken.trunk, trunk))
    ) {
      lane += 1;
    }
    placed.push({ lane, trunk });

    // 部品が近すぎてずらす余地が無いときは動かさない。ここで無理に押し込むと
    // 経路が折り返して、重なり以上に読みにくい線になる（design.md §8.7）
    const shift = laneShift(lane);
    const clamped = Math.max(-trunk.room, Math.min(trunk.room, shift));
    if (clamped !== 0) shifts.set(trunk.id, clamped);
  }
};

/** 幹線の位置が近いものを 1 つの束にまとめ、束ごとにレーンを配る */
const assignLanes = (trunks: Trunk[], shifts: Map<string, number>): void => {
  const sorted = [...trunks].sort(
    (a, b) => a.coord - b.coord || (a.id < b.id ? -1 : 1),
  );

  let cluster: Trunk[] = [];
  for (const trunk of sorted) {
    // 束の先頭を基準にする。1 本ずつ連鎖で判定すると、少しずつずれた幹線が
    // 延々と 1 つの束につながって画面の端まで巻き込む
    if (cluster.length > 0 && trunk.coord - cluster[0].coord > LANE_TOLERANCE) {
      assignCluster(cluster, shifts);
      cluster = [];
    }
    cluster.push(trunk);
  }
  assignCluster(cluster, shifts);
};

const NO_LANES: ReadonlyMap<string, number> = new Map();

/**
 * 配線ごとの幹線のずらし量を求める。キーは `CircuitConnection.id`。
 *
 * **ずらす必要が無い配線は入れない。** 呼び出し側は `get()` の `undefined` を
 * 0 として扱えばよく、既定の経路のままの配線は Edge のデータも増えない。
 *
 * 端子の座標が引けない配線（定義が無い・端子が存在しない）は黙って外す。
 * 描画側も同じ理由で落としているので、ここだけ例外にする理由が無い。
 */
export const buildWireLanes = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
): ReadonlyMap<string, number> => {
  // 1 本きりなら重なりようが無い
  if (document.connections.length < 2) return NO_LANES;

  const anchorOf = anchorLookup(document, registry);
  const vertical: Trunk[] = [];
  const horizontal: Trunk[] = [];

  for (const connection of document.connections) {
    const from = anchorOf(connection.from);
    const to = anchorOf(connection.to);
    if (!from || !to) continue;
    const trunk = trunkOf(connection.id, from, to);
    if (!trunk) continue;
    (trunk.vertical ? vertical : horizontal).push(trunk);
  }

  const shifts = new Map<string, number>();
  // 縦の幹線と横の幹線は別の道なので、束ねるときも混ぜない
  assignLanes(vertical, shifts);
  assignLanes(horizontal, shifts);
  return shifts;
};
