"use strict";
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
// File: src/index.ts
const express_1 = __importDefault(require("express"));
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const prisma_1 = require("../generated/prisma");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*'
    }
});
const prisma = new prisma_1.PrismaClient();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
const jobs = new Map(); // jobId -> { process, timeout }
// Submit a job
app.post('/api/jobs', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { command, args = [], priority = 'medium', timeout = 60 } = req.body;
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
    runJob(job);
    res.json({ jobId: id });
}));
// Cancel a job
app.post('/api/jobs/:id/cancel', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const jobId = req.params.id;
    const record = jobs.get(jobId);
    if (record) {
        record.process.kill();
        clearTimeout(record.timeout);
        yield prisma.job.update({ where: { id: jobId }, data: { status: 'cancelled' } });
        jobs.delete(jobId);
        res.json({ success: true });
    }
    else {
        res.status(404).json({ error: 'Job not running or already completed' });
    }
}));
// Get job status
app.get('/api/jobs', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const allJobs = yield prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(allJobs);
}));
// Get logs for a job
app.get('/api/jobs/:id/logs', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const logs = yield prisma.jobLog.findMany({
        where: { jobId: req.params.id },
        orderBy: { timestamp: 'asc' }
    });
    res.json(logs);
}));
// Function to run a job
function runJob(job) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.job.update({ where: { id: job.id }, data: { status: 'running', startedAt: new Date() } });
        const child = (0, child_process_1.spawn)(job.command, job.parameters);
        const timeout = setTimeout(() => {
            child.kill();
        }, job.timeout * 1000);
        jobs.set(job.id, { process: child, timeout });
        child.stdout.on('data', (data) => __awaiter(this, void 0, void 0, function* () {
            const message = data.toString();
            io.emit(`log:${job.id}`, message);
            yield prisma.jobLog.create({ data: { jobId: job.id, message } });
        }));
        child.stderr.on('data', (data) => __awaiter(this, void 0, void 0, function* () {
            const message = data.toString();
            io.emit(`log:${job.id}`, message);
            yield prisma.jobLog.create({ data: { jobId: job.id, message } });
        }));
        child.on('close', (code) => __awaiter(this, void 0, void 0, function* () {
            clearTimeout(timeout);
            jobs.delete(job.id);
            yield prisma.job.update({
                where: { id: job.id },
                data: {
                    status: code === 0 ? 'completed' : 'failed',
                    completedAt: new Date(),
                    exitCode: code,
                },
            });
        }));
    });
}
server.listen(4000, () => console.log('Server running on http://localhost:3000'));
