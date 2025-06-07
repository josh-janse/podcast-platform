// src/lib/queues.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Ensure your Redis connection details are in environment variables
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
// Add password if your Redis instance requires it
// const redisPassword = process.env.REDIS_PASSWORD;

// Create a new connection to Redis
// BullMQ recommends using IORedis for optimal performance
const connection = new IORedis(redisPort, redisHost, {
  // password: redisPassword, // Uncomment if you have a password
  maxRetriesPerRequest: null, // Important for BullMQ
  enableReadyCheck: false, // Important for BullMQ
});

connection.on('connect', () => {
  console.log('Successfully connected to Redis for BullMQ.');
});

connection.on('error', (err) => {
  console.error('Redis connection error for BullMQ:', err);
});

// Define your podcast generation queue
// The first argument is the queue name, choose something descriptive.
export const podcastGenerationQueue = new Queue('podcast-generation', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Number of times to retry a job if it fails
    backoff: {
      type: 'exponential', // Exponential backoff strategy
      delay: 1000, // Initial delay in ms
    },
    removeOnComplete: {
        count: 1000, // Keep up to 1000 completed jobs
        age: 24 * 60 * 60, // Keep completed jobs for up to 24 hours (in seconds)
    },
    removeOnFail: {
        count: 5000, // Keep up to 5000 failed jobs
        age: 7 * 24 * 60 * 60, // Keep failed jobs for up to 7 days
    }
  },
});

// You can export other queues here as needed
// export const anotherQueue = new Queue('another-queue-name', { connection });

console.log(`BullMQ queue "podcast-generation" initialized.`);

// Graceful shutdown
process.on('SIGINT', async () => {
  await podcastGenerationQueue.close();
  await connection.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await podcastGenerationQueue.close();
  await connection.quit();
  process.exit(0);
});