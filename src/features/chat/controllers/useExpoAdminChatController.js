import { useState, useEffect, useCallback, useRef } from "react";
import { jwtDecode } from "jwt-decode";
import instance from "../../../api/lib/axios";
import { markExpoChatAsRead } from "../../../api/service/expo-admin/expoChatService";
import * as ChatWebSocketService from "../../../api/service/chat/ChatWebSocketService";
import { getChatMessages } from "../../../api/service/chat/chatService";
import { useWorkingChatScroll } from "../../../hooks/useWorkingChatScroll";
import { useMessagesRef } from "../hooks/useMessagesRef";
import { getLastReadSeq, getReaderTypeFromPayload, getMessageId } from "../utils/messageUtils";

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

  useEffect(() => {
    loadChatRooms();
    connectWebSocket();
  }, [expoId]);

  useEffect(() => {
    isInquiryActiveRef.current = true;
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
          subscribeToExpoChatRoomUpdatesFunc();
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

  const subscribeToExpoChatRoomUpdatesFunc = () => {
    if (!ChatWebSocketService.isConnected()) {
      return;
    }

    try {
      ChatWebSocketService.subscribeToExpoChatRoomUpdates(expoId, (updateData) => {
        if (
          updateData.type === "UNREAD_COUNT_UPDATE" ||
          updateData.type === "new_message"
        ) {
          const payload = updateData.payload || updateData;
          const { roomCode, unreadCount } = payload;

          setChatRooms((prev) =>
            prev.map((room) =>
              room.roomCode === roomCode
                ? { ...room, unreadCount: unreadCount || 0 }
                : room
            )
          );
        }
      });
    } catch (err) {
      console.error("채팅방 목록 업데이트 구독 실패:", err);
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

        try {
          const lastReadSeq = getLastReadSeq(initialMessages);
          await markExpoChatAsRead(expoId, room.roomCode, lastReadSeq);

          setChatRooms((prev) =>
            prev.map((r) =>
              r.roomCode === room.roomCode ? { ...r, unreadCount: 0 } : r
            )
          );
        } catch (err) {
          console.error("읽음 처리 실패:", err);
        }

        if (wsConnected && ChatWebSocketService.isConnected()) {
          try {
            ChatWebSocketService.onMessage(room.roomCode, (newMessage) => {
              if (
                !isInquiryActiveRef.current ||
                activeRoomRef.current !== room.roomCode
              ) {
                return;
              }

              if (
                newMessage.type === "MESSAGE" ||
                newMessage.type === "ADMIN_MESSAGE" ||
                !newMessage.type
              ) {
                const messageRoomCode =
                  newMessage.payload?.roomCode ||
                  newMessage.payload?.roomId ||
                  newMessage.roomCode ||
                  newMessage.roomId;

                if (messageRoomCode === room.roomCode) {
                  const messageData = {
                    id: newMessage.payload?.messageId || newMessage.messageId,
                    seq: newMessage.payload?.seq || newMessage.seq,
                    content: newMessage.payload?.content || newMessage.content,
                    senderId: newMessage.payload?.senderId || newMessage.senderId,
                    senderType:
                      newMessage.payload?.senderType ||
                      newMessage.senderType ||
                      "USER",
                    senderName:
                      newMessage.payload?.senderName || newMessage.senderName,
                    sentAt: newMessage.payload?.sentAt || newMessage.sentAt,
                    unreadCount:
                      newMessage.payload?.unreadCount !== undefined
                        ? newMessage.payload?.unreadCount
                        : newMessage.unreadCount !== undefined
                        ? newMessage.unreadCount
                        : 1,
                  };

                  addMessage(messageData);

                  const isMyMessage =
                    messageData.senderType === "ADMIN" &&
                    messageData.senderId === currentUserId;
                  if (messageData.senderType === "USER" && !isMyMessage) {
                    const rawSeq = messageData.seq;
                    const lastReadSeq =
                      typeof rawSeq === "number"
                        ? rawSeq
                        : typeof rawSeq === "string"
                        ? Number(rawSeq)
                        : null;
                    if (Number.isFinite(lastReadSeq)) {
                      markExpoChatAsRead(expoId, room.roomCode, lastReadSeq).catch(
                        (err) => console.error("읽음 처리 실패:", err)
                      );
                    }
                  }
                }
              }

              if (newMessage.type === "admin_assignment_update") {
                const payload = newMessage.payload || newMessage;

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
              }
            });

            ChatWebSocketService.subscribeToUnreadUpdates(
              room.roomCode,
              (updateData) => {
                if (updateData.type === "READ_STATUS_UPDATE") {
                  const payload = updateData.payload || updateData;
                  const readerType = getReaderTypeFromPayload(payload);

                  if (readerType === "USER") {
                    try {
                      const currentMessages = messagesRef.current;
                      const adminMessages = currentMessages.filter((msg) => {
                        const isAdminMsg =
                          msg.senderType === "ADMIN" ||
                          msg.senderType === "PLATFORM_ADMIN";
                        return isAdminMsg && msg.unreadCount > 0;
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
    [selectedRoom, wsConnected, resetMessages, loadInitialMessages, addMessage]
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
