import { spawn, ChildProcess } from 'child_process';
import { PrismaClient } from '../generated/prisma';
import { redisClient } from './redis';

const prisma = new PrismaClient();
const runningJobs = new Map<string, ChildProcess>();

interface JobData {
  id: string;
  command: string;
  parameters: string[];
  timeout: number;
  priority: string;
}

async function processJob(jobData: JobData): Promise<void> {
  const { id, command, parameters, timeout } = jobData;
  
  try {
    // Check for cancellation before starting
    const cancelFlag = await redisClient.get(`cancel:${id}`);
    if (cancelFlag) {
      await updateJobStatus(id, 'cancelled');
      return;
    }

    await updateJobStatus(id, 'running');
    
    const proc = spawn(command, parameters, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    runningJobs.set(id, proc);

    const timeoutId = setTimeout(() => {
      console.log(`Job ${id} timed out`);
      killJob(id);
    }, timeout * 1000);

    proc.stdout?.on('data', async (data) => {
      try {
        await logJobMessage(id, data.toString());
      } catch (error) {
        console.error(`Error logging stdout for job ${id}:`, error);
      }
    });

    proc.stderr?.on('data', async (data) => {
      try {
        await logJobMessage(id, data.toString());
      } catch (error) {
        console.error(`Error logging stderr for job ${id}:`, error);
      }
    });

    proc.on('exit', async (code, signal) => {
      clearTimeout(timeoutId);
      runningJobs.delete(id);

      try {
        const cancelFlag = await redisClient.get(`cancel:${id}`);
        let status: string;

        if (cancelFlag) {
          status = 'cancelled';
          await redisClient.del(`cancel:${id}`);
        } else if (signal === 'SIGKILL') {
          status = 'failed';
          await logJobMessage(id, 'Process was killed (timeout or forced termination)');
        } else {
          status = code === 0 ? 'completed' : 'failed';
        }

        await updateJobStatus(id, status);
        console.log(`Job ${id} finished with status: ${status}`);
      } catch (error) {
        console.error(`Error handling job ${id} exit:`, error);
      }
    });

    proc.on('error', async (error) => {
      clearTimeout(timeoutId);
      runningJobs.delete(id);
      console.error(`Job ${id} process error:`, error);
      
      try {
        await logJobMessage(id, `Process error: ${error.message}`);
        await updateJobStatus(id, 'failed');
      } catch (dbError) {
        console.error(`Error updating job ${id} after process error:`, dbError);
      }
    });

  } catch (error) {
    console.error(`Error processing job ${id}:`, error);
    try {
      await updateJobStatus(id, 'failed');
      await logJobMessage(id, `Job processing error: ${error}`);
    } catch (dbError) {
      console.error(`Error updating failed job ${id}:`, dbError);
    }
  }
}

async function updateJobStatus(jobId: string, status: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status }
  });
}

async function logJobMessage(jobId: string, message: string): Promise<void> {
  await prisma.jobLog.create({
    data: { jobId, message }
  });
}

function killJob(jobId: string): void {
  const proc = runningJobs.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGKILL');
    runningJobs.delete(jobId);
  }
}

async function getNextJob(): Promise<JobData | null> {
  const priorities = ['high', 'medium', 'low'];
  
  for (const priority of priorities) {
    const jobRaw = await redisClient.rPop(`jobQueue:${priority}`);
    if (jobRaw) {
      return JSON.parse(jobRaw);
    }
  }
  
  return null;
}

async function poll(): Promise<void> {
  try {
    const job = await getNextJob();
    
    if (job) {
      console.log(`Processing job ${job.id}`);
      await processJob(job);
      setImmediate(poll);
    } else {
      setTimeout(poll, 1000);
    }
  } catch (error) {
    console.error('Polling error:', error);
    setTimeout(poll, 5000);
  }
}

async function shutdown(): Promise<void> {
  console.log('Shutting down worker...');
  
  for (const [jobId, proc] of runningJobs) {
    console.log(`Killing job ${jobId}`);
    proc.kill('SIGTERM');

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5000);
  }
  
  await prisma.$disconnect();
  await redisClient.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('Worker started');
poll();