import SockJS from 'sockjs-client';
import { Stomp } from '@stomp/stompjs';
import instance from '../../lib/axios';

/**
 * MYCE 채팅 WebSocket 서비스
 * @description STOMP over SockJS를 사용한 실시간 채팅 구현
 * @specification 티켓 기반 인증 방식 사용
 */

// WebSocket 연결 상태 관리
let stompClient = null;
let subscriptions = new Map(); // 채팅방별 구독 관리
let messageHandlers = new Map(); // roomId -> single handler
let messageHandlersList = new Map(); // roomId -> array of handlers (for multiple listeners)
let unreadCountHandlers = new Map(); // unread count 핸들러 관리
let connected = false;
let connecting = false;
const connectionListeners = new Set();
const CHAT_ROOM_UPDATES_KEY = 'chat-room-updates';

const notifyConnectionChange = (nextConnected) => {
  connectionListeners.forEach((listener) => {
    try {
      listener(nextConnected);
    } catch (error) {
      console.error('connection listener error:', error);
    }
  });
};

const ensureChatRoomUpdatesSubscription = () => {
  if (!connected || !stompClient || subscriptions.has(CHAT_ROOM_UPDATES_KEY)) {
    return;
  }

  const chatRoomUpdatesChannel = `/topic/chat-room-updates`;
  try {
    const subscription = stompClient.subscribe(chatRoomUpdatesChannel, (message) => {
      try {
        const data = JSON.parse(message.body);
        if (data.type !== 'UNREAD_COUNT_UPDATE' && data.type !== 'unread_count_update') {
          return;
        }

        const payload = data.payload || data;
        const roomCode = payload.roomCode || data.roomCode;
        if (!roomCode) {
          return;
        }

        const unreadHandler = unreadCountHandlers.get(roomCode);
        if (unreadHandler) {
          unreadHandler(data);
        }
      } catch (parseError) {
        console.error('채팅방 업데이트 메시지 파싱 에러:', parseError);
      }
    });

    subscriptions.set(CHAT_ROOM_UPDATES_KEY, subscription);
  } catch (subscribeError) {
    console.error('채팅방 업데이트 구독 실패:', subscribeError);
  }
};

/**
 * WebSocket 연결용 티켓 발급
 * @returns {Promise<string>} 티켓 문자열
 */
const fetchTicket = async () => {
  console.log('🎫 WebSocket 티켓 발급 요청...');
  const response = await instance.post('/chats/ws/ticket');
  const ticket = response.data.ticket;
  console.log('🎫 티켓 발급 완료:', ticket.substring(0, 8) + '...');
  return ticket;
};

/**
 * WebSocket 연결 수립
 * @param {string} token - JWT 인증 토큰 (티켓 발급에 사용)
 * @param {number} userId - 사용자 ID
 * @returns {Promise<void>}
 */
const connect = async (token, userId) => {
  try {
    console.log('🔌 WebSocket 연결 시작...', { userId, tokenExists: !!token });

    if (connecting) {
      console.log('⏳ WebSocket 연결 진행 중 - 중복 연결 시도 무시');
      return;
    }

    if (connected) {
      console.log('🔄 기존 연결 해제 중...');
      disconnect();
    }

    connecting = true;

    // 1. 티켓 발급 (Gateway를 통해 JWT 인증)
    const ticket = await fetchTicket();

    // 2. 티켓을 포함한 WebSocket URL 생성
    const getWebSocketURL = () => {
      const baseUrl = import.meta.env.DEV
        ? 'http://localhost:8083/ws/chat'
        : 'https://api.myce.live/ws/chat';
      return `${baseUrl}?ticket=${ticket}`;
    };

    const sockJSUrl = getWebSocketURL();
    console.log('🌐 WebSocket URL:', sockJSUrl.replace(ticket, ticket.substring(0, 8) + '...'));

    const socket = new SockJS(sockJSUrl);
    stompClient = Stomp.over(socket);

    stompClient.debug = import.meta.env.DEV ? (...args) => console.log('📡 STOMP:', ...args) : () => {};
    stompClient.onWebSocketClose = () => {
      console.warn('🔌 WebSocket closed');
      connected = false;
      connecting = false;
      notifyConnectionChange(false);
    };
    stompClient.onWebSocketError = (error) => {
      console.warn('⚠️ WebSocket error', error);
      connected = false;
      connecting = false;
      notifyConnectionChange(false);
    };
    stompClient.onStompError = (frame) => {
      console.warn('⚠️ STOMP error', frame);
      connected = false;
      connecting = false;
      notifyConnectionChange(false);
    };

    return new Promise((resolve, reject) => {
      stompClient.connect(
        {}, // 헤더 불필요
        (frame) => {
          console.log('✅ WebSocket 연결 성공:', frame);
          connected = true;
          connecting = false;
          notifyConnectionChange(true);
          resolve();
        },
        (error) => {
          console.error('❌ WebSocket 연결 실패:', error);
          connected = false;
          connecting = false;
          notifyConnectionChange(false);
          reject(error);
        }
      );
    });

  } catch (error) {
    console.error('❌ WebSocket 연결 중 오류:', error);
    connected = false;
    connecting = false;
    notifyConnectionChange(false);
    throw error;
  }
};

