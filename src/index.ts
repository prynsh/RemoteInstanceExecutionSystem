import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import { PrismaClient } from '../generated/prisma';
import { redisClient } from './redis';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();

const createJobSchema = z.object({
  command: z.string().min(1).max(100),
  args: z.array(z.string()).default([]),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  timeout: z.number().min(1).max(3600).default(60)
});

const ALLOWED_COMMANDS = ['echo', 'ls', 'pwd', 'date', 'sleep','node','cat'];

app.use(cors());
app.use(express.json())
const asyncHandler = (fn: Function) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.post('/api/jobs', asyncHandler(async (req: any, res: any) => {
  try {
    const { command, args, priority, timeout } = createJobSchema.parse(req.body);
    
    if (!ALLOWED_COMMANDS.includes(command)) {
      return res.status(400).json({ 
        error: 'Command not allowed',
        allowedCommands: ALLOWED_COMMANDS 
      });
    }

    const id = uuidv4();
    
    const job = await prisma.job.create({
      data: {
        id,
        command,
        parameters: args,
        priority,
        timeout,
        status: 'queued',
      },
    });

    const queueKey = `jobQueue:${priority}`;
    await redisClient.lPush(queueKey, JSON.stringify(job));
    
    res.json({ jobId: id, status: 'queued' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

app.delete('/api/jobs/:id', asyncHandler(async (req: any, res: any) => {
  try {
    const jobId = req.params.id;
    
    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: 'Job cannot be cancelled' });
    }

    await Promise.all([
      redisClient.set(`cancel:${jobId}`, '1', { EX: 3600 }),
      prisma.job.update({
        where: { id: jobId },
        data: { status: 'cancelled' }
      })
    ]);

    res.json({ success: true, message: 'Cancellation requested' });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

app.get('/api/jobs', asyncHandler(async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({ 
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.job.count()
    ]);

    res.json({
      jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

app.get('/api/jobs/:id', asyncHandler(async (req: any, res: any) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

app.get('/api/jobs/:id/logs', asyncHandler(async (req: any, res: any) => {
  try {
    const logs = await prisma.jobLog.findMany({
      where: { jobId: req.params.id },
      orderBy: { timestamp: 'asc' },
    });
    res.json(logs);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

app.use((error: any, req: any, res: any, next: any) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  await redisClient.quit();
  process.exit(0);
});