/**
 * Graph query interface for the Cortex knowledge graph.
 *
 * Provides node lookup, neighbor traversal, and filtering by vault/type.
 */

/**
 * @typedef {object} QueryOptions
 * @property {string[]} [vaults] - Only include nodes/edges from these vaults (access control)
 * @property {string[]} [nodeTypes] - Filter results to these node types
 * @property {string[]} [edgeTypes] - Filter results to these edge types
 */

/**
 * Look up a node by its ID.
 * @param {object} graph - The graph JSON object
 * @param {string} id - Node ID (e.g., "person:user-alpha")
 * @param {QueryOptions} [opts]
 * @returns {object|null} The node, or null if not found / filtered out
 */
export function getNode(graph, id, opts = {}) {
  const node = graph.nodes.find(n => n.id === id);
  if (!node) return null;
  if (opts.vaults?.length && node.vault && !opts.vaults.includes(node.vault)) return null;
  if (opts.nodeTypes?.length && !opts.nodeTypes.includes(node.type)) return null;
  return node;
}

/**
 * Find all nodes matching filters.
 * @param {object} graph
 * @param {QueryOptions} [opts]
 * @returns {object[]}
 */
export function findNodes(graph, opts = {}) {
  return graph.nodes.filter(n => {
    if (opts.vaults?.length && n.vault && !opts.vaults.includes(n.vault)) return false;
    if (opts.nodeTypes?.length && !opts.nodeTypes.includes(n.type)) return false;
    return true;
  });
}

/**
 * Get edges connected to a node, respecting vault and type filters.
 * @param {object} graph
 * @param {string} nodeId
 * @param {QueryOptions} [opts]
 * @returns {object[]}
 */
function getEdges(graph, nodeId, opts = {}) {
  return graph.edges.filter(e => {
    if (e.source !== nodeId && e.target !== nodeId) return false;
    if (opts.edgeTypes?.length && !opts.edgeTypes.includes(e.type)) return false;
    return true;
  });
}

/**
 * Filter a set of node IDs by vault access.
 * @param {object} graph
 * @param {Set<string>} nodeIds
 * @param {QueryOptions} opts
 * @returns {Set<string>}
 */
function filterByVault(graph, nodeIds, opts) {
  if (!opts.vaults?.length) return nodeIds;
  const filtered = new Set();
  for (const id of nodeIds) {
    const node = graph.nodes.find(n => n.id === id);
    if (node && (!node.vault || opts.vaults.includes(node.vault))) {
      filtered.add(id);
    }
  }
  return filtered;
}

/**
 * Traverse 1-2 hops from a starting node.
 * Returns the subgraph of connected nodes and edges.
 * @param {object} graph - The graph JSON
 * @param {string} startId - Starting node ID
 * @param {number} [hops=1] - Number of hops (1 or 2)
 * @param {QueryOptions} [opts]
 * @returns {{ nodes: object[], edges: object[] }} Subgraph of results
 */
export function neighbors(graph, startId, hops = 1, opts = {}) {
  const visitedIds = new Set([startId]);
  const resultEdges = [];

  let frontier = new Set([startId]);

  for (let hop = 0; hop < hops; hop++) {
    const nextFrontier = new Set();
    for (const nid of frontier) {
      const edges = getEdges(graph, nid, opts);
      for (const edge of edges) {
        const otherId = edge.source === nid ? edge.target : edge.source;
        resultEdges.push(edge);
        if (!visitedIds.has(otherId)) {
          visitedIds.add(otherId);
          nextFrontier.add(otherId);
        }
      }
    }
    frontier = nextFrontier;
  }

  // Apply vault filtering
  const allowedIds = filterByVault(graph, visitedIds, opts);

  const resultNodes = graph.nodes.filter(n => allowedIds.has(n.id));
  const filteredEdges = deduplicateEdges(resultEdges).filter(
    e => allowedIds.has(e.source) && allowedIds.has(e.target)
  );

  // Apply node type filter
  const finalNodes = opts.nodeTypes?.length
    ? resultNodes.filter(n => opts.nodeTypes.includes(n.type))
    : resultNodes;

  return { nodes: finalNodes, edges: filteredEdges };
}

/**
 * Remove duplicate edges.
 * @param {object[]} edges
 * @returns {object[]}
 */
function deduplicateEdges(edges) {
  const seen = new Set();
  return edges.filter(e => {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
