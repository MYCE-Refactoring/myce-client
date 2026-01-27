import { useState, useEffect, useCallback, useRef } from "react";
import instance from "../../../api/lib/axios";
import * as ChatWebSocketService from "../../../api/service/chat/ChatWebSocketService";
import {
  getAllUnreadCounts,
  markAsRead,
  getChatMessages,
} from "../../../api/service/chat/chatService";
import { useWorkingChatScroll } from "../../../hooks/useWorkingChatScroll";
import { jwtDecode } from "jwt-decode";
import { useMessagesRef } from "../hooks/useMessagesRef";
import {
  getLastReadSeq,
  getReaderTypeFromPayload,
  getRoomCodeFromPayload,
  getUnreadCountFromPayload,
  getMessageId,
  getReadSeqFromPayload,
} from "../utils/messageUtils";

export const useUserChatController = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [buttonStates, setButtonStates] = useState({});
  const [currentUserId, setCurrentUserId] = useState(null);
  const [error, setError] = useState(null);
  const [afterRedisResults, setAfterRedisResults] = useState({
    messageLoad: [],
    messageSend: [],
    unreadCount: [],
  });
  const [cacheWarmedRooms, setCacheWarmedRooms] = useState(new Set());
  const lastReadStatusRefetchAt = useRef(new Map());

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

  const isPlatformRoom = (room) => {
    return (
      room &&
      (room.expoTitle === "플랫폼 상담" ||
        room.roomCode?.startsWith("platform-"))
    );
  };

  const getCurrentButtonState = (roomCode) => {
    return buttonStates[roomCode] || "AI_ACTIVE";
  };

  const getButtonText = (state) => {
    switch (state) {
      case "AI_ACTIVE":
        return "상담원 연결";
      case "WAITING_FOR_ADMIN":
        return "요청 취소";
      case "ADMIN_ACTIVE":
        return "AI로 돌아가기";
      default:
        return "상담원 연결";
    }
  };

  const getRoomStateDescription = (state) => {
    switch (state) {
      case "AI_ACTIVE":
        return "🤖 AI 상담중";
      case "WAITING_FOR_ADMIN":
        return "⏳ 상담원 대기중";
      case "ADMIN_ACTIVE":
        return "👨‍💼 상담원 연결됨";
      default:
        return "🤖 AI 상담중";
    }
  };

  const getButtonAction = (state) => {
    switch (state) {
      case "AI_ACTIVE":
        return "request-handoff";
      case "WAITING_FOR_ADMIN":
        return "cancel-handoff";
      case "ADMIN_ACTIVE":
        return "request-ai";
      default:
        return "request-handoff";
    }
  };

  useEffect(() => {
    const initializeWebSocket = async () => {
      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          console.warn("로그인 토큰이 없습니다");
          return;
        }

        const decodedToken = jwtDecode(token);
        const userId = decodedToken.memberId;
        setCurrentUserId(userId);

        console.log("WebSocket 연결 시도...", userId);
        await ChatWebSocketService.connect(token, userId);
        setWsConnected(true);
        console.log("WebSocket 연결 성공");
      } catch (error) {
        console.error("WebSocket 연결 실패:", error);
      }
    };

    const fetchChatRooms = async () => {
      try {
        const response = await instance.get("/chats/rooms");
        const rooms = response.data.chatRooms;
        setChatRooms(rooms);

        const initialButtonStates = {};
        rooms.forEach((room) => {
          if (isPlatformRoom(room)) {
            const backendState = room.currentState || "AI_ACTIVE";
            initialButtonStates[room.roomCode] = backendState;
            console.log(
              "🔄 초기 상태 동기화 - roomCode:",
              room.roomCode,
              "backendState:",
              backendState
            );
          }
        });
        setButtonStates(initialButtonStates);

        if (rooms.length > 0) {
          setSelectedRoom(rooms[0]);
        }
      } catch (error) {
        console.error("채팅방 목록 조회 실패:", error);
        setError("채팅방을 불러올 수 없습니다.");
      } finally {
        setLoading(false);
      }
    };

    const fetchUnreadCounts = async () => {
      try {
        console.log("🔍 [After Redis] 미읽음 카운트 조회 시작");
        const startTime = performance.now();

        const response = await getAllUnreadCounts();

        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🚀 [After Redis] 미읽음 카운트 완료: ${duration.toFixed(2)}ms`);

        const existingData = JSON.parse(
          localStorage.getItem("afterRedis_unreadCount") || "[]"
        );
        existingData.push(duration);
        localStorage.setItem(
          "afterRedis_unreadCount",
          JSON.stringify(existingData)
        );

        const counts = {};
        response.data.unreadCounts.forEach((item) => {
          counts[item.roomCode] = item.unreadCount;
        });
        setUnreadCounts(counts);
      } catch (error) {
        console.error("❌ [After Redis] 읽지 않은 메시지 개수 조회 실패:", error);
      }
    };

    initializeWebSocket();
    fetchChatRooms();
    fetchUnreadCounts();

    return () => {
      ChatWebSocketService.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!selectedRoom) {
      console.log("선택된 채팅방이 없음");
      resetMessages();
      return;
    }

    const roomCode = selectedRoom.roomCode;
    if (!roomCode) return;

    const loadRoomMessages = async () => {
      try {
        const startTime = performance.now();
        const isFirstAccess = !cacheWarmedRooms.has(roomCode);

        resetMessages();
        const initialMessages = await loadInitialMessages(roomCode);

        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(
          `🚀 [After Redis] 메시지 조회 완료: ${duration.toFixed(2)}ms`
        );

        if (isFirstAccess) {
          setCacheWarmedRooms((prev) => new Set([...prev, roomCode]));
          setAfterRedisResults((prev) => ({
            ...prev,
            messageLoad: [...prev.messageLoad, duration],
          }));

          const existingData = JSON.parse(
            localStorage.getItem("afterRedis_messageLoad") || "[]"
          );
          existingData.push(duration);
          localStorage.setItem(
            "afterRedis_messageLoad",
            JSON.stringify(existingData)
          );
        }

        if (initialMessages.length > 0) {
          const lastReadSeq = getLastReadSeq(initialMessages);
          await handleMarkAsRead(roomCode, lastReadSeq);
        }
      } catch (error) {
        console.error("메시지 로딩 실패:", error);
      }
    };

    loadRoomMessages();

    const joinRoomAndSubscribe = async () => {
      if (selectedRoom && wsConnected) {
        try {
          ChatWebSocketService.onMessage(
            selectedRoom.roomCode,
            (message) => {
              if (
                message.type === "BUTTON_STATE_UPDATE" &&
                isPlatformRoom(selectedRoom)
              ) {
                const newState = message.payload?.state;
                if (newState) {
                  setButtonStates((prev) => ({
                    ...prev,
                    [selectedRoom.roomCode]: newState,
                  }));
                }
                return;
              }

              if (message.roomState && isPlatformRoom(selectedRoom)) {
                const newState = message.roomState.current;
                console.log("🏠 Room state update received:", {
                  roomCode: selectedRoom.roomCode,
                  newState,
                  reason: message.roomState.transitionReason,
                  timestamp: message.roomState.timestamp,
                });

                setButtonStates((prev) => ({
                  ...prev,
                  [selectedRoom.roomCode]: newState,
                }));
              }
              console.log("@@@@@@@ New message!!! ", message);
              const resolvedMessageId = message.id || message.messageId;
              const newMessage = {
                ...message,
                id: resolvedMessageId,
                messageId: resolvedMessageId,
                seq: message.seq ?? message.payload?.seq,
                unreadCount: message.unreadCount,
              };

              console.log("🔍 메시지 분기 체크:", {
                messageSenderId: message.senderId,
                currentUserId,
                senderType: message.senderType,
                senderName: message.senderName,
                isMyMessage:
                  message.senderId === currentUserId &&
                  message.senderType === "USER",
                fullMessage: message,
              });

              const currentMessages = messagesRef.current;
              let didMergeOptimistic = false;
              if (
                message.senderType === "USER" &&
                message.senderId === currentUserId &&
                currentMessages.length > 0
              ) {
                const messageSentAt = newMessage.sentAt
                  ? new Date(newMessage.sentAt).getTime()
                  : null;
                const tempMatch = currentMessages.find((msg) => {
                  if (!msg?.clientTemp) {
                    return false;
                  }
                  if (
                    msg.senderType !== "USER" ||
                    msg.senderId !== currentUserId
                  ) {
                    return false;
                  }
                  if (msg.content !== newMessage.content) {
                    return false;
                  }
                  if (!messageSentAt || !msg.sentAt) {
                    return true;
                  }
                  const tempSentAt = new Date(msg.sentAt).getTime();
                  return Math.abs(tempSentAt - messageSentAt) <= 5000;
                });

                if (tempMatch && tempMatch.id) {
                  updateMessage(tempMatch.id, {
                    ...newMessage,
                    clientTemp: false,
                  });
                  didMergeOptimistic = true;
                }
              }

              if (!didMergeOptimistic) {
                console.log("✅ USER SIDE - 메시지 추가:", newMessage);
                addMessage(newMessage);
              }

              const token = localStorage.getItem("access_token");
              if (token) {
                try {
                  const decoded = jwtDecode(token);
                  const currentUserId = decoded.memberId;

                  if (
                    message.senderType === "USER" &&
                    message.senderId === currentUserId
                  ) {
                    console.log(
                      "내가 보낸 메시지라 읽음 처리 요청 생략"
                    );
                    return;
                  }

                  console.log("상대방 메시지 자동 읽음 처리 시작");
                  setTimeout(async () => {
                    const lastReadSeq =
                      typeof message.seq === "number" ? message.seq : null;
                    await handleMarkAsRead(selectedRoom.roomCode, lastReadSeq);
                  }, 100);
                } catch (error) {
                  console.error("토큰 디코딩 실패:", error);
                }
              }
            }
          );

          if (isPlatformRoom(selectedRoom)) {
            ChatWebSocketService.subscribeToButtonUpdates(
              selectedRoom.roomCode,
              (buttonData) => {
                console.log("버튼 상태 업데이트:", buttonData);
                if (buttonData.type === "BUTTON_STATE_UPDATE") {
                  const { roomId, state } = buttonData.payload;
                  setButtonStates((prev) => ({
                    ...prev,
                    [roomId]: state,
                  }));
                }
              }
            );
          }

          ChatWebSocketService.subscribeToUnreadUpdates(
            selectedRoom.roomCode,
            (unreadData) => {
              if (unreadData.type === "READ_STATUS_UPDATE") {
                const payload = unreadData.payload || unreadData;
                const readerType = getReaderTypeFromPayload(payload);
                const messageId = payload.messageId || unreadData.messageId;
                const currentMessages = messagesRef.current;
                const readSeq = getReadSeqFromPayload(payload, unreadData);

                if (readerType === "ADMIN" || readerType === "AI") {
                  try {
                    if (Number.isFinite(readSeq)) {
                      currentMessages.forEach((msg) => {
                        const isMyMsg =
                          msg.senderType === "USER" &&
                          msg.senderId === currentUserId;
                        if (!isMyMsg) {
                          return;
                        }
                        const rawSeq = msg.seq;
                        const msgSeq =
                          typeof rawSeq === "number"
                            ? rawSeq
                            : typeof rawSeq === "string"
                            ? Number(rawSeq)
                            : null;
                        if (!Number.isFinite(msgSeq) || msgSeq > readSeq) {
                          return;
                        }
                        if (msg.unreadCount > 0) {
                          const targetId = getMessageId(msg);
                          if (targetId) {
                            updateMessage(targetId, { unreadCount: 0 });
                          }
                        }
                      });
                    } else if (messageId) {
                      const target = currentMessages.find(
                        (msg) => getMessageId(msg) === messageId
                      );
                      const isMyMessage =
                        target &&
                        target.senderType === "USER" &&
                        target.senderId === currentUserId;
                      if (isMyMessage) {
                        updateMessage(messageId, { unreadCount: 0 });
                      }
                    } else {
                      currentMessages.forEach((msg) => {
                        const isMyMsg =
                          msg.senderType === "USER" &&
                          msg.senderId === currentUserId;
                        if (isMyMsg && msg.unreadCount > 0) {
                          const targetId = getMessageId(msg);
                          if (targetId) {
                            updateMessage(targetId, { unreadCount: 0 });
                          }
                        }
                      });
                    }

                    const roomCode =
                      getRoomCodeFromPayload(payload, unreadData) ||
                      selectedRoom?.roomCode ||
                      null;
                    if (roomCode) {
                      console.log(`🔄 즉시 unreadCounts 업데이트: ${roomCode} → 0`);
                      setUnreadCounts((prev) => ({
                        ...prev,
                        [roomCode]: 0,
                      }));
                    }
                  } catch (error) {
                    console.error(
                      "Failed to update read status:",
                      error
                    );
                  }
                }
                return;
              }

              const payload = unreadData.payload || unreadData;
              const readerType = getReaderTypeFromPayload(payload);
              if (readerType && readerType !== "USER") {
                return;
              }
              const roomCode = getRoomCodeFromPayload(payload, unreadData);
              const unreadCount = getUnreadCountFromPayload(payload);
              if (roomCode && typeof unreadCount === "number") {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [roomCode]: unreadCount,
                }));
              }
            }
          );

          console.log("채팅방 구독 완료:", selectedRoom.roomCode);
          await ChatWebSocketService.joinRoom(selectedRoom.roomCode);
        } catch (error) {
          console.error("채팅방 구독 실패:", error);
        }
      }
    };

    joinRoomAndSubscribe();

    return () => {
      if (selectedRoom) {
        ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
      }
    };
  }, [selectedRoom, wsConnected]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedRoom || !wsConnected) return;

    try {
      const content = newMessage.trim();
      const roomCode = selectedRoom.roomCode;
      const token = localStorage.getItem("access_token");
      if (!token) return;

      const decodedToken = jwtDecode(token);
      const userId = decodedToken.memberId;
      const currentTime = new Date();
      const messagePayload = {
        roomCode: roomCode,
        content: content,
        senderId: userId,
        senderType: "USER",
        sentAt: currentTime.toISOString(),
      };

      const startTime = performance.now();
      ChatWebSocketService.sendMessage(roomCode, content);
      setNewMessage("");

      setTimeout(() => {
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🚀 [After Redis] 메시지 전송 완료: ${duration.toFixed(2)}ms`);

        setAfterRedisResults((prev) => ({
          ...prev,
          messageSend: [...prev.messageSend, duration],
        }));

        const existingData = JSON.parse(
          localStorage.getItem("afterRedis_messageSend") || "[]"
        );
        existingData.push(duration);
        localStorage.setItem(
          "afterRedis_messageSend",
          JSON.stringify(existingData)
        );
      }, 100);

      addMessage({
        ...messagePayload,
        id: `temp-${Date.now()}`,
        clientTemp: true,
        unreadCount: 0,
      });
    } catch (error) {
      console.error("메시지 전송 실패:", error);
      setError("메시지 전송에 실패했습니다.");
    }
  };

  const handleMarkAsRead = async (roomCode, lastReadSeq = null) => {
    try {
      console.log("읽음 처리 시작:", roomCode);

      const effectiveLastReadSeq =
        lastReadSeq ?? getLastReadSeq(messagesRef.current);
      const response = await markAsRead(roomCode, effectiveLastReadSeq);
      console.log("읽음 처리 API 응답:", response);

      setUnreadCounts((prev) => ({
        ...prev,
        [roomCode]: 0,
      }));

      console.log("Marking messages as read for room:", roomCode);

      if (ChatWebSocketService.isConnected()) {
        console.log("WebSocket 읽음 알림 전송 시도:", roomCode);
        ChatWebSocketService.sendReadStatusNotification(roomCode);
      } else {
        console.log("WebSocket 연결되지 않아 읽음 알림 전송 못함");
      }

      console.log("읽음 처리 완료:", roomCode);
    } catch (error) {
      console.error("읽음 처리 실패:", error);
    }
  };

  const handleRoomSelect = async (room) => {
    setSelectedRoom(room);
  };

  const handlePlatformButtonClick = async (roomCode, action) => {
    if (!wsConnected) {
      console.warn("WebSocket 연결이 없어 버튼 액션 불가");
      return;
    }

    try {
      console.log("플랫폼 버튼 액션 실행:", { roomCode, action });

      switch (action) {
        case "request-handoff":
          await ChatWebSocketService.requestHandoff(roomCode);
          break;
        case "cancel-handoff":
          await ChatWebSocketService.cancelHandoff(roomCode);
          break;
        case "request-ai":
          await ChatWebSocketService.requestAI(roomCode);
          break;
        default:
          console.warn("알 수 없는 버튼 액션:", action);
      }
    } catch (error) {
      console.error("플랫폼 버튼 액션 실패:", error);
    }
  };

  const getRoomTitle = (room) => room.expoTitle || "박람회명 없음";

  const getRoomAvatar = (room) => {
    const isCurrentlyPlatform = isPlatformRoom(room);
    const currentButtonState = getCurrentButtonState(room.roomCode);
    const isAIActive =
      currentButtonState === "AI_ACTIVE" ||
      currentButtonState === "WAITING_FOR_ADMIN";

    if (isCurrentlyPlatform) {
      return isAIActive
        ? "https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f916/u1f916_u1f42d.png"
        : "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg";
    }

    return "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg";
  };

  const getRoomPriority = (room) => {
    const currentButtonState = getCurrentButtonState(room.roomCode);
    if (currentButtonState === "WAITING_FOR_ADMIN") return 3;
    if (currentButtonState === "ADMIN_ACTIVE") return 2;
    return 1;
  };

  const getRoomBadges = (room) => {
    const currentButtonState = getCurrentButtonState(room.roomCode);
    if (!isPlatformRoom(room)) return [];

    const badges = [];
    if (currentButtonState === "WAITING_FOR_ADMIN") {
      badges.push("⏳");
    }
    if (currentButtonState === "ADMIN_ACTIVE") {
      badges.push("👨‍💼");
    }
    return badges;
  };

  const getRoomClassName = (room) => {
    if (!isPlatformRoom(room)) return "";
    const currentButtonState = getCurrentButtonState(room.roomCode);
    if (currentButtonState === "WAITING_FOR_ADMIN") return "waitingRoom";
    if (currentButtonState === "ADMIN_ACTIVE") return "activeRoom";
    return "";
  };

  const getRoomTitleClassName = (room) => {
    if (!isPlatformRoom(room)) return "";
    const currentButtonState = getCurrentButtonState(room.roomCode);
    if (currentButtonState === "WAITING_FOR_ADMIN") return "waitingTitle";
    if (currentButtonState === "ADMIN_ACTIVE") return "activeTitle";
    return "";
  };

  return {
    chatRooms,
    loading,
    selectedRoom,
    newMessage,
    wsConnected,
    unreadCounts,
    buttonStates,
    currentUserId,
    error,
    afterRedisResults,
    cacheWarmedRooms,
    messages,
    loadingMessages,
    loadingOlder,
    hasMore,
    messageError,
    messagesContainerRef,
    messagesEndRef,
    loadInitialMessages,
    handleScroll,
    scrollToBottom,
    addMessage,
    updateMessage,
    resetMessages,
    isNearBottom,
    isInitialLoad,
    setNewMessage,
    handleSendMessage,
    handleRoomSelect,
    handlePlatformButtonClick,
    getCurrentButtonState,
    getButtonText,
    getRoomStateDescription,
    getButtonAction,
    getRoomTitle,
    getRoomAvatar,
    getRoomPriority,
    getRoomBadges,
    getRoomClassName,
    getRoomTitleClassName,
    isPlatformRoom,
  };
};