/**
 * WebSocket 연결 후 JWT 인증 수행
 * @param {string} token - JWT 토큰
 * @returns {Promise<void>}
 */
const authenticate = (token) => {
  return new Promise((resolve, reject) => {
    if (!connected || !stompClient?.connected) {
      reject(new Error('WebSocket이 연결되지 않음'));
      return;
    }

    let authResolved = false;

    // Subscribe to shared auth topic
    const authSubscription = stompClient.subscribe('/topic/auth-test', (message) => {
      try {
        const response = JSON.parse(message.body);
        
        if ((response.type === 'AUTH_ACK' || response.type === 'AUTH_TEST') && !authResolved) {
          authResolved = true;
          authSubscription.unsubscribe();
          resolve();
        } else if (response.type === 'ERROR' && !authResolved) {
          authResolved = true;
          authSubscription.unsubscribe();
          reject(new Error(response.payload || '인증 실패'));
        }
      } catch (error) {
        if (!authResolved) {
          authResolved = true;
          authSubscription.unsubscribe();
          reject(error);
        }
      }
    });

    const timeoutId = setTimeout(() => {
      if (!authResolved) {
        authResolved = true;
        authSubscription.unsubscribe();
        reject(new Error('인증 타임아웃'));
      }
    }, 10000);

    try {
      const payload = { token: token };
      stompClient.send('/app/auth', {}, JSON.stringify(payload));
    } catch (sendError) {
      clearTimeout(timeoutId);
      if (!authResolved) {
        authResolved = true;
        authSubscription.unsubscribe();
        reject(sendError);
      }
    }
  });
};

/**
 * 채팅방 입장 및 메시지 구독
 * @param {string} roomId - 채팅방 ID (format: admin-{expoId}-{userId})
 * @returns {Promise<void>}
 */
