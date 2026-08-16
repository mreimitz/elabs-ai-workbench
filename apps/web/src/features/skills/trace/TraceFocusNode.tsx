import { useEffect } from "react";
import { useReactFlow } from "@brand/flow";
import { resolveFocusPoint } from "./trace-link";

/**
 * One evidence→canvas focus request. `tick` makes repeat clicks on the same node re-center (a plain
 * nodeId would be referentially stable and the effect would never re-fire).
 */
export type TraceFocusRequest = { nodeId: string; tick: number };

/**
 * WP 7.6 — center the canvas on a node when the Evidence panel asks for it. Render-null helper
 * mounted as a CHILD of {@link SkillGraphCanvas} (children render inside the React Flow context —
 * the same contract `FitViewOnChange` uses), so the canvas itself needs no new props. Keeps the
 * user's current zoom: focusing is a pan, never a surprise zoom jump.
 */
export function TraceFocusNode({ request }: { request: TraceFocusRequest | null }) {
  const { getNode, getViewport, setCenter } = useReactFlow();
  useEffect(() => {
    if (!request) return;
    const node = getNode(request.nodeId);
    if (!node) return;
    const point = resolveFocusPoint(node);
    void setCenter(point.x, point.y, { zoom: getViewport().zoom, duration: 250 });
  }, [request, getNode, getViewport, setCenter]);
  return null;
}
