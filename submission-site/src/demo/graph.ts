import type { Snapshot } from "./types";
const key = (from: string, to: string) => JSON.stringify([from, to]);
export const edgeKey = key;
export function focusedGraph(snapshot: Snapshot, primary: Set<string>) {
  const highlighted = new Set<string>();
  const cycleEdges = new Set<string>();
  const nodes = new Set(primary);
  for (const violation of snapshot.violations) {
    highlighted.add(key(violation.from, violation.to));
    const members = [violation.from, violation.to, ...(violation.cyclePath ?? [])];
    const relevant = members.some(member => primary.has(member));
    let cycle = (violation.cyclePath ?? []).filter((member, index, all) => index === 0 || member !== all[index - 1]);
    if (cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]) cycle = cycle.slice(0, -1);
    if (cycle.length) {
      const start = cycle.indexOf(violation.from);
      cycle = start < 0 ? [violation.from, ...cycle] : [...cycle.slice(start), ...cycle.slice(0, start)];
      for (let i = 0; i < cycle.length; i++) {
        const edge = key(cycle[i]!, cycle[(i + 1) % cycle.length]!);
        highlighted.add(edge);
        if (relevant) cycleEdges.add(edge);
      }
      if (relevant) { members.forEach(member => nodes.add(member)); cycleEdges.add(key(violation.from, violation.to)); }
    }
  }
  const edges = snapshot.edges.filter(edge => primary.has(edge.from) || primary.has(edge.to) || cycleEdges.has(key(edge.from, edge.to)));
  edges.forEach(edge => { nodes.add(edge.from); nodes.add(edge.to); });
  return { edges, nodes, highlighted };
}
