import { useMemo } from "react";

import type {
  SharedLadderEdge,
  SharedLadderNetwork,
} from "@/circuit/adapter/ladder-shared";

import styles from "./SharedLadderView.module.css";

type Point = { x: number; y: number };
type PlacedEdge = { edge: SharedLadderEdge; path: string; symbol: Point };
type Box = { left: number; right: number; top: number; bottom: number };
