import { useState, useEffect, useCallback, useRef } from "react";
import { getChatRooms, getChatMessages, markAsRead } from "../../../api/service/chat/chatService";
import * as ChatWebSocketService from "../../../api/service/chat/ChatWebSocketService";
import { useWorkingChatScroll } from "../../../hooks/useWorkingChatScroll";
import { useMessagesRef } from "../hooks/useMessagesRef";
import { ROOM_STATES } from "../utils/roomStates";
import {
  getLastReadSeq,
  getReaderTypeFromPayload,
  getRoomCodeFromPayload,
  getUnreadCountFromPayload,
  getMessageId,
  getReadSeqFromPayload,
} from "../utils/messageUtils";

export const usePlatformAdminChatController = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [currentUserId, setCurrentUserId] = useState(null);
  const [hasNewHandoffRequest, setHasNewHandoffRequest] = useState(false);
  const [requestingRooms, setRequestingRooms] = useState(new Set());
  const [showFailToast, setShowFailToast] = useState(false);
  const [failMessage, setFailMessage] = useState("");
  const selectedRoomRef = useRef(null);

  const triggerToastFail = useCallback((message) => {
    setFailMessage(message);
    setShowFailToast(true);
    setTimeout(() => setShowFailToast(false), 4000);
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
  const lastReadStatusRefetchAt = useRef(new Map());

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  const loadChatRooms = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getChatRooms();

      let allRooms = [];
      if (Array.isArray(response.data)) {
        allRooms = response.data;
      } else if (response.data && Array.isArray(response.data.chatRooms)) {
        allRooms = response.data.chatRooms;
      } else if (response.data && Array.isArray(response.data.content)) {
        allRooms = response.data.content;
      } else if (response.data && Array.isArray(response.data.data)) {
        allRooms = response.data.data;
      } else if (response.data && typeof response.data === "object") {
        allRooms = [];
      }

      const platformRooms = allRooms
        .filter((room) => room.roomCode?.startsWith("platform-"))
        .map((room) => {
          const finalState = determineRoomState(room);

          console.log("🎭 ROOM STATE:", room.roomCode, "→", finalState);

          return {
            ...room,
            needsAttention:
              finalState === ROOM_STATES.WAITING_FOR_ADMIN ||
              room.isWaitingForAdmin ||
              room.hasUnansweredMessages,
            currentState: finalState,
          };
        });

      platformRooms.sort((a, b) => {
        if (a.needsAttention && !b.needsAttention) return -1;
        if (!a.needsAttention && b.needsAttention) return 1;
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      });

      setChatRooms(platformRooms);
      setRequestingRooms(
        new Set(
          platformRooms
            .filter((room) => room.currentState === ROOM_STATES.WAITING_FOR_ADMIN)
            .map((room) => room.roomCode)
        )
      );

      const currentSelectedRoom = selectedRoomRef.current;
      if (currentSelectedRoom?.roomCode) {
        const refreshedRoom = platformRooms.find(
          (room) => room.roomCode === currentSelectedRoom.roomCode
        );
        if (refreshedRoom) {
          setSelectedRoom((prev) =>
            prev?.roomCode === refreshedRoom.roomCode
              ? { ...prev, ...refreshedRoom }
              : refreshedRoom
          );
        }
      }
    } catch (err) {
      console.error("채팅방 목록 로드 실패:", err);
      setError("채팅방 목록을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const determineRoomState = (room) => {
    if (!room) return ROOM_STATES.AI_ACTIVE;

    if (room.currentState) {
      return room.currentState;
    }

    if (room.isWaitingForAdmin) {
      return ROOM_STATES.WAITING_FOR_ADMIN;
    }

    if (room.hasAssignedAdmin) {
      return ROOM_STATES.ADMIN_ACTIVE;
    }

    return ROOM_STATES.AI_ACTIVE;
  };

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
    const resolvedMessageId =
      payload?.messageId || message?.messageId || message?.id || payload?.id || null;

    return {
      id: resolvedMessageId,
      messageId: resolvedMessageId,
      seq: payload?.seq || message?.seq,
      senderId: payload?.senderId || message?.senderId,
      senderType: payload?.senderType || message?.senderType || "USER",
      senderName: payload?.senderName || message?.senderName,
      content: payload?.content || message?.content,
      sentAt: payload?.sentAt || message?.sentAt,
      unreadCount:
        payload?.unreadCount !== undefined
          ? payload.unreadCount
          : message?.unreadCount !== undefined
          ? message.unreadCount
          : 0,
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

  const handleChatMessage = useCallback(
    (roomCode, message) => {
      const messageRoomCode = getMessageRoomCode(message);
      if (messageRoomCode && messageRoomCode !== roomCode) {
        return;
      }

      const messageData = buildMessageData(message);
      if (messageData.senderType === "SYSTEM") {
        console.log(
          "🎭 ROOM HANDLER - Skipping persistent system message in live WebSocket to avoid duplicate"
        );
        return;
      }

      updateRoomPreview(roomCode, messageData);
      addMessage(messageData);

      if (
        messageData.senderType === "USER" &&
        isConnected &&
        ChatWebSocketService.isConnected()
      ) {
        const rawSeq = messageData.seq;
        const lastReadSeq =
          typeof rawSeq === "number"
            ? rawSeq
            : typeof rawSeq === "string"
            ? Number(rawSeq)
            : null;
        if (Number.isFinite(lastReadSeq)) {
          markAsRead(roomCode, lastReadSeq).catch((err) =>
            console.error("플랫폼 관리자 읽음 처리 실패:", err)
          );
        }
      }
    },
    [addMessage, buildMessageData, getMessageRoomCode, isConnected, updateRoomPreview]
  );

  const handleSystemMessage = useCallback(
    (messageData, roomCode, shouldDisplayMessage = true) => {
      const roomState = messageData.roomState;
      const buttonState = messageData?.payload?.state;
      const previewPayload = messageData?.payload || messageData;
      if (previewPayload?.content) {
        updateRoomPreview(roomCode, previewPayload);
      }

      if (roomState) {
        setChatRooms((prev) =>
          prev.map((prevRoom) => {
            if (prevRoom.roomCode === roomCode) {
              const isWaitingForAdmin = roomState.current === ROOM_STATES.WAITING_FOR_ADMIN;
              return {
                ...prevRoom,
                currentState: roomState.current,
                isWaitingForAdmin,
                needsAttention:
                  isWaitingForAdmin || prevRoom.hasUnansweredMessages,
                hasAssignedAdmin: roomState.adminInfo ? true : false,
                adminDisplayName: roomState.adminInfo?.displayName || prevRoom.adminDisplayName,
                lastAdminActivity: roomState.adminInfo?.lastActivity || prevRoom.lastAdminActivity,
              };
            }
            return prevRoom;
          })
        );

        setChatRooms((prevRooms) =>
          prevRooms.map((room) => {
            if (room.roomCode === roomCode) {
              console.log(
                "🔄 UPDATING ROOM LIST STATE:",
                roomCode,
                "→",
                roomState.current
              );
              return {
                ...room,
                currentState: roomState.current,
                hasAssignedAdmin: roomState.adminInfo ? true : false,
                isWaitingForAdmin: roomState.current === "WAITING_FOR_ADMIN",
              };
            }
            return room;
          })
        );

        setSelectedRoom((prev) => {
          if (!prev || prev.roomCode !== roomCode) {
            return prev;
          }
          const nextState = roomState.current;
          const isWaiting = nextState === ROOM_STATES.WAITING_FOR_ADMIN;
          return {
            ...prev,
            currentState: nextState,
            isWaitingForAdmin: isWaiting,
            needsAttention: isWaiting || prev.hasUnansweredMessages,
            hasAssignedAdmin: roomState.adminInfo ? true : prev.hasAssignedAdmin,
            adminDisplayName: roomState.adminInfo?.displayName || prev.adminDisplayName,
            lastAdminActivity: roomState.adminInfo?.lastActivity || prev.lastAdminActivity,
          };
        });

        setRequestingRooms((prev) => {
          const next = new Set(prev);
          if (roomState.current === ROOM_STATES.WAITING_FOR_ADMIN) {
            next.add(roomCode);
          } else {
            next.delete(roomCode);
          }
          return next;
        });
      } else if (messageData?.type === "BUTTON_STATE_UPDATE" && buttonState) {
        setChatRooms((prev) =>
          prev.map((room) => {
            if (room.roomCode === roomCode) {
              const isWaiting = buttonState === ROOM_STATES.WAITING_FOR_ADMIN;
              return {
                ...room,
                currentState: buttonState,
                isWaitingForAdmin: isWaiting,
                needsAttention: isWaiting || room.hasUnansweredMessages,
              };
            }
            return room;
          })
        );

        setSelectedRoom((prev) => {
          if (!prev || prev.roomCode !== roomCode) {
            return prev;
          }
          const isWaiting = buttonState === ROOM_STATES.WAITING_FOR_ADMIN;
          return {
            ...prev,
            currentState: buttonState,
            isWaitingForAdmin: isWaiting,
            needsAttention: isWaiting || prev.hasUnansweredMessages,
          };
        });

        setRequestingRooms((prev) => {
          const next = new Set(prev);
          if (buttonState === ROOM_STATES.WAITING_FOR_ADMIN) {
            next.add(roomCode);
          } else {
            next.delete(roomCode);
          }
          return next;
        });
      }

      switch (messageData.type) {
        case "AI_HANDOFF_REQUEST":
          console.log("🔔 Handoff request detected for room:", roomCode);
          break;
        case "BUTTON_STATE_UPDATE":
          console.log("🔘 Button state update:", messageData.payload?.state);
          if (shouldDisplayMessage && messageData.payload?.content) {
            const payload = messageData.payload;
            const messageId = payload.messageId || payload.id;
            const exists = messageId
              ? messagesRef.current.some(
                  (msg) => getMessageId(msg) === messageId
                )
              : false;

            if (!exists) {
              addMessage({
                id: messageId || `state-${Date.now()}`,
                messageId: messageId,
                seq: payload.seq,
                senderId: payload.senderId || null,
                senderType: payload.senderType || "AI",
                senderName: payload.senderName,
                content: payload.content,
                sentAt: payload.sentAt || new Date().toISOString(),
                unreadCount:
                  typeof payload.unreadCount === "number"
                    ? payload.unreadCount
                    : 0,
              });
            }
          }
          break;
        case "ADMIN_ASSIGNMENT_UPDATE":
          console.log("👨‍💼 Admin assignment update:", messageData.payload);
          break;
        case "AI_MESSAGE":
          if (shouldDisplayMessage) {
            const aiMessage = {
              id: messageData.payload.messageId,
              senderId: messageData.payload.senderId,
              senderType: messageData.payload.senderType,
              senderName: messageData.payload.senderName,
              content: messageData.payload.content,
              sentAt: messageData.payload.sentAt,
              unreadCount: 0,
            };
            addMessage(aiMessage);
          }
          break;
        case "ADMIN_MESSAGE":
          if (shouldDisplayMessage) {
            const adminMessage = {
              id: messageData.payload.messageId,
              senderId: messageData.payload.senderId,
              senderType: messageData.payload.senderType,
              senderName:
                messageData.payload.senderName || messageData.payload.adminDisplayName,
              content: messageData.payload.content,
              sentAt: messageData.payload.sentAt,
              unreadCount: 0,
            };
            addMessage(adminMessage);
          }
          break;
        case "ADMIN_INTERVENTION":
          if (shouldDisplayMessage) {
            const interventionMessage = {
              id: messageData.payload.messageId,
              senderId: messageData.payload.senderId,
              senderType: messageData.payload.senderType,
              senderName: messageData.payload.adminDisplayName || "Platform Admin",
              content: messageData.payload.content,
              sentAt: messageData.payload.sentAt,
              unreadCount: 0,
            };
            addMessage(interventionMessage);
          }

          console.log("🚀 Admin intervention completed");
          break;
        case "AI_TIMEOUT_TAKEOVER":
          if (shouldDisplayMessage) {
            const timeoutMessage = {
              id: messageData.payload.messageId,
              senderId: messageData.payload.senderId,
              senderType: messageData.payload.senderType,
              senderName: messageData.payload.senderName || "AI 상담사",
              content: messageData.payload.content,
              sentAt: messageData.payload.sentAt,
              unreadCount: 0,
            };
            addMessage(timeoutMessage);
          }

          console.log("⏰ Admin timeout occurred");
          break;
        case "SYSTEM_MESSAGE":
          console.log("🎭 System message received:", messageData.payload);
          if (shouldDisplayMessage) {
            const systemMessage = {
              id: `system-${Date.now()}`,
              type: "SYSTEM_MESSAGE",
              payload: messageData.payload,
              timestamp: messageData.payload?.timestamp || new Date().toISOString(),
              sentAt: messageData.payload?.timestamp || new Date().toISOString(),
              unreadCount: 0,
            };
            console.log("🎭 Admin side - Adding system message:", systemMessage);
            addMessage(systemMessage);
          }

          if (messageData.payload?.type === "ADMIN_INTERVENTION_START") {
            console.log("🔄 System message received - state handled via WebSocket");
          }
          break;
        default:
          console.log("🤷‍♂️ Unknown system message type:", messageData.type);
      }
    },
    [setChatRooms, setSelectedRoom, setRequestingRooms, addMessage, updateRoomPreview]
  );

  const handleRoomSelect = useCallback(
    async (room) => {
      if (selectedRoom?.roomCode) {
        try {
          ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
        } catch (err) {
          console.error("이전 채팅방 구독 해제 실패:", err);
        }
      }

      setSelectedRoom(room);
      resetMessages();

      if (room?.roomCode) {
        const initialMessages = await loadInitialMessages(room.roomCode);
        if (isConnected && ChatWebSocketService.isConnected()) {
          const lastReadSeq = getLastReadSeq(initialMessages);
          await markAsRead(room.roomCode, lastReadSeq);

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
        }

        if (isConnected && ChatWebSocketService.isConnected()) {
          try {
            ChatWebSocketService.onMessage(room.roomCode, (messageData) => {
              console.log("🎯 ADMIN SIDE - Raw message received for selected room:", {
                type: messageData.type,
                senderType: messageData.senderType,
                content: messageData.content?.substring(0, 50),
                hasPayload: !!messageData.payload,
                hasRoomState: !!messageData.roomState,
                fullData: messageData,
              });

              if (isChatMessageType(messageData?.type)) {
                console.log("🔧 ROOM HANDLER - Processing as chat message");
                handleChatMessage(room.roomCode, messageData);
                return;
              }

              if (messageData.type) {
                console.log(
                  "🔧 ROOM HANDLER - Processing message via unified handler:",
                  messageData.type
                );
                handleSystemMessage(messageData, room.roomCode, true);
              }
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
                      const messagesToUpdate = currentMessages.filter((msg) => {
                        const isAdminMsg =
                          msg.senderType === "PLATFORM_ADMIN" ||
                          msg.senderType === "ADMIN";
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
                      let didUpdateLocal = false;

                      if (messagesToUpdate.length > 0) {
                        console.log(
                          `🔄 Removing ${messagesToUpdate.length} unread badges from my platform admin messages (USER read them)`
                        );

                        messagesToUpdate.forEach((msg) => {
                          const targetId = getMessageId(msg);
                          if (targetId) {
                            updateMessage(targetId, { unreadCount: 0 });
                          }
                        });
                        didUpdateLocal = true;
                      }

                      const shouldRefetch = currentMessages.length === 0;
                      if (shouldRefetch && selectedRoom && selectedRoom.roomCode) {
                        const now = Date.now();
                        const lastRefetch =
                          lastReadStatusRefetchAt.current.get(
                            selectedRoom.roomCode
                          ) || 0;
                        if (now - lastRefetch > 2000) {
                          lastReadStatusRefetchAt.current.set(
                            selectedRoom.roomCode,
                            now
                          );
                          setTimeout(async () => {
                            try {
                              console.log(
                                "🔄 Platform admin background refetch for accuracy after read status update"
                              );
                              await loadInitialMessages(selectedRoom.roomCode);
                            } catch (error) {
                              console.error(
                                "Platform admin background refetch failed:",
                                error
                              );
                            }
                          }, 1500);
                        }
                      }
                    } catch (error) {
                      console.error(
                        "Failed to update platform admin read status, falling back to immediate refetch:",
                        error
                      );
                      if (selectedRoom && selectedRoom.roomCode) {
                        loadInitialMessages(selectedRoom.roomCode).catch(console.error);
                      }
                    }
                  }
                  if (readerType === "ADMIN" || readerType === "AI") {
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
          } catch (err) {
            console.error("WebSocket 방 구독 실패:", err);
          }
        }
      }
    },
    [
      selectedRoom,
      isConnected,
      resetMessages,
      loadInitialMessages,
      updateMessage,
      handleChatMessage,
      handleSystemMessage,
      isChatMessageType,
    ]
  );

  const hasAdminPermission = useCallback((room) => {
    if (!room || !room.currentAdminCode) return true;

    const currentAdminCode = "PLATFORM_ADMIN";
    return room.currentAdminCode === currentAdminCode;
  }, []);

  const handleSendMessage = useCallback(
    async () => {
      if (!newMessage.trim() || !selectedRoom?.roomCode || !isConnected) return;

      const currentState = determineRoomState(selectedRoom);
      if (currentState === ROOM_STATES.AI_ACTIVE) {
        triggerToastFail(
          'AI 상담 중에는 직접 메시지를 보낼 수 없습니다. "개입하기" 버튼을 사용해주세요.'
        );
        return;
      }

      if (!hasAdminPermission(selectedRoom)) {
        triggerToastFail(
          `이 상담은 다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 담당하고 있습니다.`
        );
        return;
      }

      try {
        await ChatWebSocketService.sendAdminMessage(
          selectedRoom.roomCode,
          newMessage.trim(),
          null
        );
        setNewMessage("");
      } catch (err) {
        console.error("메시지 전송 실패:", err);
        if (err.response?.data?.message?.includes("권한")) {
          triggerToastFail(`상담 권한이 없습니다: ${err.response.data.message}`);
        } else if (err.response?.data?.message?.includes("개입하기")) {
          triggerToastFail(
            'AI 상담 중에는 직접 메시지를 보낼 수 없습니다. "개입하기" 버튼을 사용해주세요.'
          );
        } else {
          triggerToastFail("메시지 전송에 실패했습니다.");
        }
      }
    },
    [newMessage, selectedRoom, isConnected, hasAdminPermission, triggerToastFail]
  );

  const handleProactiveIntervention = useCallback(async () => {
    if (!selectedRoom?.roomCode) return;

    if (selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)) {
      alert(
        `다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 이미 이 상담을 담당하고 있습니다.`
      );
      return;
    }

    try {
      await ChatWebSocketService.proactiveIntervention(selectedRoom.roomCode);
    } catch (err) {
      console.error("개입하기 실패:", err);
      triggerToastFail("개입하기에 실패했습니다.");
    }
  }, [selectedRoom, hasAdminPermission, triggerToastFail]);

  const handleTakeOver = useCallback(async () => {
    if (!selectedRoom?.roomCode) return;

    if (selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)) {
      alert(
        `다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 이미 이 상담을 담당하고 있습니다.`
      );
      return;
    }

    try {
      await ChatWebSocketService.acceptHandoff(selectedRoom.roomCode);

      setRequestingRooms((prev) => {
        const newSet = new Set(prev);
        newSet.delete(selectedRoom.roomCode);
        return newSet;
      });
    } catch (err) {
      console.error("상담 인계받기 실패:", err);
      triggerToastFail("상담 인계받기에 실패했습니다.");
    }
  }, [selectedRoom, hasAdminPermission, triggerToastFail]);

  const triggerHandoffNotification = useCallback((roomCode) => {
    console.log("🔔 Triggering handoff notification...");
    setHasNewHandoffRequest(true);
    if (roomCode) {
      setRequestingRooms((prev) => {
        const next = new Set(prev);
        next.add(roomCode);
        return next;
      });
    }

    setTimeout(() => {
      loadChatRooms();
    }, 100);
  }, [loadChatRooms]);

  const connectWebSocket = useCallback(async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setError("인증 토큰이 없습니다. 다시 로그인해주세요.");
        return;
      }

      if (ChatWebSocketService.isConnected()) {
        setIsConnected(true);
        return;
      }

      const tokenPayload = JSON.parse(atob(token.split(".")[1]));
      const userId = tokenPayload.memberId;
      setCurrentUserId(userId);

      console.log("Platform admin connecting to WebSocket...", {
        userId,
        role: tokenPayload.role,
        authorities: tokenPayload.authorities,
        token: token.substring(0, 50) + "...",
      });
      await ChatWebSocketService.connect(token, userId);
      setIsConnected(true);

        console.log("🔗 Setting up platform admin notifications subscription...");
        ChatWebSocketService.subscribeToPlatformAdminUpdates((updateData) => {
          console.log("🚨 Platform admin update received:", updateData);
          const payload = updateData?.payload || updateData;
          const roomCode =
            payload?.roomCode ||
            payload?.roomId ||
            updateData?.roomCode ||
            updateData?.roomId ||
            null;

          if (
            updateData.type === "HANDOFF_REQUEST" ||
            updateData.type === "PLATFORM_HANDOFF_REQUEST" ||
            (updateData.type === "BUTTON_STATE_UPDATE" &&
              updateData.payload?.state === "WAITING_FOR_ADMIN")
          ) {
            console.log("🔔 New handoff request detected!");
            triggerHandoffNotification(roomCode);
          }

          if (roomCode && updateData?.roomState) {
            handleSystemMessage(updateData, roomCode, false);
          }
        });

      ChatWebSocketService.subscribeToUserErrors((errorData) => {
        console.log("❌ WebSocket error received:", errorData);
        if (errorData.error === "INTERVENTION_REQUIRED") {
          alert(errorData.message);
        } else if (errorData.error === "PERMISSION_DENIED") {
          alert(`권한이 없습니다: ${errorData.message}`);
        }
      });

        window.globalPlatformNotificationHandler = (data, roomCode) => {
          console.log("🔍 Global handler - checking room message for handoff:", {
            data,
            roomCode,
          });

          if (
            data.type === "AI_HANDOFF_REQUEST" ||
            data.type === "PLATFORM_HANDOFF_REQUEST" ||
            (data.type === "BUTTON_STATE_UPDATE" &&
              data.payload?.state === "WAITING_FOR_ADMIN")
          ) {
            console.log("🔔 Handoff request detected from global handler:", roomCode);
            triggerHandoffNotification(roomCode);
          }
        };
    } catch (err) {
      console.error("WebSocket 연결 실패:", err);
      setError("실시간 연결에 실패했습니다.");
      setIsConnected(false);
    }
  }, [triggerHandoffNotification, handleSystemMessage]);

  useEffect(() => {
    connectWebSocket();
    loadChatRooms();
  }, [connectWebSocket, loadChatRooms]);

  useEffect(() => {
    return () => {
      if (selectedRoom?.roomCode) {
        ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
      }
    };
  }, [selectedRoom?.roomCode]);

  useEffect(() => {
    const removeListener = ChatWebSocketService.addConnectionListener(
      (nextConnected) => {
        setIsConnected(nextConnected);
      }
    );
    setIsConnected(ChatWebSocketService.isConnected());

    return () => {
      removeListener();
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!ChatWebSocketService.isConnected()) {
        connectWebSocket();
      }
    }, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (!isConnected) return;

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
          setUnreadCounts((prev) => ({
            ...prev,
            [roomCode]: unreadCount,
          }));
        }
      }
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [isConnected]);

  useEffect(() => {
    if (isConnected && chatRooms.length > 0) {
      console.log("🌐 Setting up global message handlers for all platform rooms");
      const cleanupFunctions = [];

      chatRooms.forEach((room) => {
        if (room.roomCode && room.roomCode.startsWith("platform-")) {
          const removeHandler = ChatWebSocketService.addMessageHandler(
            room.roomCode,
            (messageData) => {
              console.log("🔔 GLOBAL - Message received for room:", room.roomCode, {
                type: messageData.type,
                fullData: messageData,
              });

              if (messageData.type) {
                handleSystemMessage(messageData, room.roomCode, false);
              } else {
                updateRoomPreview(room.roomCode, messageData);
              }
            }
          );

          cleanupFunctions.push(removeHandler);

          console.log(
            "🔗 Force joining room to ensure active subscription:",
            room.roomCode
          );
          ChatWebSocketService.joinRoom(room.roomCode);
        }
      });

      return () => {
        cleanupFunctions.forEach((cleanup) => cleanup());
      };
    }
  }, [isConnected, chatRooms, handleSystemMessage, updateRoomPreview]);

  const getRoomPriority = (room) => {
    if (room.needsAttention) return 100;
    if (room.currentState === ROOM_STATES.ADMIN_ACTIVE) return 50;
    return 0;
  };

  const filterPlatformRooms = (rooms) =>
    rooms.filter((room) => room.roomCode?.startsWith("platform-"));

  const getRoomTitle = (room) => {
    const userName =
      room.otherMemberName || room.memberName || `사용자 ${room.roomCode.split("-")[1]}`;
    return `${userName}님`;
  };

  const getRoomAvatar = (room) => {
    const currentState = determineRoomState(room);

    if (currentState === ROOM_STATES.ADMIN_ACTIVE) {
      return "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg";
    }

    return "https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f916/u1f916_u1f42d.png";
  };

  return {
    chatRooms,
    selectedRoom,
    newMessage,
    loading,
    error,
    isConnected,
    unreadCounts,
    currentUserId,
    hasNewHandoffRequest,
    requestingRooms,
    showFailToast,
    failMessage,
    messages,
    loadingMessages,
    loadingOlder,
    hasMore,
    messageError,
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom,
    addMessage,
    updateMessage,
    resetMessages,
    isNearBottom,
    isInitialLoad,
    setNewMessage,
    setShowFailToast,
    loadChatRooms,
    determineRoomState,
    handleRoomSelect,
    handleSendMessage,
    handleProactiveIntervention,
    handleTakeOver,
    hasAdminPermission,
    getRoomPriority,
    filterPlatformRooms,
    getRoomTitle,
    getRoomAvatar,
    triggerToastFail,
  };
};
