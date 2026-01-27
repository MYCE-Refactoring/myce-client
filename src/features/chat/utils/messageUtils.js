export const getLastReadSeq = (messageList) => {
  if (!messageList || messageList.length === 0) {
    return null;
  }

  return messageList.reduce((maxSeq, message) => {
    const seq = message?.seq;
    const seqValue =
      typeof seq === "number"
        ? seq
        : typeof seq === "string"
        ? Number(seq)
        : null;
    if (!Number.isFinite(seqValue)) {
      return maxSeq;
    }
    if (maxSeq === null || seqValue > maxSeq) {
      return seqValue;
    }
    return maxSeq;
  }, null);
};

export const getMessageId = (message) => message?.id || message?.messageId || null;

export const getReaderTypeFromPayload = (payload) =>
  payload?.readerType || payload?.messageReaderType || null;

export const getRoomCodeFromPayload = (payload, fallback) =>
  payload?.roomCode || fallback?.roomCode || null;

export const getUnreadCountFromPayload = (payload) => {
  if (!payload) {
    return undefined;
  }
  const count = payload.unreadCount ?? payload.unReadCount;
  return typeof count === "number" ? count : undefined;
};
