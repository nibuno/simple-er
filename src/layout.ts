import type { Diagram, Table } from "./types.ts";
import { relationshipLabelWidth } from "./relationships.ts";
import { tableWidth, height, connectionSides } from "./geometry.ts";
import { validateDiagram } from "./model.ts";

const COLUMN_GAP = 120,
  ROW_GAP = 96,
  COMPONENT_GAP = 144;

// Include virtual nodes for links that skip columns, so long references also
// influence ordering. They reserve no table space and never enter saved data.
function orderColumns(
  component: number[],
  rank: Map<number, number>,
  links: Set<number>[],
) {
  const columns: number[][] = Array.from(
    { length: Math.max(...rank.values()) + 1 },
    () => [],
  );
  const parents = new Map<number, number[]>(),
    children = new Map<number, number[]>();
  const add = (id: number, r: number) => {
    columns[r].push(id);
    parents.set(id, []);
    children.set(id, []);
  };
  // Keep the longest continuation at the top before reducing crossings. A leaf
  // should not displace the main flow simply because its ID sorts first.
  const continuation = new Map<number, number>();
  for (const id of [...component].sort((a, b) => rank.get(b)! - rank.get(a)!))
    continuation.set(
      id,
      Math.max(0, ...[...links[id]].map((c) => 1 + continuation.get(c)!)),
    );
  component
    .slice()
    .sort((a, b) => continuation.get(b)! - continuation.get(a)! || a - b)
    .forEach((id) => add(id, rank.get(id)!));
  let virtual = -1;
  for (const a of component.slice().sort((a, b) => a - b)) {
    for (const b of [...links[a]].sort((a, b) => a - b)) {
      let prev = a;
      for (let r = rank.get(a)! + 1; r <= rank.get(b)!; r++) {
        const next = r === rank.get(b) ? b : virtual--;
        if (next < 0) add(next, r);
        children.get(prev)!.push(next);
        parents.get(next)!.push(prev);
        prev = next;
      }
    }
  }
  const positions = () =>
    new Map(columns.flatMap((c) => c.map((id, i) => [id, i] as const)));
  const score = () => {
    const pos = positions();
    let crossings = 0,
      distance = 0;
    for (const column of columns) {
      const edges = column.flatMap((a) => children.get(a)!.map((b) => [a, b]));
      for (const [i, [a, b]] of edges.entries()) {
        distance += Math.abs(pos.get(a)! - pos.get(b)!);
        for (const [c, d] of edges.slice(i + 1))
          if ((pos.get(a)! - pos.get(c)!) * (pos.get(b)! - pos.get(d)!) < 0)
            crossings++;
      }
    }
    return [crossings, distance];
  };
  let best = columns.map((c) => [...c]),
    bestScore = score();
  // Alternating barycenter sweeps remove avoidable crossings without changing
  // the direction of relationships. Keep the best pass, not just the last one.
  for (let pass = 0; pass < 12; pass++) {
    const forward = pass % 2 === 0;
    const neighbors = forward ? parents : children;
    const ranks = columns.map((_, i) => i);
    if (!forward) ranks.reverse();
    for (const r of ranks) {
      const pos = positions();
      const center = (id: number) => {
        const ns = neighbors.get(id)!;
        return ns.length
          ? ns.reduce((sum, n) => sum + pos.get(n)!, 0) / ns.length
          : pos.get(id)!;
      };
      columns[r].sort(
        (a, b) => center(a) - center(b) || pos.get(a)! - pos.get(b)!,
      );
    }
    const candidate = score();
    if (
      candidate[0] < bestScore[0] ||
      (candidate[0] === bestScore[0] && candidate[1] < bestScore[1])
    ) {
      best = columns.map((c) => [...c]);
      bestScore = candidate;
    }
  }
  return best.map((c) => c.filter((id) => id >= 0));
}

