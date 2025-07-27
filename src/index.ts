import express from 'express';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '../generated/prisma';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const prisma = new PrismaClient();
app.use(express.json());
app.use(cors());

const jobs = new Map();

app.post('/api/jobs', async (req, res) => {
  const { command, args = [], priority = 'medium', timeout = 60 } = req.body;
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

  runJob(job);

  res.json({ jobId: id });
});

app.post('/api/jobs/:id/cancel', async (req, res) => {
  const jobId = req.params.id;
  const record = jobs.get(jobId);
  if (record) {
    record.process.kill();
    clearTimeout(record.timeout);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'cancelled' } });
    jobs.delete(jobId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Job not running or already completed' });
  }
});

app.get('/api/jobs', async (_req, res) => {
  const allJobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(allJobs);
});

app.get('/api/jobs/:id/logs', async (req, res) => {
  const logs = await prisma.jobLog.findMany({
    where: { jobId: req.params.id },
    orderBy: { timestamp: 'asc' }
  });
  res.json(logs);
});

async function runJob(job:any) {
  await prisma.job.update({ where: { id: job.id }, data: { status: 'running', startedAt: new Date() } });

  const child = spawn(job.command, job.parameters);

  const timeout = setTimeout(() => {
    child.kill();
  }, job.timeout * 1000);

  jobs.set(job.id, { process: child, timeout });

  child.stdout.on('data', async (data) => {
    const message = data.toString();
    io.emit(`log:${job.id}`, message);
    await prisma.jobLog.create({ data: { jobId: job.id, message } });
  });

  child.stderr.on('data', async (data) => {
    const message = data.toString();
    io.emit(`log:${job.id}`, message);
    await prisma.jobLog.create({ data: { jobId: job.id, message } });
  });

  child.on('close', async (code) => {
    clearTimeout(timeout);
    jobs.delete(job.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: code === 0 ? 'completed' : 'failed',
        completedAt: new Date(),
        exitCode: code,
      },
    });
  });
}

server.listen(4000, () => console.log('Server running on http://localhost:4000'))

