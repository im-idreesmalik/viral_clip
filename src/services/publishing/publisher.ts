/**
 * Executes a single Publication: refreshes credentials if needed, resolves the
 * rendered clip file, calls the platform provider, and records the outcome.
 *
 * Designed to be driven by the publish worker (BullMQ). Throws on a retryable
 * failure so the queue retries with backoff; records a terminal failure
 * otherwise.
 */
import { PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { decrypt, decryptMaybe, encrypt, encryptMaybe } from "@/lib/crypto";
import { resolveKey } from "@/lib/storage";
import { enqueuePublish } from "@/lib/queue";
import { getProvider, PublishError } from "@/services/social";
import type { AccountContext } from "@/services/social/types";

const log = createLogger("publisher");

/** Absolute, public URL for a stored media key (needed by IG/FB pull upload).
 *  Media is served at the `/api/media/<key>` route, so the path must include it. */
function absoluteMediaUrl(key: string): string {
  const base = (env.mediaPublicBase || env.appUrl).replace(/\/$/, "");
  return `${base}/api/media/${key}`;
}

async function recordLog(
  publicationId: string,
  level: "info" | "warn" | "error",
  message: string,
  data?: unknown,
) {
  await prisma.publicationLog.create({
    data: { publicationId, level, message, data: (data as object) ?? undefined },
  });
}

export async function executePublication(publicationId: string): Promise<void> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    include: { clip: true, socialAccount: true },
  });
  if (!publication) throw new Error(`Publication ${publicationId} not found`);

  if (
    publication.status === PublicationStatus.PUBLISHED ||
    publication.status === PublicationStatus.CANCELLED
  ) {
    log.info("Skipping publication in terminal state", { publicationId, status: publication.status });
    return;
  }

  const { clip, socialAccount } = publication;
  if (!clip.storageKey) {
    await terminalFail(publicationId, "Clip has not been rendered yet.");
    return;
  }

  await prisma.publication.update({
    where: { id: publicationId },
    data: { status: PublicationStatus.PUBLISHING, attempts: { increment: 1 } },
  });
  await recordLog(publicationId, "info", `Publishing to ${publication.platform}`);

  const provider = getProvider(publication.platform);
  if (!provider.isConfigured()) {
    await terminalFail(publicationId, `${publication.platform} app credentials are not configured.`);
    return;
  }

  try {
    const account = await buildAccountContext(socialAccount.id);

    const result = await provider.publish({
      filePath: resolveKey(clip.storageKey),
      publicUrl: absoluteMediaUrl(clip.storageKey),
      caption: publication.caption ?? clip.title,
      title: clip.title,
      account,
    });

    await prisma.publication.update({
      where: { id: publicationId },
      data: {
        status: PublicationStatus.PUBLISHED,
        publishedAt: new Date(),
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        lastError: null,
      },
    });
    await recordLog(publicationId, "info", "Published successfully", result);
    log.info("Publication complete", { publicationId, platform: publication.platform });

    // Sequential "Publish All": kick off the next clip in this batch.
    await enqueueNextInBatch(publication);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof PublishError ? err.retryable : false;
    await recordLog(publicationId, "error", message);

    if (retryable) {
      // Leave as QUEUED so the worker's retry picks it up; rethrow for BullMQ.
      await prisma.publication.update({
        where: { id: publicationId },
        data: { status: PublicationStatus.QUEUED, lastError: message },
      });
      log.warn("Retryable publish failure", { publicationId, message });
      throw err;
    }

    await terminalFail(publicationId, message);
  }
}

/**
 * Sequential "Publish All": once a clip in a batch publishes successfully,
 * enqueue the NEXT clip in that batch (after the configured interval). A
 * failure never calls this, so the chain halts until the failed clip is retried
 * — at which point its success resumes the chain from where it stopped.
 */
async function enqueueNextInBatch(pub: {
  batchId: string | null;
  batchSeq: number | null;
  batchIntervalMin: number | null;
}) {
  if (!pub.batchId || pub.batchSeq == null) return;
  const next = await prisma.publication.findFirst({
    where: {
      batchId: pub.batchId,
      batchSeq: pub.batchSeq + 1,
      status: PublicationStatus.SCHEDULED,
    },
  });
  if (!next) return;

  const delayMs = (pub.batchIntervalMin ?? 0) * 60_000;
  await prisma.publication.update({
    where: { id: next.id },
    data:
      delayMs > 0
        ? { publishAt: new Date(Date.now() + delayMs) }
        : { status: PublicationStatus.QUEUED },
  });
  await enqueuePublish(next.id, delayMs);
  log.info("Enqueued next clip in batch", {
    batchId: pub.batchId,
    nextSeq: pub.batchSeq + 1,
    delayMs,
  });
}

async function terminalFail(publicationId: string, message: string) {
  await prisma.publication.update({
    where: { id: publicationId },
    data: { status: PublicationStatus.FAILED, lastError: message },
  });
  await recordLog(publicationId, "error", `Failed: ${message}`);
  log.error("Publication failed", { publicationId, message });
}

/**
 * Decrypt stored credentials and, if the access token is expired and the
 * provider supports refresh, rotate + persist a fresh one.
 */
async function buildAccountContext(socialAccountId: string): Promise<AccountContext> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  const provider = getProvider(account.platform);

  let accessToken = decrypt(account.accessTokenEnc);
  const refreshToken = decryptMaybe(account.refreshTokenEnc);

  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (expired && provider.refresh && refreshToken) {
    try {
      const refreshed = await provider.refresh({
        externalId: account.externalId,
        accessToken,
        refreshToken,
        meta: account.meta as Record<string, unknown> | null,
      });
      accessToken = refreshed.accessToken;
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: encrypt(refreshed.accessToken),
          refreshTokenEnc: refreshed.refreshToken ? encryptMaybe(refreshed.refreshToken) : undefined,
          tokenExpiresAt: refreshed.expiresAt ?? null,
        },
      });
      log.info("Refreshed access token", { platform: account.platform });
    } catch (err) {
      log.warn("Token refresh failed; attempting with existing token", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    externalId: account.externalId,
    accessToken,
    refreshToken,
    meta: account.meta as Record<string, unknown> | null,
  };
}
