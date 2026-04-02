// Creates a local TCP tunnel through the HTTP CONNECT proxy to reach Neon PostgreSQL
const http = require('http');
const net = require('net');
const url = require('url');

const PROXY_URL = process.env.https_proxy || process.env.HTTPS_PROXY;
const TARGET_HOST = 'ep-damp-dawn-ajbdpxyq.c-3.us-east-2.aws.neon.tech';
const TARGET_PORT = 5432;
const LOCAL_PORT = 15432;

if (!PROXY_URL) {
  console.error('No https_proxy env var found');
  process.exit(1);
}

const proxy = new URL(PROXY_URL);

const server = net.createServer((clientSocket) => {
  const connectOptions = {
    host: proxy.hostname,
    port: parseInt(proxy.port),
    method: 'CONNECT',
    path: `${TARGET_HOST}:${TARGET_PORT}`,
    headers: {
      'Host': `${TARGET_HOST}:${TARGET_PORT}`,
      'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64'),
    },
  };

  const proxyReq = http.request(connectOptions);

  proxyReq.on('connect', (res, proxySocket) => {
    if (res.statusCode === 200) {
      clientSocket.pipe(proxySocket).pipe(clientSocket);
    } else {
      console.error(`CONNECT failed: ${res.statusCode}`);
      clientSocket.destroy();
      proxySocket.destroy();
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('Client socket error:', err.message);
  });

  proxyReq.end();
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`Tunnel listening on 127.0.0.1:${LOCAL_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
});