const joinRoom = async (roomId) => {
  console.log('🚪 joinRoom called for:', roomId, 'existing subscription:', subscriptions.has(roomId));
  
  if (!connected) {
    throw new Error('WebSocket이 연결되지 않음');
  }

  if (!subscriptions.has(roomId)) {
    const subscription = stompClient.subscribe(`/topic/chat/${roomId}`, (message) => {
      const data = JSON.parse(message.body);
      
      // Critical errors only for handoff
      if (data.type === 'AI_HANDOFF_REQUEST' || data.type === 'BUTTON_STATE_UPDATE') {
        if (!messageHandlers.has(roomId)) {
          console.error(`❌ No handler for critical message: ${data.type} on room ${roomId}`);
        }
        console.log('🚨 HANDOFF DEBUG: Global handler exists?', !!window.globalPlatformNotificationHandler);
      }
      
      // Log AI messages only
      if (data.type === 'AI_MESSAGE') {
        console.log('🤖 AI_MESSAGE received:', data);
      }
      
      // Get both single handler and list of handlers
      const handler = messageHandlers.get(roomId);
      const handlersList = messageHandlersList.get(roomId) || [];
      
      // Process chat messages AND handoff system messages for platform admin notifications
      const shouldProcess = data.type === 'MESSAGE' || data.type === 'ADMIN_MESSAGE' || data.type === 'AI_MESSAGE' || 
                           data.type === 'AI_HANDOFF_REQUEST' || data.type === 'BUTTON_STATE_UPDATE' || 
                           data.type === 'SYSTEM_MESSAGE' || data.type === 'AI_TIMEOUT_TAKEOVER';
      
      if (shouldProcess) {
        // Prepare message data
        let processedData;
        if (data.type === 'AI_HANDOFF_REQUEST' || data.type === 'BUTTON_STATE_UPDATE' || 
            data.type === 'SYSTEM_MESSAGE' || data.type === 'AI_TIMEOUT_TAKEOVER') {
          processedData = data; // Pass full object with type, payload, and roomState
        } else {
          // For regular messages, enhance payload with room state information
          processedData = data.payload || data;
          if (data.roomState) {
            processedData.roomState = data.roomState;
          }
        }
        
        // Call single handler (for backwards compatibility)
        if (handler) {
          handler(processedData);
        }
        
        // Call all handlers in the list
        handlersList.forEach(listHandler => {
          try {
            listHandler(processedData);
          } catch (error) {
            console.error('Error in message handler:', error);
          }
        });
      }
      
      const unreadHandler = unreadCountHandlers.get(roomId);
      if (unreadHandler && (data.type === 'READ_STATUS_UPDATE' || data.type === 'UNREAD_COUNT_UPDATE')) {
        unreadHandler(data);
      }
      
      // Handle button state updates
      if (data.type === 'BUTTON_STATE_UPDATE' && window.buttonUpdateHandlers) {
        const buttonHandler = window.buttonUpdateHandlers.get(roomId);
        if (buttonHandler) {
          console.log('🔘 Button state update:', data);
          buttonHandler(data);
        }
      }
      
      // Debug: Log ALL message types received on room channels
      console.log(`📥 Message received on room ${roomId}:`, {
        type: data.type,
        payload: data.payload,
        fullData: data
      });
      
      // Call global platform notification handler if it exists (for platform admin notifications)
      if (roomId.startsWith('platform-') && window.globalPlatformNotificationHandler) {
        console.log('🔔 Calling global platform notification handler for room:', roomId);
        window.globalPlatformNotificationHandler(data, roomId);
      }
    });
    
    subscriptions.set(roomId, subscription);
  }
  stompClient.send('/app/join', {}, JSON.stringify({
    roomCode: roomId
  }));
};

/**
 * 채팅 메시지 전송
 * @param {string} roomId - 채팅방 ID
 * @param {string} content - 메시지 내용
 * @description CHAT_SYSTEM_README.md 메시지 페이로드 형식 준수
 */
const sendMessage = (roomId, content) => {
  if (!connected) {
    console.error('❌ WebSocket이 연결되지 않음');
    return;
  }

  const messagePayload = {
    roomCode: roomId,
    content: content,
    sentAt: new Date().toISOString()
  };

  console.log('📨 WebSocket 메시지 전송:', messagePayload);
  
  try {
    stompClient.send('/app/message-send', {}, JSON.stringify(messagePayload));
    console.log('✅ WebSocket 메시지 전송 성공', JSON.stringify(messagePayload));
  } catch (error) {
    console.error('❌ WebSocket 메시지 전송 실패:', error);
  }
};

/**
 * 메시지 수신 핸들러 등록 (single handler - backwards compatibility)
 * @param {string} roomId - 채팅방 ID
 * @param {function} handler - 메시지 처리 함수
 */
const onMessage = (roomId, handler) => {
  messageHandlers.set(roomId, handler);
};

/**
 * 메시지 수신 핸들러 추가 (multiple handlers support)
 * @param {string} roomId - 채팅방 ID
 * @param {function} handler - 메시지 처리 함수
 * @returns {function} - 핸들러 제거 함수
 */
const addMessageHandler = (roomId, handler) => {
  if (!messageHandlersList.has(roomId)) {
    messageHandlersList.set(roomId, []);
  }
  const handlers = messageHandlersList.get(roomId);
  handlers.push(handler);
  
  // Return a function to remove this specific handler
  return () => {
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  };
};

/**
 * 채팅방 나가기 및 구독 해제
 * @param {string} roomId - 채팅방 ID
 */
const leaveRoom = (roomId) => {
  const subscription = subscriptions.get(roomId);
  if (subscription) {
    subscription.unsubscribe();
    subscriptions.delete(roomId);
  }
  messageHandlers.delete(roomId);
  messageHandlersList.delete(roomId);
  unreadCountHandlers.delete(roomId);
  if (window.buttonUpdateHandlers) {
    window.buttonUpdateHandlers.delete(roomId);
  }
};

