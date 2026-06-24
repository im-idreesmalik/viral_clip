-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "batchIntervalMin" INTEGER,
ADD COLUMN     "batchSeq" INTEGER;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "hashtags" TEXT;

-- CreateIndex
CREATE INDEX "Publication_batchId_batchSeq_idx" ON "Publication"("batchId", "batchSeq");
