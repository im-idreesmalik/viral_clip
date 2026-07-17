-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'CLAIMED', 'FAILED');

-- CreateEnum
CREATE TYPE "StorySource" AS ENUM ('AI', 'MANUAL', 'UPLOAD');

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "source" "StorySource" NOT NULL DEFAULT 'AI',
    "status" "StoryStatus" NOT NULL DEFAULT 'DRAFT',
    "text" TEXT NOT NULL,
    "ttsText" TEXT,
    "audioKey" TEXT,
    "durationSec" DOUBLE PRECISION,
    "voice" TEXT,
    "transcript" JSONB,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "generatedVideoId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Story_status_language_createdAt_idx" ON "Story"("status", "language", "createdAt");

-- CreateIndex
CREATE INDEX "Story_claimedById_idx" ON "Story"("claimedById");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

