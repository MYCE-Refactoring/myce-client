import { useState, useEffect, useCallback, useRef } from "react";
import { jwtDecode } from "jwt-decode";
import instance from "../../../api/lib/axios";
import { markExpoChatAsRead } from "../../../api/service/expo-admin/expoChatService";
import * as ChatWebSocketService from "../../../api/service/chat/ChatWebSocketService";
import { getChatMessages } from "../../../api/service/chat/chatService";
import { useWorkingChatScroll } from "../../../hooks/useWorkingChatScroll";
import { useMessagesRef } from "../hooks/useMessagesRef";
import {
  getLastReadSeq,
  getReaderTypeFromPayload,
  getRoomCodeFromPayload,
  getUnreadCountFromPayload,
  getMessageId,
  getReadSeqFromPayload,
} from "../utils/messageUtils";

export const useExpoAdminChatController = (expoId) => {
  const [chatRooms, setChatRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const isInquiryActiveRef = useRef(false);
  const activeRoomRef = useRef(null);

  const isActiveRoom = useCallback((roomCode) => {
    return (
      isInquiryActiveRef.current &&
      activeRoomRef.current &&
      activeRoomRef.current === roomCode
    );
  }, []);

  const isChatMessageType = useCallback((type) => {
    return !type || type === "MESSAGE" || type === "ADMIN_MESSAGE";
  }, []);

  const getMessageRoomCode = useCallback((message) => {
    const payload = message?.payload || message;
    return (
      payload?.roomCode ||
      payload?.roomId ||
      message?.roomCode ||
      message?.roomId ||
      null
    );
  }, []);

  const buildMessageData = useCallback((message) => {
    const payload = message?.payload || message;
    const resolvedMessageId = payload?.messageId || message?.messageId || null;

    return {
      id: resolvedMessageId,
      messageId: resolvedMessageId,
      seq: payload?.seq || message?.seq,
      content: payload?.content || message?.content,
      senderId: payload?.senderId || message?.senderId,
      senderType: payload?.senderType || message?.senderType || "USER",
      senderName: payload?.senderName || message?.senderName,
      sentAt: payload?.sentAt || message?.sentAt,
      unreadCount:
        payload?.unreadCount !== undefined
          ? payload.unreadCount
          : message?.unreadCount !== undefined
          ? message.unreadCount
          : 1,
    };
  }, []);

  const updateRoomPreview = useCallback((roomCode, messageLike) => {
    if (!roomCode) return;
    const payload = messageLike?.payload || messageLike || {};
    const content =
      payload?.content ||
      payload?.lastMessage ||
      messageLike?.content ||
      messageLike?.lastMessage;
    if (!content) return;

    const sentAt =
      payload?.sentAt ||
      payload?.lastMessageAt ||
      messageLike?.sentAt ||
      messageLike?.lastMessageAt ||
      new Date().toISOString();
    const messageId =
      payload?.messageId ||
      payload?.lastMessageId ||
      messageLike?.messageId ||
      messageLike?.lastMessageId ||
      messageLike?.id ||
      payload?.id ||
      null;

    setChatRooms((prev) =>
      prev.map((room) =>
        room.roomCode === roomCode
          ? {
              ...room,
              lastMessage: content,
              lastMessageAt: sentAt,
              lastMessageId: messageId || room.lastMessageId,
            }
          : room
      )
    );

    setSelectedRoom((prev) => {
      if (!prev || prev.roomCode !== roomCode) return prev;
      return {
        ...prev,
        lastMessage: content,
        lastMessageAt: sentAt,
        lastMessageId: messageId || prev.lastMessageId,
      };
    });
  }, []);

  const requestReadForUserMessage = useCallback(
    (messageData, roomCode) => {
      if (messageData.senderType !== "USER") {
        return;
      }

      const rawSeq = messageData.seq;
      const lastReadSeq =
        typeof rawSeq === "number"
          ? rawSeq
          : typeof rawSeq === "string"
          ? Number(rawSeq)
          : null;

      if (!Number.isFinite(lastReadSeq)) {
        return;
      }

      markExpoChatAsRead(expoId, roomCode, lastReadSeq).catch((err) =>
        console.error("읽음 처리 실패:", err)
      );
    },
    [expoId]
  );

  const handleAdminAssignmentUpdate = useCallback((payload) => {
    setChatRooms((prev) =>
      prev.map((roomItem) => {
        if (roomItem.roomCode === payload.roomCode) {
          if (roomItem.currentAdminCode === payload.currentAdminCode) {
            return roomItem;
          }

          return {
            ...roomItem,
            currentAdminCode: payload.currentAdminCode,
            adminDisplayName: payload.adminDisplayName,
          };
        }
        return roomItem;
      })
    );
  }, []);

  const {
    messages,
    loading: loadingMessages,
    loadingOlder,
    hasMore,
    error: messageError,
    containerRef: messagesContainerRef,
    messagesEndRef,
    loadInitialMessages,
    handleScroll,
    scrollToBottom,
    addMessage,
    updateMessage,
    reset: resetMessages,
    isNearBottom,
  } = useWorkingChatScroll(getChatMessages);

  const messagesRef = useMessagesRef(messages);
  const isInitialLoad = loadingMessages;

  const handleIncomingMessage = useCallback(
    (roomCode, message) => {
      if (!isActiveRoom(roomCode)) {
        return;
      }

      const messageType = message?.type;
      if (isChatMessageType(messageType)) {
        const messageRoomCode = getMessageRoomCode(message);
        if (messageRoomCode !== roomCode) {
          return;
        }

        const messageData = buildMessageData(message);
        updateRoomPreview(roomCode, messageData);
        addMessage(messageData);
        requestReadForUserMessage(messageData, roomCode);
        return;
      }

      if (
        messageType === "admin_assignment_update" ||
        messageType === "ADMIN_ASSIGNMENT_UPDATE"
      ) {
        const payload = message.payload || message;
        handleAdminAssignmentUpdate(payload);
      }
    },
    [
      addMessage,
      buildMessageData,
      getMessageRoomCode,
      handleAdminAssignmentUpdate,
      isActiveRoom,
      isChatMessageType,
      requestReadForUserMessage,
      updateRoomPreview,
    ]
  );

  useEffect(() => {
    loadChatRooms();
    connectWebSocket();
  }, [expoId]);

  useEffect(() => {
    isInquiryActiveRef.current = true;
    if (!ChatWebSocketService.isConnected()) {
      connectWebSocket();
    }
    return () => {
      isInquiryActiveRef.current = false;
      const activeRoom = activeRoomRef.current;
      if (activeRoom) {
        ChatWebSocketService.leaveRoom(activeRoom);
      }
      activeRoomRef.current = null;
    };
  }, []);

  useEffect(() => {
    const removeListener = ChatWebSocketService.addConnectionListener(
      (nextConnected) => {
        setWsConnected(nextConnected);
      }
    );
    setWsConnected(ChatWebSocketService.isConnected());

    return () => {
      removeListener();
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!isInquiryActiveRef.current) {
        return;
      }
      if (!ChatWebSocketService.isConnected()) {
        connectWebSocket();
      }
    }, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [expoId]);

  useEffect(() => {
    if (!wsConnected) return;

    const unsubscribe = ChatWebSocketService.subscribeToGlobalUnreadUpdates(
      (unreadData) => {
        const payload = unreadData.payload || unreadData;
        const readerType = getReaderTypeFromPayload(payload);
        if (readerType && readerType !== "ADMIN") {
          return;
        }
        const roomCode = getRoomCodeFromPayload(payload, unreadData);
        const unreadCount = getUnreadCountFromPayload(payload);
        if (roomCode && typeof unreadCount === "number") {
          setChatRooms((prev) =>
            prev.map((room) =>
              room.roomCode === roomCode
                ? { ...room, unreadCount: unreadCount || 0 }
                : room
            )
          );
        }
      }
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [wsConnected]);

  useEffect(() => {
    if (!wsConnected) return;

    const unsubscribe = ChatWebSocketService.subscribeToGlobalRoomUpdates(
      (updateData) => {
        if (
          updateData.type !== "ROOM_PREVIEW_UPDATE" &&
          updateData.type !== "room_preview_update"
        ) {
          return;
        }
        const payload = updateData.payload || updateData;
        const roomCode = payload.roomCode;
        if (roomCode) {
          updateRoomPreview(roomCode, payload);
        }
      }
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [wsConnected, updateRoomPreview]);

  useEffect(() => {
    return () => {
      if (selectedRoom?.roomCode) {
        ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
      }
    };
  }, [selectedRoom?.roomCode]);

  const loadChatRooms = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await instance.get(`/chats/expos/${expoId}/rooms`);
      const roomsData = response.data?.chatRooms || [];

      setChatRooms(roomsData);
    } catch (err) {
      console.error("채팅방 목록 로드 실패:", err);
      setError("채팅방 목록을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setError("인증 토큰이 없습니다.");
        return;
      }

      if (!ChatWebSocketService.isConnected()) {
        console.log("WebSocket 연결 시작...");
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.memberId);

        await ChatWebSocketService.connect(token, decodedToken.memberId);

        console.log("WebSocket 연결 완료, wsConnected 상태 업데이트");
        setWsConnected(true);

        setTimeout(() => {
          subscribeToExpoAdminUpdatesFunc();
          subscribeToUserErrorsFunc();
        }, 100);
      }
    } catch (err) {
      console.error("WebSocket 연결 실패:", err);
      setError("실시간 채팅 연결에 실패했습니다.");
      setWsConnected(false);
    }
  };

  const subscribeToExpoAdminUpdatesFunc = () => {
    if (!ChatWebSocketService.isConnected()) {
      setTimeout(() => {
        if (ChatWebSocketService.isConnected()) {
          subscribeToExpoAdminUpdatesFunc();
        }
      }, 3000);
      return;
    }

    try {
      ChatWebSocketService.subscribeToExpoAdminUpdates(expoId, (updateData) => {
        if (updateData.type === "admin_assignment_update") {
          const payload = updateData.payload || updateData;

          setChatRooms((prev) =>
            prev.map((room) => {
              if (room.roomCode === payload.roomCode) {
                if (room.currentAdminCode === payload.currentAdminCode) {
                  return room;
                }

                return {
                  ...room,
                  currentAdminCode: payload.currentAdminCode,
                  adminDisplayName: payload.adminDisplayName,
                };
              }
              return room;
            })
          );
        } else if (updateData.type === "ADMIN_RELEASED") {
          const payload = updateData.payload || updateData;
          const roomCodes = payload.roomCodes || [];

          console.log("담당자 자동 해제 알림 수신:", roomCodes);

          setChatRooms((prev) =>
            prev.map((room) => {
              if (roomCodes.includes(room.roomCode)) {
                return {
                  ...room,
                  currentAdminCode: null,
                  adminDisplayName: null,
                };
              }
              return room;
            })
          );

          if (roomCodes.length > 0) {
            console.log(
              `${roomCodes.length}개 채팅방의 담당자가 비활성으로 인해 자동 해제되었습니다.`
            );
          }
        }
      });
    } catch (err) {
      console.error("박람회 업데이트 구독 실패:", err);
    }
  };

  const subscribeToUserErrorsFunc = () => {
    if (!ChatWebSocketService.isConnected()) {
      return;
    }

    try {
      ChatWebSocketService.subscribeToUserErrors((errorData) => {
        if (errorData.errorCode === "C002") {
          setError(errorData.message || "이미 다른 관리자가 담당하고 있는 상담입니다.");
          setTimeout(() => setError(null), 3000);
        } else {
          setError(errorData.message || "메시지 전송에 실패했습니다.");
          setTimeout(() => setError(null), 3000);
        }
      });
    } catch (err) {
      console.error("개별 에러 구독 실패:", err);
    }
  };


  const handleRoomSelect = useCallback(
    async (room) => {
      if (
        selectedRoom?.roomCode &&
        wsConnected &&
        ChatWebSocketService.isConnected()
      ) {
        try {
          ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
        } catch (err) {
          console.error("이전 채팅방 구독 해제 실패:", err);
        }
      }

      setSelectedRoom(room);
      activeRoomRef.current = room?.roomCode || null;
      resetMessages();

      if (room?.roomCode) {
        const initialMessages = await loadInitialMessages(room.roomCode);

        if (wsConnected && ChatWebSocketService.isConnected()) {
          try {
            const lastReadSeq = getLastReadSeq(initialMessages);
            await markExpoChatAsRead(expoId, room.roomCode, lastReadSeq);

            setChatRooms((prev) =>
              prev.map((r) =>
                r.roomCode === room.roomCode ? { ...r, unreadCount: 0 } : r
              )
            );

            initialMessages.forEach((msg) => {
              if (msg?.senderType !== "USER") {
                return;
              }
              if ((msg?.unreadCount || 0) <= 0) {
                return;
              }
              const targetId = getMessageId(msg);
              if (targetId) {
                updateMessage(targetId, { unreadCount: 0 });
              }
            });
          } catch (err) {
            console.error("읽음 처리 실패:", err);
          }
        }

        if (wsConnected && ChatWebSocketService.isConnected()) {
          try {
            ChatWebSocketService.onMessage(room.roomCode, (newMessage) => {
              console.log('@@@@@@@ new message!!!!!!!!!! ', newMessage);
              handleIncomingMessage(room.roomCode, newMessage);
            });

            ChatWebSocketService.subscribeToUnreadUpdates(
              room.roomCode,
              (updateData) => {
                if (updateData.type === "READ_STATUS_UPDATE") {
                  const payload = updateData.payload || updateData;
                  const readerType = getReaderTypeFromPayload(payload);
                  const readSeq = getReadSeqFromPayload(payload, updateData);

                  if (readerType === "USER") {
                    try {
                      const currentMessages = messagesRef.current;
                      const adminMessages = currentMessages.filter((msg) => {
                        const isAdminMsg =
                          msg.senderType === "ADMIN" ||
                          msg.senderType === "PLATFORM_ADMIN";
                        if (!isAdminMsg || msg.unreadCount <= 0) {
                          return false;
                        }
                        if (!Number.isFinite(readSeq)) {
                          return true;
                        }
                        const rawSeq = msg.seq;
                        const msgSeq =
                          typeof rawSeq === "number"
                            ? rawSeq
                            : typeof rawSeq === "string"
                            ? Number(rawSeq)
                            : null;
                        return Number.isFinite(msgSeq) && msgSeq <= readSeq;
                      });
                      const updatedCount = adminMessages.length;

                      if (currentMessages.length === 0) {
                        if (selectedRoom && selectedRoom.roomCode) {
                          loadInitialMessages(selectedRoom.roomCode).catch(
                            console.error
                          );
                        }
                      } else if (updatedCount > 0) {
                        adminMessages.forEach((msg) => {
                          const targetId = getMessageId(msg);
                          if (targetId) {
                            updateMessage(targetId, { unreadCount: 0 });
                          }
                        });
                      } else {
                        if (selectedRoom && selectedRoom.roomCode) {
                          loadInitialMessages(selectedRoom.roomCode).catch(
                            console.error
                          );
                        }
                      }
                    } catch (error) {
                      console.error(
                        "Failed to update admin read status, falling back to immediate refetch:",
                        error
                      );
                      if (selectedRoom && selectedRoom.roomCode) {
                        loadInitialMessages(selectedRoom.roomCode).catch(
                          console.error
                        );
                      }
                    }
                  }
                  if (readerType === "ADMIN") {
                    try {
                      const currentMessages = messagesRef.current;

                      if (currentMessages.length === 0) {
                        if (selectedRoom && selectedRoom.roomCode) {
                          loadInitialMessages(selectedRoom.roomCode).catch(
                            console.error
                          );
                        }
                        return;
                      }

                      const userMessages = currentMessages.filter((msg) => {
                        if (msg.senderType !== "USER" || msg.unreadCount <= 0) {
                          return false;
                        }
                        if (!Number.isFinite(readSeq)) {
                          return true;
                        }
                        const rawSeq = msg.seq;
                        const msgSeq =
                          typeof rawSeq === "number"
                            ? rawSeq
                            : typeof rawSeq === "string"
                            ? Number(rawSeq)
                            : null;
                        return Number.isFinite(msgSeq) && msgSeq <= readSeq;
                      });

                      userMessages.forEach((msg) => {
                        const targetId = getMessageId(msg);
                        if (targetId) {
                          updateMessage(targetId, { unreadCount: 0 });
                        }
                      });
                    } catch (error) {
                      console.error("Failed to update user read status:", error);
                    }
                  }
                }
              }
            );

            await ChatWebSocketService.joinRoom(room.roomCode);
          } catch (error) {
            console.error("WebSocket 방 입장 실패:", error);
          }
        }
      }
    },
    [
      selectedRoom,
      wsConnected,
      resetMessages,
      loadInitialMessages,
      updateMessage,
      handleIncomingMessage,
    ]
  );

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim() || !selectedRoom?.roomCode || !wsConnected) return;

    try {
      ChatWebSocketService.sendAdminMessage(
        selectedRoom.roomCode,
        newMessage.trim(),
        parseInt(expoId)
      );
      setNewMessage("");
    } catch (err) {
      console.error("메시지 전송 실패:", err);
      setError("메시지 전송에 실패했습니다.");
    }
  }, [newMessage, selectedRoom, wsConnected, expoId]);

  const getRoomTitle = (room) => room.otherMemberName || "익명";

  const getRoomSubtitle = (room) => {
    if (room.currentAdminCode) {
      return `담당자: ${room.adminDisplayName || room.currentAdminCode}`;
    }
    return "미배정";
  };

  const getRoomAvatar = () =>
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg";

  return {
    chatRooms,
    selectedRoom,
    newMessage,
    loading,
    error,
    wsConnected,
    currentUserId,
    messages,
    loadingMessages,
    loadingOlder,
    hasMore,
    messageError,
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom,
    isNearBottom,
    isInitialLoad,
    setNewMessage,
    loadChatRooms,
    handleRoomSelect,
    handleSendMessage,
    getRoomTitle,
    getRoomSubtitle,
    getRoomAvatar,
  };
};
