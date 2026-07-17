-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "captionStyle" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "shortTitle" TEXT,
ADD COLUMN     "showShortTitle" BOOLEAN NOT NULL DEFAULT false;