/**
 * 읽음 상태 WebSocket으로 업데이트
 * @param {string} roomId - 채팅방 ID
 * @param {string} messageId - 읽은 메시지 ID (선택적)
 */
const markAsReadViaWebSocket = (roomId, messageId = null) => {
  if (!connected) {
    return;
  }

  const payload = {
    roomCode: roomId,
    messageId: messageId
  };

  stompClient.send('/app/read', {}, JSON.stringify(payload));
};

/**
 * Unread count 업데이트 구독
 * @param {string} roomId - 채팅방 ID
 * @param {function} handler - unread count 업데이트 핸들러
 */
const subscribeToUnreadUpdates = (roomId, handler) => {
  unreadCountHandlers.set(roomId, handler);
  ensureChatRoomUpdatesSubscription();
};

/**
 * 박람회 전체 관리자 업데이트 구독
 * @param {number} expoId - 박람회 ID
 * @param {function} handler - 업데이트 핸들러
 */
const subscribeToExpoAdminUpdates = (expoId, handler) => {
  if (!connected || !stompClient) {
    return null;
  }

  const expoChannel = `/topic/expo/${expoId}/admin-updates`;
  
  try {
    const subscription = stompClient.subscribe(expoChannel, (message) => {
      try {
        const data = JSON.parse(message.body);
        handler(data);
      } catch (parseError) {
        console.error('메시지 파싱 에러:', parseError);
      }
    });
    
    subscriptions.set(`expo-${expoId}`, subscription);
    return subscription;
  } catch (subscribeError) {
    console.error('구독 실패:', subscribeError);
    return null;
  }
};

/**
 * WebSocket으로 unread count 요청
 * @param {string} roomId - 채팅방 ID
 */
const requestUnreadCount = (roomId) => {
  if (!connected) {
    return;
  }

  stompClient.send('/app/unread-count', {}, JSON.stringify({
    roomCode: roomId
  }));
};

/**
 * 읽음 상태 WebSocket 알림 전송
 * @param {string} roomId - 채팅방 ID
 */
const sendReadStatusNotification = (roomCode) => {
  if (!connected) {
    return;
  }

  stompClient.send('/app/read-status-notify', {}, JSON.stringify({
    roomCode: roomCode,
    readerType: "USER",
    unreadCount: 0
  }));
};

/**
 * WebSocket 연결 완전 해제
 * @description 모든 구독 해제 후 연결 종료
 */
const disconnect = () => {
  console.trace('🔍 disconnect() 호출됨');
  if (stompClient && connected) {
    subscriptions.forEach(subscription => subscription.unsubscribe());
    subscriptions.clear();
    messageHandlers.clear();
    messageHandlersList.clear();
    unreadCountHandlers.clear();

    stompClient.disconnect();
    console.log('🔍 connected=false 설정 (disconnect 함수)');
    connected = false;
    connecting = false;
    stompClient = null;
    notifyConnectionChange(false);
  }
};

/**
 * 관리자 채팅 메시지 전송 (담당자 배정 포함)
 * @param {string} roomCode - 채팅방 코드 (admin-{expoId}-{userId})
 * @param {string} content - 메시지 내용
 * @param {number} expoId - 박람회 ID
 * @description 백엔드의 /app/admin/message-send 엔드포인트 사용
 */
const sendAdminMessage = (roomCode, content, expoId) => {
  if (!connected) {
    console.error('WebSocket이 연결되지 않음');
    return;
  }

  const messagePayload = {
    roomCode: roomCode,
    content: content,
    expoId: expoId,
    sentAt: new Date().toISOString()
  };

  stompClient.send('/app/admin/message-send', {}, JSON.stringify(messagePayload));
};

/**
 * WebSocket 연결 상태 확인
 * @returns {boolean} 연결 상태
 */
const isConnected = () => {
  return Boolean(connected && stompClient && stompClient.connected);
};

/**
 * WebSocket 연결 상태 변경 구독
 * @param {function} listener - (connected: boolean) => void
 * @returns {function} - 구독 해제 함수
 */
const addConnectionListener = (listener) => {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
};

/**
 * 개별 사용자 에러 메시지 구독
 * @param {function} callback - 에러 메시지 콜백 함수
 */