// Collapse cycles, rank left-to-right, reduce crossings, then align branches.
// Stable IDs only break ties; viewport and previous coordinates have no influence.
export function tidyDiagram(diagram: Diagram, _aspect = 1.5) {
  const next = validateDiagram(structuredClone(diagram));
  const ids = next.tables.map((t) => t.id).sort();
  const children = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const t of next.tables)
    for (const f of t.foreignKeys ?? [])
      if (f.target) children.get(f.target.tableId)!.add(t.id);
  let counter = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    active = new Set<string>(),
    groups: string[][] = [];
  function visit(id: string) {
    index.set(id, counter);
    low.set(id, counter++);
    stack.push(id);
    active.add(id);
    for (const child of [...children.get(id)!].sort()) {
      if (!index.has(child)) {
        visit(child);
        low.set(id, Math.min(low.get(id)!, low.get(child)!));
      } else if (active.has(child))
        low.set(id, Math.min(low.get(id)!, index.get(child)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      let child: string;
      do {
        child = stack.pop()!;
        active.delete(child);
        group.push(child);
      } while (child !== id);
      groups.push(group.sort());
    }
  }
  ids.forEach((id) => {
    if (!index.has(id)) visit(id);
  });
  groups.sort((a, b) => a[0].localeCompare(b[0]));
  const groupOf = new Map(
    groups.flatMap((g, i) => g.map((id) => [id, i] as const)),
  );
  const links = groups.map(() => new Set<number>()),
    neighbors = groups.map(() => new Set<number>());
  for (const id of ids)
    for (const child of children.get(id)!) {
      const a = groupOf.get(id)!,
        b = groupOf.get(child)!;
      if (a !== b) {
        links[a].add(b);
        neighbors[a].add(b);
        neighbors[b].add(a);
      }
    }
  const visited = new Set<number>();
  const clusters: {
    tables: Table[];
    width: number;
    height: number;
    id: string;
  }[] = [];
  const tableById = new Map(next.tables.map((t) => [t.id, t]));
  for (let root = 0; root < groups.length; root++) {
    if (visited.has(root)) continue;
    const component: number[] = [],
      queue = [root];
    visited.add(root);
    while (queue.length) {
      const n = queue.shift()!;
      component.push(n);
      for (const b of [...neighbors[n]].sort((a, b) => a - b))
        if (!visited.has(b)) {
          visited.add(b);
          queue.push(b);
        }
    }
    const rank = new Map(component.map((i) => [i, 0]));
    const incoming = new Map(
      component.map((i) => [
        i,
        component.filter((j) => links[j].has(i)).length,
      ]),
    );
    const ready = component
      .filter((i) => !incoming.get(i))
      .sort((a, b) => a - b);
    while (ready.length) {
      const a = ready.shift()!;
      for (const b of links[a]) {
        rank.set(b, Math.max(rank.get(b)!, rank.get(a)! + 1));
        incoming.set(b, incoming.get(b)! - 1);
        if (!incoming.get(b)) {
          ready.push(b);
          ready.sort((a, b) => a - b);
        }
      }
    }
    const columns = orderColumns(component, rank, links);
    const tops = new Map<number, number>();
    let x = 0,
      bottom = 0;
    for (const [columnIndex, column] of columns.entries()) {
      let y = 0;
      const tables: Table[] = [];
      for (const group of column) {
        const parentTops = component
          .filter((p) => links[p].has(group))
          .map((p) => tops.get(p)!);
        // A join follows its lowest parent. This keeps parent-to-child flow
        // horizontal or downward; a chain remains top-aligned independently of
        // which rows contain its PK and FK.
        y = Math.max(y, parentTops.length ? Math.max(...parentTops) : 0);
        tops.set(group, y);
        for (const id of groups[group]) {
          const t = tableById.get(id)!;
          t.x = x;
          t.y = y;
          tables.push(t);
          y += height(t) + ROW_GAP;
        }
      }
      bottom = Math.max(bottom, y - ROW_GAP);
      const labels = next.tables.flatMap((t) =>
        (t.foreignKeys ?? [])
          .filter(
            (f) =>
              f.label &&
              f.target &&
              rank.get(groupOf.get(f.target.tableId)!) === columnIndex &&
              rank.get(groupOf.get(t.id)!) === columnIndex + 1 &&
              component.includes(groupOf.get(t.id)!),
          )
          .map((f) => relationshipLabelWidth(f.label!)),
      );
      const corridor = Math.max(
        COLUMN_GAP,
        ...labels.map((width) => width + 64),
      );
      x += Math.max(...tables.map(tableWidth)) + corridor;
    }
    clusters.push({
      tables: component.flatMap((g) =>
        groups[g].map((id) => tableById.get(id)!),
      ),
      width: x - COLUMN_GAP,
      height: bottom,
      id: groups[root][0],
    });
  }
  // Fit disconnected groups into unused space, including below short branches.
  // Candidate positions come from table bounds, not the current viewport.
  clusters.sort(
    (a, b) =>
      b.height - a.height || b.width - a.width || a.id.localeCompare(b.id),
  );
  const targetWidth = Math.max(
    0,
    ...clusters.map((c) => c.width),
    Math.sqrt(
      clusters.reduce(
        (sum, c) =>
          sum + (c.width + COMPONENT_GAP) * (c.height + COMPONENT_GAP),
        0,
      ) * 1.6,
    ),
  );
  const placed: Table[] = [];
  let right = 0,
    bottom = 0;
  for (const cluster of clusters) {
    const xs = [
      ...new Set([
        0,
        ...placed.flatMap((t) => [t.x, t.x + tableWidth(t) + COLUMN_GAP]),
      ]),
    ].sort((a, b) => a - b);
    const ys = [
      ...new Set([0, ...placed.map((t) => t.y + height(t) + COMPONENT_GAP)]),
    ].sort((a, b) => a - b);
    let choice = { x: 0, y: bottom + COMPONENT_GAP, score: Infinity };
    for (const y of ys)
      for (const x of xs) {
        if (x + cluster.width > targetWidth) continue;
        if (
          placed.some(
            (t) =>
              x < t.x + tableWidth(t) + COLUMN_GAP &&
              x + cluster.width + COLUMN_GAP > t.x &&
              y < t.y + height(t) + COMPONENT_GAP &&
              y + cluster.height + COMPONENT_GAP > t.y,
          )
        )
          continue;
        const w = Math.max(right, x + cluster.width),
          h = Math.max(bottom, y + cluster.height);
        const score = w * h + Math.abs(w - h * 1.6);
        if (score < choice.score) choice = { x, y, score };
      }
    for (const table of cluster.tables) {
      table.x += choice.x;
      table.y += choice.y;
      placed.push(table);
    }
    right = Math.max(right, choice.x + cluster.width);
    bottom = Math.max(bottom, choice.y + cluster.height);
  }
  for (const t of next.tables) {
    t.x += 80;
    t.y += 80;
  }
  for (const e of next.edges) {
    const a = next.tables.find((t) => t.id === e.from.table)!,
      b = next.tables.find((t) => t.id === e.to.table)!;
    [e.from.side, e.to.side] = connectionSides(a, b);
    e.trunk = null;
    e.manual = false;
  }
  return next;
}
