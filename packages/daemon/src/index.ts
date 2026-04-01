import { Daemon } from './daemon';

const daemon = new Daemon({
  relayUrl: process.env.NEPSIS_RELAY_URL,
  bridgeId: process.env.NEPSIS_BRIDGE_ID,
});

async function main() {
  await daemon.start();

  const shutdown = async () => {
    console.log('\n[daemon] shutting down...');
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[daemon] fatal error:', err);
  process.exit(1);
});
