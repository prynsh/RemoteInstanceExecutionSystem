"use strict";
// import express from 'express';
// import { v4 as uuidv4 } from 'uuid';
// import cors from 'cors';
// import { PrismaClient } from '../generated/prisma';
// import { redisClient } from './redis';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// const app = express();
// const prisma = new PrismaClient();
// app.use(cors());
// app.use(express.json());
// app.post('/api/jobs', async (req, res) => {
//   const { command, args = [], priority = 'medium', timeout = 60 } = req.body;
//   const id = uuidv4();
//   const job = await prisma.job.create({
//     data: {
//       id,
//       command,
//       parameters: args,
//       priority,
//       timeout,
//       status: 'queued',
//     },
//   });
//   await redisClient.lPush('jobQueue', JSON.stringify(job));
//   res.json({ jobId: id });
// });
// app.delete('/api/jobs/:id', async (req, res) => {
//   const jobId = req.params.id;
//   await redisClient.set(`cancel:${jobId}`, '1');
//   await prisma.job.update({
//     where: { id: jobId },
//     data: { status: 'cancelled' }
//   });
//   res.json({ success: true, message: 'Cancellation requested.' });
// });
// app.get('/api/jobs', async (_req, res) => {
//   const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
//   res.json(jobs);
// });
// app.get('/api/jobs/:id/logs', async (req, res) => {
//   const logs = await prisma.jobLog.findMany({
//     where: { jobId: req.params.id },
//     orderBy: { timestamp: 'asc' },
//   });
//   res.json(logs);
// });
// app.listen(4000, () => console.log('API server running on http://localhost:4000'));
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const cors_1 = __importDefault(require("cors"));
const prisma_1 = require("../generated/prisma");
const redis_1 = require("./redis");
const zod_1 = require("zod");
const app = (0, express_1.default)();
const prisma = new prisma_1.PrismaClient();
// Input validation schemas
const createJobSchema = zod_1.z.object({
    command: zod_1.z.string().min(1).max(100),
    args: zod_1.z.array(zod_1.z.string()).default([]),
    priority: zod_1.z.enum(['low', 'medium', 'high']).default('medium'),
    timeout: zod_1.z.number().min(1).max(3600).default(60)
});
// Whitelist of allowed commands for security
const ALLOWED_COMMANDS = ['echo', 'ls', 'pwd', 'date', 'sleep'];
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
// Error handling middleware
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
app.post('/api/jobs', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { command, args, priority, timeout } = createJobSchema.parse(req.body);
        // Security check
        if (!ALLOWED_COMMANDS.includes(command)) {
            return res.status(400).json({
                error: 'Command not allowed',
                allowedCommands: ALLOWED_COMMANDS
            });
        }
        const id = (0, uuid_1.v4)();
        const job = yield prisma.job.create({
            data: {
                id,
                command,
                parameters: args,
                priority,
                timeout,
                status: 'queued',
            },
        });
        // Use priority-based queue
        const queueKey = `jobQueue:${priority}`;
        yield redis_1.redisClient.lPush(queueKey, JSON.stringify(job));
        res.json({ jobId: id, status: 'queued' });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        console.error('Error creating job:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
app.delete('/api/jobs/:id', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const jobId = req.params.id;
        if (!jobId || typeof jobId !== 'string') {
            return res.status(400).json({ error: 'Invalid job ID' });
        }
        // Check if job exists and is cancellable
        const job = yield prisma.job.findUnique({ where: { id: jobId } });
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            return res.status(400).json({ error: 'Job cannot be cancelled' });
        }
        yield Promise.all([
            redis_1.redisClient.set(`cancel:${jobId}`, '1', { EX: 3600 }), // Expire after 1 hour
            prisma.job.update({
                where: { id: jobId },
                data: { status: 'cancelled' }
            })
        ]);
        res.json({ success: true, message: 'Cancellation requested' });
    }
    catch (error) {
        console.error('Error cancelling job:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
app.get('/api/jobs', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;
        const [jobs, total] = yield Promise.all([
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
    }
    catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
app.get('/api/jobs/:id', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const job = yield prisma.job.findUnique({
            where: { id: req.params.id }
        });
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json(job);
    }
    catch (error) {
        console.error('Error fetching job:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
app.get('/api/jobs/:id/logs', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const logs = yield prisma.jobLog.findMany({
            where: { jobId: req.params.id },
            orderBy: { timestamp: 'asc' },
        });
        res.json(logs);
    }
    catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})));
// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
});
// Graceful shutdown
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Shutting down gracefully...');
    yield prisma.$disconnect();
    yield redis_1.redisClient.quit();
    process.exit(0);
}));
