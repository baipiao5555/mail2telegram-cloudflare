import net from 'node:net';

interface SocketAddress {
  hostname: string;
  port: number;
}

/**
 * Test replacement for cloudflare:sockets. Only inbound test servers can use it;
 * the Worker itself never imports this module.
 */
export function connect(address: string | SocketAddress, _options?: unknown) {
  const hostname = typeof address === 'string' ? address.split(':')[0]! : address.hostname;
  const port = typeof address === 'string' ? Number(address.split(':')[1]) : address.port;
  const socket = net.connect({ host: hostname, port });

  const opened = new Promise<{ remoteAddress: string | null; localAddress: string | null }>(
    (resolve, reject) => {
      socket.once('connect', () => {
        resolve({
          remoteAddress: socket.remoteAddress ? `${socket.remoteAddress}:${socket.remotePort}` : null,
          localAddress: socket.localAddress ? `${socket.localAddress}:${socket.localPort}` : null,
        });
      });
      socket.once('error', reject);
    },
  );

  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
  });

  socket.on('error', () => {
    // Keep background errors from crashing the test process.
  });

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      socket.once('end', () => {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
      socket.once('error', (error) => {
        try {
          controller.error(error);
        } catch {
          // Already errored.
        }
      });
    },
    cancel() {
      socket.destroy();
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      socket.write(Buffer.from(chunk));
    },
    close() {
      socket.end();
    },
    abort() {
      socket.destroy();
    },
  });

  return {
    readable,
    writable,
    opened,
    closed,
    close: async () => {
      socket.destroy();
    },
    startTls: () => {
      throw new Error('TLS is not implemented in the test socket');
    },
  };
}
