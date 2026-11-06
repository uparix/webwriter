// Sibling orders after a drag in the outline.
import { isTrash, isGroup } from './tree.js';

function locate(nodes, id, parent = null) {
  for (const node of nodes) {
    if (node.header.id === id) return { node, parent, siblings: nodes };
    const child = locate(node.children, id, node);
    if (child) return child;
  }
  return null;
}

function contains(node, id) {
  return node.children.some((c) => c.header.id === id || contains(c, id));
}

/**
 * Sibling orders after a drag: [{ parentID, order }], one per directory involved (a null parent is
 * the manuscript). Empty when the drop is refused, such as a group into itself.
 */
export function planMove(roots, movingID, targetID, zone) {
  if (movingID === targetID) return [];
  const moving = locate(roots, movingID);
  const target = locate(roots, targetID);
  if (!moving || !target || isTrash(moving.node)) return [];
  const inside = isTrash(target.node) || (zone === 'inside' && isGroup(target.node));
  const newParent = inside ? target.node : target.parent;
  if (newParent && (newParent === moving.node || contains(moving.node, newParent.header.id))) return [];
  const pool = newParent ? newParent.children : roots.filter((n) => !isTrash(n));
  const destination = pool.filter((n) => n.header.id !== movingID);
  if (inside) {
    destination.push(moving.node);
  } else {
    let index = destination.findIndex((n) => n.header.id === targetID);
    if (index < 0) index = destination.length;
    if (zone === 'after') index += 1;
    destination.splice(index, 0, moving.node);
  }
  const dest = { parentID: newParent ? newParent.header.id : null, order: destination.map((n) => n.header.id) };
  if ((moving.parent?.header.id ?? null) === dest.parentID) return [dest];
  const source = moving.siblings.filter((n) => n.header.id !== movingID && !isTrash(n));
  return [{ parentID: moving.parent ? moving.parent.header.id : null, order: source.map((n) => n.header.id) }, dest];
}
