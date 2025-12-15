import React, { useState, useEffect, useCallback } from "react";
import styles from "./ChatContainer.module.css";
import instance from "../../../api/lib/axios";
import * as ChatWebSocketService from "../../../api/service/chat/ChatWebSocketService";
import {
  getAllUnreadCounts,
  markAsRead,
  getChatMessages,
} from "../../../api/service/chat/chatService";
import { useWorkingChatScroll } from "../../../hooks/useWorkingChatScroll";
import { jwtDecode } from "jwt-decode";
import SharedChatArea from "../../../components/shared/chat/SharedChatArea";
import SharedChatRoomList from "../../../components/shared/chat/SharedChatRoomList";

export default function ChatContainer() {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [buttonStates, setButtonStates] = useState({}); // roomCode -> 버튼 상태
  const [currentUserId, setCurrentUserId] = useState(null);
  const [error, setError] = useState(null);
  
  // Redis 성능 측정을 위한 상태
  const [afterRedisResults, setAfterRedisResults] = useState({
    messageLoad: [],
    messageSend: [],
    unreadCount: []
  });
  const [cacheWarmedRooms, setCacheWarmedRooms] = useState(new Set());



  // Use proven working chat scroll implementation
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

  // For compatibility with SharedChatArea
  const isInitialLoad = loadingMessages;



  // 플랫폼 상담방인지 확인하는 헬퍼 함수
  const isPlatformRoom = (room) => {
    return (
      room &&
      (room.expoTitle === "플랫폼 상담" ||
        room.roomCode?.startsWith("platform-"))
    );
  };

  // 현재 버튼 상태 조회
  const getCurrentButtonState = (roomCode) => {
    return buttonStates[roomCode] || "AI_ACTIVE";
  };

  // Backend state-aware button text (Korean) - 3-state system
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

  // Get room state description (Korean) - 3-state system
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

  // 상태별 버튼 액션 반환 - 3-state system
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

  // WebSocket 연결 및 초기화
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
        
        // 🆕 백엔드에서 받은 실제 상태로 버튼 상태 초기화
        const initialButtonStates = {};
        rooms.forEach((room) => {
          if (isPlatformRoom(room)) {
            // 백엔드에서 currentState 정보 활용
            const backendState = room.currentState || "AI_ACTIVE"; // 기본값
            initialButtonStates[room.roomCode] = backendState;
            console.log("🔄 초기 상태 동기화 - roomCode:", room.roomCode, "backendState:", backendState);
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
        // 🚀 [After Redis] 미읽음 카운트 성능 측정
        console.log("🔍 [After Redis] 미읽음 카운트 조회 시작");
        const startTime = performance.now();
        
        const response = await getAllUnreadCounts();
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`🚀 [After Redis] 미읽음 카운트 완료: ${duration.toFixed(2)}ms`);
        
        // 성능 결과 로컬스토리지에 저장
        const existingData = JSON.parse(localStorage.getItem('afterRedis_unreadCount') || '[]');
        existingData.push(duration);
        localStorage.setItem('afterRedis_unreadCount', JSON.stringify(existingData));
        
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

  // 선택된 채팅방 변경 시 메시지 로드
  useEffect(() => {
    if (!selectedRoom) {
      console.log("선택된 채팅방이 없음");
      resetMessages();
      return;
    }

    // Only run if room code actually changed
    const roomCode = selectedRoom.roomCode;
    if (!roomCode) return;

    const loadRoomMessages = async () => {
      try {
        const startTime = performance.now();
        const isFirstAccess = !cacheWarmedRooms.has(roomCode);

        resetMessages();
        await loadInitialMessages(roomCode);
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        if (isFirstAccess) {
          // 첫 번째 접근: MongoDB 직접 조회 (캐시 구축)
          console.log(`🐘 [MongoDB 조회] 메시지 로딩: ${duration.toFixed(2)}ms`);
          setCacheWarmedRooms(prev => new Set([...prev, roomCode]));
        } else {
          // 두 번째+ 접근: Redis 캐시에서 조회
          console.log(`⚡ [Redis 캐시] 메시지 로딩: ${duration.toFixed(2)}ms`);
          
          // 캐시 히트 성능만 저장
          setAfterRedisResults(prev => ({
            ...prev,
            messageLoad: [...prev.messageLoad, duration]
          }));
          
          // 로컬 스토리지에도 저장
          const existingData = JSON.parse(localStorage.getItem('afterRedis_messageLoad') || '[]');
          existingData.push(duration);
          localStorage.setItem('afterRedis_messageLoad', JSON.stringify(existingData));
        }

        // 메시지 로드 후 자동으로 읽음 처리
        try {
          const currentRoom = selectedRoom;
          const expoId = isPlatformRoom(currentRoom)
            ? null
            : currentRoom?.expoId;
          await markAsRead(roomCode, expoId);
        } catch (err) {
          console.error("읽음 처리 실패:", err);
        }
      } catch (error) {
        console.error("메시지 로드 실패:", error);
      }
    };

    loadRoomMessages();
  }, [selectedRoom?.roomCode]); // Only depend on roomCode to avoid infinite loops

  // WebSocket 구독 관리 (selectedRoom과 wsConnected 모두 준비된 후)
  useEffect(() => {
    if (!selectedRoom || !wsConnected) {
      return;
    }

    const joinRoomAndSubscribe = async () => {
      try {
        console.log("🔌 WebSocket 채팅방 입장 시도:", selectedRoom.roomCode);

        // WebSocket 채팅방 입장
        await ChatWebSocketService.joinRoom(selectedRoom.roomCode);

        // 메시지 수신 핸들러 등록 (unified handler for all message types)
        ChatWebSocketService.onMessage(selectedRoom.roomCode, (message) => {
          console.log("🎯 USER SIDE - Raw message received:", message);
          console.log("🎯 USER SIDE - Message type check:", {
            type: message.type,
            hasMessageId: !!message.messageId,
            hasSenderType: !!message.senderType,
            senderType: message.senderType,
            isAI: message.senderType === "AI",
            senderName: message.senderName,
            content: message.content?.substring(0, 50) + "...",
            hasRoomState: !!message.roomState,
            roomState: message.roomState?.current,
          });

          // Handle system messages first (they have different structure)
          if (message.type === "SYSTEM_MESSAGE") {
            console.log("🎭 User side - SYSTEM MESSAGE DETECTED!");
            console.log(
              "🎭 User side - Full message object:",
              JSON.stringify(message, null, 2)
            );
            console.log("🎭 User side - Message type:", message.type);
            console.log("🎭 User side - Payload type:", message.payload?.type);
            console.log("🎭 User side - Payload content:", message.payload);

            const systemMessage = {
              id: `system-${Date.now()}`,
              type: "SYSTEM_MESSAGE",
              payload: message.payload,
              timestamp: message.payload?.timestamp || new Date().toISOString(),
              sentAt: message.payload?.timestamp || new Date().toISOString(),
              unreadCount: 0,
            };
            console.log(
              "🎭 User side - Created system message object:",
              JSON.stringify(systemMessage, null, 2)
            );
            addMessage(systemMessage);

            // Also handle room state if present
            if (message.roomState && isPlatformRoom(selectedRoom)) {
              const newState = message.roomState.current;
              console.log("🏠 User side - Updating button state:", newState);
              setButtonStates((prev) => ({
                ...prev,
                [selectedRoom.roomCode]: newState,
              }));
            }
            return; // Don't process as regular message
          }

          // Handle room state updates from all message types
          if (message.roomState && isPlatformRoom(selectedRoom)) {
            const newState = message.roomState.current;
            console.log("🏠 Room state update received:", {
              roomCode: selectedRoom.roomCode,
              newState,
              reason: message.roomState.transitionReason,
              timestamp: message.roomState.timestamp,
            });

            // Update button state based on room state
            setButtonStates((prev) => ({
              ...prev,
              [selectedRoom.roomCode]: newState,
            }));
          }

          // 메시지에 unreadCount가 있으면 그대로 사용, 없으면 메시지 타입에 따라 설정
          // AI messages and admin messages should have unreadCount: 0 (automatic responses)
          // USER messages (including my own) should have unreadCount: 1 initially
          let defaultUnreadCount = 0; // Default for AI/admin messages
          if (message.senderType === "USER") {
            defaultUnreadCount = 1; // All USER messages start with unreadCount: 1
          }

          const newMessage = {
            ...message,
            id: message.id || message.messageId, // Ensure id field exists
            unreadCount:
              message.unreadCount !== undefined
                ? message.unreadCount
                : defaultUnreadCount,
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

          // 모든 메시지를 동일하게 처리 (낙관적 업데이트 제거)
          console.log("✅ USER SIDE - 메시지 추가:", newMessage);
          addMessage(newMessage);

          // Virtuoso handles auto-scroll automatically with followOutput

          // 현재 선택된 채팅방의 메시지면 자동으로 읽음 처리 (자신의 메시지가 아닌 경우만)
          const token = localStorage.getItem("access_token");
          const messageRoomCode = message.roomId || message.roomCode; // roomId 또는 roomCode 사용

          console.log("메시지 roomCode 체크:", {
            messageRoomCode,
            selectedRoomCode: selectedRoom?.roomCode,
            isMatch: selectedRoom && selectedRoom.roomCode === messageRoomCode,
          });

          if (
            token &&
            selectedRoom &&
            selectedRoom.roomCode === messageRoomCode
          ) {
            try {
              const decodedToken = jwtDecode(token);
              const currentUserId = decodedToken.memberId;

              console.log(
                "메시지 수신 - senderId:",
                message.senderId,
                "currentUserId:",
                currentUserId,
                "senderType:",
                message.senderType
              );

              // AI 채팅 상황 확인
              const isAIChatActive = isPlatformRoom(selectedRoom) && 
                                   getCurrentButtonState(selectedRoom.roomCode) === "AI_ACTIVE";
              
              // 자신이 보낸 메시지가 아닌 경우 OR AI 채팅에서 내가 보낸 메시지인 경우 읽음 처리
              if (message.senderId !== currentUserId || 
                  (message.senderId === currentUserId && isAIChatActive)) {
                
                if (message.senderId !== currentUserId) {
                  console.log("관리자 메시지 자동 읽음 처리 시작");
                } else {
                  console.log("AI 채팅 - 내가 보낸 메시지 읽음 처리 (AI가 즉시 읽음)");
                }

                // 읽음 처리 API 호출 (비동기로 처리)
                setTimeout(async () => {
                  await handleMarkAsRead(selectedRoom.roomCode);
                  // 읽음 처리 후 unreadCount를 0으로 업데이트
                  // Update messages read status via addMessage hook
                  // This functionality is handled by the message loading system
                }, 100); // 100ms 지연으로 "1"이 잠깐 보이게
              } else {
                console.log("일반 채팅 - 내가 보낸 메시지이므로 읽음 처리 안함");
              }
            } catch (error) {
              console.error("토큰 디코딩 실패:", error);
            }
          }
        });

        // 버튼 상태 업데이트 핸들러 등록 (플랫폼 상담방용)
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

        // unread count 업데이트 핸들러 등록 (읽음 상태 실시간 업데이트)
        ChatWebSocketService.subscribeToUnreadUpdates(
          selectedRoom.roomCode,
          (unreadData) => {
            
            // read_status_update 메시지 처리
            if (unreadData.type === "read_status_update") {
              const payload = unreadData.payload || unreadData;
              const readerType = payload.readerType;
              const messageId = unreadData.messageId || payload.messageId; // 특정 메시지 ID


              // 관리자나 AI가 읽었을 때 → 특정 메시지의 "1" 제거 + unreadCounts 즉시 업데이트
              if (readerType === "ADMIN" || readerType === "AI") {
                try {
                  if (messageId) {
                    // 특정 메시지 ID의 unreadCount를 0으로 설정
                    console.log(`🎯 Updating specific message unreadCount to 0: ${messageId}`);
                    updateMessage(messageId, { unreadCount: 0 });
                  } else {
                    // messageId가 없는 경우 기존 로직 사용 (모든 내 메시지 업데이트)
                    console.log(`🔄 No specific messageId, updating all my messages (${readerType} read them)`);
                    
                    // Update messages state to remove unread badges
                    messages.forEach(msg => {
                      const isMyMsg = msg.senderType === 'USER' && msg.senderId === currentUserId;
                      if (isMyMsg && msg.unreadCount > 0) {
                        updateMessage(msg.id, { unreadCount: 0 });
                      }
                    });
                  }

                  // 🆕 관리자나 AI가 읽었을 때 → unreadCounts 즉시 업데이트  
                  const roomCode = unreadData.roomCode || payload.roomCode;
                  if (roomCode) {
                    console.log(`🔄 즉시 unreadCounts 업데이트: ${roomCode} → 0`);
                    setUnreadCounts(prev => ({
                      ...prev,
                      [roomCode]: 0
                    }));
                  }
                  
                  // Background refetch for accuracy after 1.5 seconds
                  setTimeout(async () => {
                    try {
                      if (selectedRoom && selectedRoom.roomCode) {
                        console.log('🔄 Background refetch for accuracy after read status update');
                        await loadInitialMessages(selectedRoom.roomCode);
                      }
                    } catch (error) {
                      console.error('Background refetch failed:', error);
                    }
                  }, 1500);
                } catch (error) {
                  console.error('Failed to update read status, falling back to immediate refetch:', error);
                  // Fallback: immediate refetch if state update fails
                  if (selectedRoom && selectedRoom.roomCode) {
                    loadInitialMessages(selectedRoom.roomCode).catch(console.error);
                  }
                }
              }
              return; // read_status_update는 여기서 처리 완료
            }

            // 기존 unreadCounts 업데이트 (다른 타입의 메시지들)
            if (unreadData.roomCode && unreadData.unreadCount !== undefined) {
              setUnreadCounts((prev) => ({
                ...prev,
                [unreadData.roomCode]: unreadData.unreadCount,
              }));
            }
          }
        );

        console.log("채팅방 구독 완료:", selectedRoom.roomCode);
      } catch (error) {
        console.error("채팅방 구독 실패:", error);
      }
    };

    joinRoomAndSubscribe();

    return () => {
      if (selectedRoom) {
        ChatWebSocketService.leaveRoom(selectedRoom.roomCode);
      }
    };
  }, [selectedRoom, wsConnected]);

  // No auto-scroll - let users control their scroll position
  // Badge notifications will show new messages, users can click scroll button to go down

  // 메시지 전송 함수 (Redis 성능 측정 포함)
  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedRoom || !wsConnected) {
      console.log("❌ 메시지 전송 차단:", {
        hasMessage: !!newMessage.trim(),
        hasRoom: !!selectedRoom,
        isConnected: wsConnected,
      });
      return;
    }

    const messageContent = newMessage.trim();
    const startTime = performance.now();

    // WebSocket으로 메시지 전송
    ChatWebSocketService.sendMessage(selectedRoom.roomCode, messageContent);
    setNewMessage("");
    
    // 메시지가 화면에 나타날 때까지 측정 (100ms 후 체크)
    setTimeout(() => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`✅ [After Redis] 메시지 전송 완료: ${duration.toFixed(2)}ms`);
      
      // 성능 결과 저장
      setAfterRedisResults(prev => ({
        ...prev,
        messageSend: [...prev.messageSend, duration]
      }));
      
      // 로컬 스토리지에도 저장
      const existingData = JSON.parse(localStorage.getItem('afterRedis_messageSend') || '[]');
      existingData.push(duration);
      localStorage.setItem('afterRedis_messageSend', JSON.stringify(existingData));
    }, 100);

    // Virtuoso handles auto-scroll with followOutput
  };

  // 읽음 처리 함수
  const handleMarkAsRead = async (roomCode) => {
    try {
      console.log("읽음 처리 시작:", roomCode);

      // 현재 선택된 방이 플랫폼 방인지 확인하여 적절한 API 호출
      const currentRoom =
        selectedRoom || chatRooms.find((room) => room.roomCode === roomCode);
      const expoId = isPlatformRoom(currentRoom) ? null : currentRoom?.expoId;

      const response = await markAsRead(roomCode, expoId);
      console.log("읽음 처리 API 응답:", response);

      // 로컬 상태에서 unread count를 0으로 설정
      setUnreadCounts((prev) => ({
        ...prev,
        [roomCode]: 0,
      }));

      // 내가 보낸 메시지들은 상대가 읽을 때까지 1 유지
      // 상대가 보낸 메시지들은 내가 읽었으므로 0으로 변경
      // This is handled by the message hook system
      console.log("Marking messages as read for room:", roomCode);

      // 관리자에게 읽음 상태 알림 전송
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

  // 채팅방 선택 핸들러
  const handleRoomSelect = async (room) => {
    setSelectedRoom(room);

    // 채팅방 선택 시 자동으로 읽음 처리
    if (unreadCounts[room.roomCode] > 0) {
      await handleMarkAsRead(room.roomCode);
    }
  };

  // 플랫폼 버튼 클릭 핸들러
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

  // Custom room list functions for user chat
  const getRoomTitle = (room) => room.expoTitle || "박람회명 없음";

  const getRoomAvatar = (room) => {
    const isCurrentlyPlatform = isPlatformRoom(room);
    const currentButtonState = getCurrentButtonState(room.roomCode);
    const isAIActive =
      currentButtonState === "AI_ACTIVE" ||
      currentButtonState === "WAITING_FOR_ADMIN";

    if (isCurrentlyPlatform) {
      return isAIActive
        ? "https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f916/u1f916_u1f42d.png" // Original robot mouse - PERFECT!
        : "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg"; // Simple human silhouette
    }

    // For expo rooms, use human silhouette (admin profile style)
    return "https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg"; // Human silhouette for expo
  };

  const getRoomPriority = (room) => {
    // Platform rooms get highest priority
    if (isPlatformRoom(room)) return 100;
    return 0;
  };

  const getRoomBadges = (room) => {
    const badges = [];
    const isCurrentlyPlatform = isPlatformRoom(room);
    const currentButtonState = getCurrentButtonState(room.roomCode);

    if (isCurrentlyPlatform) {
      const isAIActive =
        currentButtonState === "AI_ACTIVE" ||
        currentButtonState === "WAITING_FOR_ADMIN";
      if (currentButtonState === "ADMIN_ACTIVE") {
        badges.push(
          <div
            key="active"
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "#4CAF50",
              borderRadius: "50%",
              animation: "pulse 2s infinite",
            }}
            title="상담원 연결됨"
          />
        );
      }
    }
    return badges;
  };

  const getRoomClassName = (room) => {
    // Add special styling for expo rooms
    if (!isPlatformRoom(room)) {
      return "expoRoom";
    }
    return "";
  };

  const getRoomTitleClassName = (room) => {
    // Add special styling for expo room titles
    if (!isPlatformRoom(room)) {
      return "expoTitle";
    }
    return "";
  };


  // Custom header content for platform rooms
  const renderChatHeader = () => {
    if (!isPlatformRoom(selectedRoom)) {
      return (
        <div className={styles.defaultHeader}>
          <h3>{selectedRoom.expoTitle || "박람회명 없음"}</h3>
          <div className={styles.connectionStatus}>
            <span
              className={`${styles.statusDot} ${
                wsConnected ? styles.connected : styles.disconnected
              }`}
            />
            {wsConnected ? "연결됨" : "연결 끊김"}
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span>{selectedRoom.expoTitle || "박람회명 없음"}</span>
          <span
            style={{
              padding: "4px 8px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "500",
              backgroundColor:
                getCurrentButtonState(selectedRoom.roomCode) === "ADMIN_ACTIVE"
                  ? "#4CAF50"
                  : getCurrentButtonState(selectedRoom.roomCode) ===
                    "WAITING_FOR_ADMIN"
                  ? "#ff9800"
                  : "#2196F3",
              color: "white",
            }}
          >
            {getRoomStateDescription(
              getCurrentButtonState(selectedRoom.roomCode)
            )}
          </span>
        </div>
        <button
          className={styles.platformButton}
          onClick={() =>
            handlePlatformButtonClick(
              selectedRoom.roomCode,
              getButtonAction(getCurrentButtonState(selectedRoom.roomCode))
            )
          }
          disabled={!wsConnected}
          style={{
            backgroundColor:
              getCurrentButtonState(selectedRoom.roomCode) ===
              "WAITING_FOR_ADMIN"
                ? "#ff9800"
                : "#2196F3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "6px 12px",
            fontSize: "12px",
            cursor: wsConnected ? "pointer" : "not-allowed",
            opacity: wsConnected ? 1 : 0.5,
          }}
        >
          {getButtonText(getCurrentButtonState(selectedRoom.roomCode))}
        </button>
      </div>
    );
  };

  return (
    <div className={styles.chatWrapper}>
      
      {/* Left: Chat Room List */}
      <aside className={styles.chatList}>
        <SharedChatRoomList
          chatRooms={chatRooms}
          selectedRoom={selectedRoom}
          loading={loading}
          error={error}
          unreadCounts={unreadCounts}
          onRoomSelect={handleRoomSelect}
          onRefresh={() => window.location.reload()}
          title="상담 채팅"
          emptyMessage="아직 채팅방이 없습니다"
          getRoomTitle={getRoomTitle}
          getRoomAvatar={getRoomAvatar}
          getRoomPriority={getRoomPriority}
          getRoomBadges={getRoomBadges}
          getRoomClassName={getRoomClassName}
          getRoomTitleClassName={getRoomTitleClassName}
          headerContent={
            <div
              style={{
                fontSize: "12px",
                color: wsConnected ? "#4CAF50" : "#f44336",
              }}
            >
              {wsConnected ? "🟢 연결됨" : "🔴 연결 안됨"}
            </div>
          }
        />
      </aside>

      {/* Right: Chat Area */}
      <main className={styles.chatArea}>
        <SharedChatArea
          messages={messages}
          loading={loadingMessages}
          hasMore={hasMore}
          error={messageError}
          currentUserId={currentUserId}
          currentUserType="USER"
          selectedRoom={selectedRoom}
          newMessage={newMessage}
          onMessageChange={setNewMessage}
          onSendMessage={handleSendMessage}
          placeholder="메세지를 입력해주세요"
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
          onScrollToBottom={scrollToBottom}
          headerContent={selectedRoom ? renderChatHeader() : null}
          isConnected={wsConnected}
          isNearBottom={isNearBottom}
        />
      </main>
    </div>
  );
}
