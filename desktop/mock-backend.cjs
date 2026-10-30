const http = require('node:http');

const WORKSPACE = 'desktop-shell-prototype';
const token = process.env.MODEL_DESK_BACKEND_TOKEN;
let project = null;
let demoBatch = 0;
let tasks = [];

function publicTasks() {
  return tasks.map(({ timer, ...task }) => task);
}

function stopDemoTimers() {
  for (const task of tasks) clearTimeout(task.timer);
}

const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');

  const expectedHost = `127.0.0.1:${server.address()?.port}`;
  if (request.headers.host !== expectedHost || request.headers.origin) {
    response.statusCode = 403;
    response.end(JSON.stringify({ error: 'Untrusted request origin.' }));
    return;
  }
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: 'Authentication required.' }));
    return;
  }

  if (request.method === 'GET' && request.url === '/api/state') {
    response.end(JSON.stringify({ workspace: WORKSPACE, project }));
    return;
  }

  if (request.method === 'GET' && request.url === '/api/tasks') {
    response.end(JSON.stringify({ demo: true, tasks: publicTasks() }));
    return;
  }

  if (request.method === 'POST' && request.url?.startsWith('/api/demo-tasks?mode=')) {
    if (tasks.some((task) => task.status === 'running')) {
      response.statusCode = 409;
      response.end(JSON.stringify({ error: 'A demo batch is already running.' }));
      return;
    }
    const mode = new URL(request.url, 'http://localhost').searchParams.get('mode');
    if (!['single', 'lead', 'discussion', 'groups', 'handoff'].includes(mode)) { response.statusCode = 400; response.end('{}'); return; }
    stopDemoTimers();
    tasks = [];
    demoBatch += 1;
    const now = Date.now();
    for (const [index, duration] of (mode === 'single' ? [1200] : [1200, 1900, 2600]).entries()) {
      const task = {
        id: `demo-${demoBatch}-${index + 1}`,
        label: `演示任务 ${index + 1}`,
        status: 'running',
        startedAt: now,
        endedAt: null,
        durationMs: null,
        tokens: null,
        cpuMs: null,
        gpuMs: null,
      };
      task.timer = setTimeout(() => {
        if (task.status !== 'running') return;
        task.status = 'completed';
        task.endedAt = Date.now();
        task.durationMs = task.endedAt - task.startedAt;
      }, duration);
      tasks.push(task);
    }
    tasks = tasks.slice(-12);
    response.statusCode = 201;
    response.end(JSON.stringify({ demo: true, tasks: publicTasks() }));
    return;
  }

  const cancelMatch = /^\/api\/tasks\/(demo-\d+-[1-3])\/cancel$/.exec(request.url || '');
  if (request.method === 'POST' && cancelMatch) {
    const task = tasks.find((item) => item.id === cancelMatch[1]);
    if (!task || task.status !== 'running') {
      response.statusCode = 409;
      response.end(JSON.stringify({ error: 'Task is not running.' }));
      return;
    }
    clearTimeout(task.timer);
    task.status = 'cancelled';
    task.endedAt = Date.now();
    task.durationMs = task.endedAt - task.startedAt;
    response.end(JSON.stringify({ demo: true, tasks: publicTasks() }));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/project') {
    if (!request.headers['content-type']?.startsWith('application/json')) {
      response.statusCode = 415;
      response.end(JSON.stringify({ error: 'JSON content type required.' }));
      return;
    }
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > 65536) {
        response.statusCode = 413;
        response.end(JSON.stringify({ error: 'Request body is too large.' }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const body = JSON.parse(data || '{}');
        if (typeof body.project !== 'string' || body.project.length === 0) throw new Error('Project path is required.');
        project = body.project;
        response.end(JSON.stringify({ project }));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'Invalid project selection.' }));
      }
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/shutdown') {
    stopDemoTimers();
    response.end(JSON.stringify({ stopping: true }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 1500).unref();
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'Not found.' }));
});

server.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({ type: 'error', message: error.message })}\n`);
  process.exitCode = 1;
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${address.port}` })}\n`);
});

function shutdown() {
  stopDemoTimers();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
