-- CreateEnum
CREATE TYPE "FootageMode" AS ENUM ('ORIGINAL', 'GENERIC');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "footageMode" "FootageMode" NOT NULL DEFAULT 'ORIGINAL';