const subscribeToUserErrors = (callback) => {
  if (!stompClient || !connected) {
    return;
  }

  // Use a generic user error channel since we reverted session-specific topics
  const errorChannel = `/topic/user/errors`;
  
  try {
    const subscription = stompClient.subscribe(errorChannel, (message) => {
      try {
        const errorData = JSON.parse(message.body);
        callback(errorData);
      } catch (parseError) {
        console.error('에러 메시지 파싱 실패:', parseError);
      }
    });
    
    subscriptions.set('user-errors', subscription);
    return subscription;
  } catch (subscribeError) {
    console.error('구독 과정 중 에러:', subscribeError);
    return null;
  }
};

/**
 * 박람회별 전체 채팅방 목록 업데이트 구독 (unread count 실시간 업데이트용)
 * @param {number} expoId - 박람회 ID
 * @param {function} handler - 채팅방 목록 업데이트 핸들러
 */
const subscribeToExpoChatRoomUpdates = (expoId, handler) => {
  if (!connected || !stompClient) {
    return null;
  }

  const chatRoomUpdatesChannel = `/topic/chat-room-updates`;
  
  try {
    const subscription = stompClient.subscribe(chatRoomUpdatesChannel, (message) => {
      try {
        const data = JSON.parse(message.body);
        // 새 메시지로 인한 unread count 업데이트 처리
        if (data.type === 'UNREAD_COUNT_UPDATE' || data.type === 'unread_count_update'
            || data.type === 'NEW_MESSAGE' || data.type === 'new_message') {
          handler(data);
        }
      } catch (parseError) {
        console.error('채팅방 업데이트 메시지 파싱 에러:', parseError);
      }
    });
    
    subscriptions.set(`expo-chat-rooms-${expoId}`, subscription);
    return subscription;
  } catch (subscribeError) {
    console.error('채팅방 업데이트 구독 실패:', subscribeError);
    return null;
  }
};

/**
 * 플랫폼 관리자 업데이트 구독 (handoff requests, AI 상담 상태 등)
 * @param {function} handler - 업데이트 핸들러
 * @returns {Object|null} - 구독 객체
 */
const subscribeToPlatformAdminUpdates = (handler) => {
  if (!connected || !stompClient) {
    return null;
  }

  const platformChannel = `/topic/platform/admin-updates`;
  
  try {
    const subscription = stompClient.subscribe(platformChannel, (message) => {
      try {
        const data = JSON.parse(message.body);
        console.log('🔔 Platform admin update received:', data);
        handler(data);
      } catch (parseError) {
        console.error('Platform admin update 메시지 파싱 에러:', parseError);
      }
    });
    
    subscriptions.set('platform-admin', subscription);
    return subscription;
  } catch (subscribeError) {
    console.error('Platform admin updates 구독 실패:', subscribeError);
    return null;
  }
};

/**
 * 플랫폼 버튼 상태 업데이트 구독 (AI 상담용)
 * @param {string} roomCode - 채팅방 코드  
 * @param {function} callback - 버튼 상태 업데이트 콜백
 * @returns {Object|null} - 구독 객체
 */
const subscribeToButtonUpdates = (roomCode, callback) => {
  try {
    if (!connected || !stompClient?.connected) {
      console.warn('WebSocket이 연결되지 않아 버튼 업데이트 구독 불가');
      return null;
    }

    // DON'T create a new subscription - just register a button handler
    // The main subscription in joinRoom will handle all messages
    console.log('🔘 Registering button update handler for room:', roomCode);
    
    // Store the button callback separately
    if (!window.buttonUpdateHandlers) {
      window.buttonUpdateHandlers = new Map();
    }
    window.buttonUpdateHandlers.set(roomCode, callback);
    
    return {
      unsubscribe: () => {
        if (window.buttonUpdateHandlers) {
          window.buttonUpdateHandlers.delete(roomCode);
        }
      }
    };
    
    // Removed duplicate subscription code - button updates are now handled in main subscription
  } catch (error) {
    console.error('버튼 상태 업데이트 구독 실패:', error);
    return null;
  }
};

/**
 * 관리자 연결 요청 (플랫폼 상담용)
 * @param {string} roomCode - 채팅방 코드
 * @returns {Promise<void>}
 */
