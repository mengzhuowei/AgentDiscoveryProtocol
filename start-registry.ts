#!/usr/bin/env node

import { defaultConfig, Database, Cache, RegistryService } from './src/registry';

async function main() {
  console.log('Starting ADP Registry...');
  
  try {
    // Initialize database
    const db = new Database(defaultConfig);
    await db.initialize();
    
    // Initialize cache
    const cache = new Cache(defaultConfig);
    await cache.initialize();
    
    // Create and start service
    const service = new RegistryService(defaultConfig, db, cache);
    service.start();
    
    console.log('Registry is ready to accept connections');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await service.stop();
      await db.close();
      await cache.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start registry:', error);
    process.exit(1);
  }
}

main();

