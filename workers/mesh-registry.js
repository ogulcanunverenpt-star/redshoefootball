// Cloudflare Worker Script: workers/mesh-registry.js
// Deploy this to Cloudflare Workers (Free Plan) to manage mesh nodes globally!

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!globalThis.meshNodesStore) {
      globalThis.meshNodesStore = new Map();
    }

    if (path === '/api/nodes' && request.method === 'GET') {
      const nodes = Array.from(globalThis.meshNodesStore.values());
      return new Response(JSON.stringify(nodes), { headers: corsHeaders });
    }

    if (path === '/api/register' && request.method === 'POST') {
      const data = await request.json();
      if (!data.nodeId || !data.url) {
        return new Response(JSON.stringify({ error: 'nodeId and url are required' }), { status: 400, headers: corsHeaders });
      }

      globalThis.meshNodesStore.set(data.nodeId, {
        nodeId: data.nodeId,
        url: data.url,
        roomName: data.roomName || 'Saha-1',
        createdBy: data.createdBy || 'Oyuncu',
        activePlayers: data.activePlayers || 1,
        updatedAt: Date.now()
      });

      return new Response(JSON.stringify({ success: true, node: globalThis.meshNodesStore.get(data.nodeId) }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ message: 'Cloudflare Mesh Registry Worker Running' }), { headers: corsHeaders });
  }
};
