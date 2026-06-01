// src/lib/zernio/send-comment-reply.ts
// Replies publicly to a comment through Zernio's unified comments API.

import { zernioFetchJson } from './client'

interface SendCommentReplyResult {
  commentId: string
}

interface ZernioCommentReplyResponse {
  success?: boolean
  data?: {
    commentId?: string
    isReply?: boolean
    cid?: string | null
  }
}

export async function sendZernioCommentReply({
  postId,
  accountId,
  commentId,
  text,
  apiKey,
}: {
  postId: string
  accountId: string
  commentId?: string
  text: string
  apiKey: string
}): Promise<SendCommentReplyResult> {
  const data = await zernioFetchJson<ZernioCommentReplyResponse>(
    `/inbox/comments/${encodeURIComponent(postId)}`,
    'POST',
    {
      accountId,
      message: text,
      ...(commentId ? { commentId } : {}),
    },
    apiKey,
  )

  return { commentId: data.data?.commentId ?? '' }
}
