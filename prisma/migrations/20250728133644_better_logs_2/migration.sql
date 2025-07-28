/*
  Warnings:

  - You are about to drop the `job_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "job_logs" DROP CONSTRAINT "job_logs_jobId_fkey";

-- DropTable
DROP TABLE "job_logs";

-- CreateTable
CREATE TABLE "JobLog" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
