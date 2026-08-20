// ==================================================================================================
// Compile-time guards for the connector grammar (D-IL8) — this file IS the test
// ==================================================================================================
// WP 0.2's acceptance says "a seventh kind is a TYPE ERROR, not a runtime fallback". A runtime test
// cannot check that: by the time a test runs, the type system has already been asked and answered.
// `@ts-expect-error` can. Each one below FAILS THE BUILD if the error it expects ever stops
// happening — so if somebody adds a `stroke` prop to `Connector`, or replaces the closed `kind`
// union with `string`, `pnpm typecheck` goes red pointing at this file.
//
// It is real, compiled source rather than a `.d.ts` or a comment, because `tsconfig.json` includes
// `src` and the gate runs `tsc` over it. The exported array keeps every expression used, so the
// linter has nothing to complain about and nothing here can be dead-code-eliminated into silence.

import type { ReactElement } from "react";
import { Connector } from "./Connector.js";

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };

export const CONNECTOR_TYPE_GUARDS: readonly ReactElement[] = [
  // The six kinds the grammar allows. These must all compile.
  <Connector key="flow" kind="flow" from={A} to={B} />,
  <Connector key="read" kind="read" from={A} to={B} />,
  <Connector key="write" kind="write" from={A} to={B} />,
  <Connector key="publish" kind="publish" from={A} to={B} />,
  <Connector key="loop" kind="loop" from={A} to={B} />,
  <Connector key="signal" kind="signal" from={A} to={B} />,

  // A seventh kind is a type error, not a fallback to some default style.
  // @ts-expect-error "teleport" is not one of the six connector kinds (D-IL8)
  <Connector key="seventh" kind="teleport" from={A} to={B} />,

  // A caller cannot choose a stroke...
  // @ts-expect-error `stroke` is not a Connector prop — the kind decides the token (system design 2.3)
  <Connector key="stroke" kind="flow" from={A} to={B} stroke="var(--illus-error)" />,

  // ...nor a width...
  // @ts-expect-error `strokeWidth` is not a Connector prop — the kind decides the weight
  <Connector key="width" kind="flow" from={A} to={B} strokeWidth={9} />,

  // ...nor a colour, under any spelling.
  // @ts-expect-error `color` is not a Connector prop — D-IL5 leaves no way to name a colour here
  <Connector key="color" kind="read" from={A} to={B} color="var(--illus-accent)" />,

  // ...nor a dash pattern.
  // @ts-expect-error `strokeDasharray` is not a Connector prop — `signal` is how you get dots
  <Connector key="dash" kind="read" from={A} to={B} strokeDasharray="2 2" />,
];