const requestHandoff = async (roomCode) => {
  try {
    if (!connected || !stompClient?.connected) {
      throw new Error('WebSocket이 연결되지 않음');
    }

    const uri = '/app/request-handoff?roomCode='+roomCode;
    console.log('📤 Sending to endpoint: /app/request-handoff');
    console.log('🔍 DEBUGGING: 요청중인 roomCode:', roomCode);
    console.log('🔍 DEBUGGING: Connected?', connected, 'StompClient connected?', stompClient?.connected);
    console.log('🔍 DEBUGGING: Current subscriptions:', Array.from(subscriptions.keys()));
    console.log('🔍 DEBUGGING: Current message handlers:', Array.from(messageHandlers.keys()));
    
    stompClient.send(uri, {});
    console.log('✅ 관리자 연결 요청 전송 완료');
    
    // Wait a bit and check if we received any messages back
    setTimeout(() => {
      console.log('🔍 DEBUGGING: 3초 후 상태 확인 - 메시지 받았나?');
    }, 3000);
    
  } catch (error) {
    console.error('관리자 연결 요청 실패:', error);
    throw error;
  }
};

/**
 * 관리자 연결 요청 취소 (플랫폼 상담용)
 * @param {string} roomCode - 채팅방 코드
 * @returns {Promise<void>}
 */
const cancelHandoff = async (roomCode) => {
  try {
    if (!connected || !stompClient?.connected) {
      throw new Error('WebSocket이 연결되지 않음');
    }

    console.log('관리자 연결 요청 취소 전송:', requestMessage);
    stompClient.send('/app/cancel-handoff?roomCode='+roomCode, {});
  } catch (error) {
    console.error('관리자 연결 요청 취소 실패:', error);
    throw error;
  }
};

/**
 * AI로 복귀 요청 (플랫폼 상담용)
 * @param {string} roomCode - 채팅방 코드
 * @returns {Promise<void>}
 */
const requestAI = async (roomCode) => {
  try {
    if (!connected || !stompClient?.connected) {
      throw new Error('WebSocket이 연결되지 않음');
    }

    console.log('AI 복귀 요청 전송:', requestMessage);
    stompClient.send('/app/request-ai?roomCode='+roomCode, {});
  } catch (error) {
    console.error('AI 복귀 요청 실패:', error);
    throw error;
  }
};

/**
 * 관리자 사전 개입 (AI_ACTIVE 상태에서 직접 개입)
 * @param {string} roomCode - 채팅방 코드
 * @returns {Promise<void>}
 */
const proactiveIntervention = async (roomCode) => {
  try {
    if (!connected || !stompClient?.connected) {
      throw new Error('WebSocket이 연결되지 않음');
    }

    console.log('관리자 사전 개입 요청 전송:', interventionMessage);
    stompClient.send('/app/proactive-intervention?roomCode='+roomCode, {});
  } catch (error) {
    console.error('관리자 사전 개입 실패:', error);
    throw error;
  }
};

/**
 * 관리자 인계 수락 (WAITING_FOR_ADMIN → ADMIN_ACTIVE)
 * @param {string} roomCode - 채팅방 코드
 * @returns {Promise<void>}
 */
const acceptHandoff = async (roomCode) => {
  try {
    if (!connected || !stompClient?.connected) {
      throw new Error('WebSocket이 연결되지 않음');
    }

    console.log('관리자 인계 수락 요청 전송:', acceptMessage);
    stompClient.send('/app/accept-handoff?roomCode='+roomCode, {});
  } catch (error) {
    console.error('관리자 인계 수락 실패:', error);
    throw error;
  }
};

// ChatWebSocketService API 내보내기
export { 
  connect, 
  authenticate, 
  joinRoom, 
  sendMessage, 
  onMessage, 
  addMessageHandler,
  leaveRoom, 
  disconnect, 
  isConnected,
  addConnectionListener,
  markAsReadViaWebSocket,
  subscribeToUnreadUpdates,
  subscribeToExpoAdminUpdates,
  subscribeToExpoChatRoomUpdates,
  requestUnreadCount,
  sendAdminMessage,
  sendReadStatusNotification,
  subscribeToUserErrors,
  // 플랫폼 AI 상담 관련 함수들
  subscribeToPlatformAdminUpdates,
  subscribeToButtonUpdates,
  requestHandoff,
  cancelHandoff,
  requestAI,
  proactiveIntervention,
  acceptHandoff
};
