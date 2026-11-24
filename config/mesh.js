require('dotenv').config();
const https = require('https');
const http = require('http');

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const DOMAIN_NAME = process.env.DOMAIN_NAME || 'gamebler.xyz';

// Generate a random unique mesh identifier starting with 'meshchat-' on startup
const randomMeshId = 'meshchat-' + Math.random().toString(36).substring(2, 8);
const myHostname = process.env.HOSTNAME_URL || `${randomMeshId}.${DOMAIN_NAME}`;

class MeshRegistryManager {
  constructor() {
    this.myHostname = myHostname;
    console.log(`[Mesh Registry] Dynamic Node Hostname assigned: ${this.myHostname}`);
    // Register self in Cloudflare DNS on startup
    this.registerSelfDns();
  }

  // 1. Discover all active peer nodes dynamically from Cloudflare API querying 'meshchat-'
  async discoverPeerHostnames() {
    return new Promise((resolve) => {
      if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID || CLOUDFLARE_API_TOKEN.includes('your_')) {
        return resolve([]);
      }

      const options = {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?per_page=100`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.success && json.result) {
              const peers = json.result
                .map(record => record.name)
                .filter(name => name.startsWith('meshchat-') && name !== this.myHostname);
              resolve(peers);
            } else {
              resolve([]);
            }
          } catch (e) {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
      req.end();
    });
  }

  // 2. Fetch rooms from all dynamically discovered mesh peers
  async fetchPeerRooms() {
    const peerHosts = await this.discoverPeerHostnames();
    const allRooms = [];

    const promises = peerHosts.map(host => {
      return new Promise((resolve) => {
        const req = https.get(`https://${host}/api/rooms`, { timeout: 2500 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const rooms = JSON.parse(data);
              const tagged = rooms.map(r => ({ ...r, hostNode: host, isRemote: true }));
              resolve(tagged);
            } catch (e) {
              resolve([]);
            }
          });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
      });
    });

    const results = await Promise.all(promises);
    results.forEach(rooms => allRooms.push(...rooms));
    return allRooms;
  }

  // 3. Register self in Cloudflare DNS on startup
  registerSelfDns(tunnelIpOrTarget = '192.0.2.1') {
    if (!CLOUDFLARE_ZONE_ID || !CLOUDFLARE_API_TOKEN || CLOUDFLARE_API_TOKEN.includes('your_')) return;

    const data = JSON.stringify({
      type: 'A',
      name: this.myHostname,
      content: tunnelIpOrTarget,
      ttl: 1,
      proxied: true
    });

    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success) {
            console.log(`[Cloudflare API] Dynamic Mesh Subdomain registered successfully: ${this.myHostname}`);
          }
        } catch (e) {}
      });
    });

    req.on('error', err => console.warn('[Cloudflare API] Registration error:', err.message));
    req.write(data);
    req.end();
  }
}

const meshRegistry = new MeshRegistryManager();
module.exports = meshRegistry;
