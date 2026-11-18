import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, CanvasError, joinSession } from '@github/copilot-sdk/extension';

const canvasId = 'ram-architecture-map';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(moduleDir, 'assets');
const instances = new Map();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

async function readSpec(workspaceRoot, specPath) {
  const configuredPath = specPath || path.join(workspaceRoot, 'data', 'logic_spec.json');
  const resolved = path.resolve(workspaceRoot, configuredPath);
  try {
    const text = await fs.readFile(resolved, 'utf8');
    const spec = JSON.parse(text);
    if (!spec.meta || !Array.isArray(spec.inputs) || !Array.isArray(spec.rules) || !Array.isArray(spec.outputs)) {
      throw new Error('Unexpected logic specification shape');
    }
    return { spec, resolved };
  } catch (error) {
    throw new CanvasError('INVALID_LOGIC_SPEC', `Unable to load logic specification: ${error.message}`);
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function stopInstance(instanceId) {
  const instance = instances.get(instanceId);
  if (!instance) return;
  clearInterval(instance.interval);
  for (const connection of instance.connections) connection.destroy();
  instance.server.close();
  instances.delete(instanceId);
}

const canvas = createCanvas({
  id: canvasId,
  displayName: 'RAM Architecture Map',
  description: 'Interactive architecture and clinical pathway diagram for the Respiratory Ailment Manager.',
  inputSchema: {
    type: 'object',
    properties: {
      specPath: {
        type: 'string',
        description: 'Workspace-relative or absolute path to logic_spec.json.',
      },
    },
    additionalProperties: false,
  },
  actions: [
    {
      name: 'getDiagramSummary',
      description: 'Get counts and key architecture details from the loaded specification.',
      handler: async ctx => {
        const instance = instances.get(ctx.instanceId);
        if (!instance) throw new CanvasError('NOT_READY', 'Open the canvas before requesting its summary.');
        return instance.summary;
      },
    },
  ],
  open: async ctx => {
    const input = ctx.input || {};
    const instanceId = ctx.instanceId;
    stopInstance(instanceId);

    const workspaceRoot = ctx.workspaceRoot || process.cwd();
    const { spec, resolved } = await readSpec(workspaceRoot, input.specPath);
    const summary = {
      title: spec.meta.title?.en || spec.meta.id,
      version: spec.meta.version,
      stages: spec.meta.stages || [],
      inputCount: spec.inputs.length,
      ruleCount: spec.rules.length,
      outputCount: spec.outputs.length,
      groups: [...new Set(spec.rules.map(rule => rule.group))],
      specPath: resolved,
    };

    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/spec') {
        sendJson(response, 200, spec);
        return;
      }
      if (url.pathname === '/api/health') {
        sendJson(response, 200, { ok: true, canvasId });
        return;
      }
      if (url.pathname === '/assets/app.js') {
        try {
          const file = await fs.readFile(path.join(assetsDir, 'app.js'));
          response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
          response.end(file);
        } catch {
          sendJson(response, 404, { error: 'Asset not found' });
        }
        return;
      }
      if (url.pathname === '/assets/styles.css') {
        try {
          const file = await fs.readFile(path.join(assetsDir, 'styles.css'));
          response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
          response.end(file);
        } catch {
          sendJson(response, 404, { error: 'Asset not found' });
        }
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        try {
          const file = await fs.readFile(path.join(assetsDir, 'index.html'), 'utf8');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(file);
        } catch {
          sendJson(response, 404, { error: 'Page not found' });
        }
        return;
      }
      sendJson(response, 404, { error: 'Not found' });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new CanvasError('SERVER_START_FAILED', 'Could not start the diagram server.');
    }

    const connections = new Set();
    server.on('connection', connection => {
      connections.add(connection);
      connection.once('close', () => connections.delete(connection));
    });
    instances.set(instanceId, { server, connections, summary, interval: null });

    return { url: `http://127.0.0.1:${address.port}/`, title: 'RAM Architecture Map' };
  },
  onClose: async ctx => {
    stopInstance(ctx.instanceId);
  },
});

const session = await joinSession({ canvases: [canvas] });
await session.log('RAM architecture canvas registered', { level: 'info' });
