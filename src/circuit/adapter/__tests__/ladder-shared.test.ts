import { describe, expect, it } from "vitest";

import { buildLadder } from "@/circuit/adapter/ladder";
import {
  buildSharedLadder,
  hasRepeatedPhysicalContact,
} from "@/circuit/adapter/ladder-shared";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fromComponent, terminalId: fromTerminal },
    to: { componentId: toComponent, terminalId: toTerminal },
  };
};

/**
 * 2026-08-20 にラダー表示の重複が見つかった実回路と同じトポロジー。
 * JSON ファイルそのものは fixture にせず、必要な結線だけを固定して再現する。
 */
const sharedBranchCircuit = (): CircuitDocument => ({
  version: 1,
  components: [
    { id: "PS1", definitionId: "power-dc24v", label: "PS1", position: { x: 0, y: 0 } },
    {
      id: "PERMIT",
      definitionId: "switch-selector-no",
      label: "運転許可 スイッチ",
      position: { x: 0, y: 100 },
    },
    {
      id: "STOP",
      definitionId: "switch-pushbutton-nc",
      label: "STOP",
      position: { x: 0, y: 200 },
    },
    {
      id: "START",
      definitionId: "switch-pushbutton-no",
      label: "START",
      position: { x: 0, y: 300 },
    },
    {
      id: "RY1",
      definitionId: "omron-my2n-dc24",
      label: "RY1",
      position: { x: 0, y: 400 },
    },
    {
      id: "RUN_LAMP",
      definitionId: "lamp-dc24v",
      label: "運転中",
      position: { x: 0, y: 500 },
      lampColor: "green",
    },
    {
      id: "PERMIT_LAMP",
      definitionId: "lamp-dc24v",
      label: "運転許可",
      position: { x: 0, y: 600 },
    },
    {
      id: "RY2",
      definitionId: "omron-my2n-dc24",
      label: "RY2",
      position: { x: 0, y: 700 },
    },
  ],
  connections: [
    wire("PS1:plus", "PERMIT:1"),
    wire("PERMIT:2", "RY1:14"),
    wire("PS1:plus", "RY1:9"),
    wire("RY1:13", "PS1:zero"),
    wire("RY1:5", "PERMIT_LAMP:1"),
    wire("PERMIT_LAMP:2", "PS1:zero"),
    wire("RY1:5", "RY2:9"),
    wire("RY2:5", "RUN_LAMP:1"),
    wire("RUN_LAMP:2", "PS1:zero"),
    wire("PERMIT:2", "START:1"),
    wire("RY2:5", "RY2:14"),
    wire("START:2", "RY2:14"),
    wire("STOP:2", "RY2:13"),
    wire("STOP:1", "RY1:12"),
    wire("RY1:8", "PS1:zero"),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const contactText = (edge: NonNullable<ReturnType<typeof buildSharedLadder>>["edges"][number]) =>
  edge.kind === "contact"
    ? `${edge.contact.label} ${edge.contact.terminalLabels[0]}-${edge.contact.terminalLabels[1]}[${edge.contact.kind}]`
    : null;

describe("共有接点ラダー", () => {
  it("同じ物理接点を出力ごとに複製せず 1 回だけ持つ", () => {
    const document = sharedBranchCircuit();
    const expanded = buildLadder(document, componentRegistry);

    expect(hasRepeatedPhysicalContact(expanded)).toBe(true);

    const shared = buildSharedLadder(document, componentRegistry, expanded);
    expect(shared).toBeDefined();
    expect(shared?.wiringFaithfulFallback).toBe(false);

    const contacts = shared?.edges
      .map(contactText)
      .filter((value): value is string => value !== null) ?? [];

    expect(contacts).toEqual(
      expect.arrayContaining([
        "運転許可 スイッチ 1-2[no]",
        "START 1-2[no]",
        "STOP 1-2[nc]",
        "RY1 9-5[no]",
        "RY1 12-8[no]",
        "RY2 9-5[no]",
      ]),
    );

    // 未配線の NC 側や同じ端子対の複製を混ぜない。
    expect(contacts).toHaveLength(6);
    expect(new Set(contacts).size).toBe(contacts.length);

    const outputs = shared?.edges.filter((edge) => edge.kind === "output") ?? [];
    expect(outputs).toHaveLength(4);
    expect(outputs.every((edge) => edge.to === shared?.zero)).toBe(true);
    expect(shared?.movedZeroSide).toBe(true);
  });
});
