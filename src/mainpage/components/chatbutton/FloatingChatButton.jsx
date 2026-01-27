import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BsFillChatDotsFill } from 'react-icons/bs';
import { jwtDecode } from 'jwt-decode';
import { getAllUnreadCounts } from '../../../api/service/chat/chatService';
import * as ChatWebSocketService from '../../../api/service/chat/ChatWebSocketService';
import ChatModal from '../../../components/shared/chat/ChatModal';
import LoginPromptModal from '../../../components/shared/chat/LoginPromptModal';

import styles from './FloatingChatButton.module.css';

export default function FloatingChatButton({ autoOpen = false }) {
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const unreadCountsRef = useRef({});
  const reconnectAttemptsRef = useRef(0);

  const POLL_INTERVAL_MS = 30000;
  const RECONNECT_RETRY_LIMIT = 3;
  const AUTH_SYNC_INTERVAL_MS = 2000;

  // Handle auto-open from navigation
  useEffect(() => {
    if (autoOpen) {
      setIsChatOpen(true);
    }
  }, [autoOpen]);

  const fetchUnreadCounts = useCallback(async () => {
    try {
      console.log('🔄 [Polling] unread-counts fetch start');
      const response = await getAllUnreadCounts();
      const counts = {};
      const list = response.data.unreadCounts || [];
      list.forEach((item) => {
        counts[item.roomCode] = item.unreadCount || 0;
      });
      unreadCountsRef.current = counts;
      const total =
        typeof response.data.totalUnreadCount === 'number'
          ? response.data.totalUnreadCount
          : Object.values(counts).reduce((sum, value) => sum + value, 0);
      setTotalUnreadCount(total);
      console.log('✅ [Polling] unread-counts fetch success', {
        total,
        rooms: Object.keys(counts).length,
      });
    } catch (error) {
      console.error('전체 읽지 않은 메시지 개수 조회 실패:', error);
      if (error.response?.status === 401) {
        setIsAuthenticated(false);
        setTotalUnreadCount(0);
        unreadCountsRef.current = {};
        ChatWebSocketService.disconnect();
        localStorage.removeItem('access_token');
      }
    }
  }, []);

  const connectWebSocket = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      return false;
    }

    try {
      if (ChatWebSocketService.isConnected()) {
        return true;
      }
      const decoded = jwtDecode(token);
      await ChatWebSocketService.connect(token, decoded.memberId);
      return true;
    } catch (error) {
      return false;
    }
  }, []);

  // Check authentication and load data once
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const authenticated = !!token;
    setIsAuthenticated(authenticated);
    if (!authenticated) {
      setTotalUnreadCount(0);
      unreadCountsRef.current = {};
      setPollingEnabled(false);
      setWsConnected(false);
      ChatWebSocketService.disconnect();
      return;
    }

    fetchUnreadCounts();
    if (isChatOpen) {
      connectWebSocket();
    } else if (ChatWebSocketService.isConnected()) {
      ChatWebSocketService.disconnect();
    }
  }, [fetchUnreadCounts, connectWebSocket, isChatOpen]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const token = localStorage.getItem('access_token');
      const authenticated = !!token;

      if (authenticated && !isAuthenticated) {
        setIsAuthenticated(true);
        fetchUnreadCounts();
        if (isChatOpen) {
          connectWebSocket();
        } else if (ChatWebSocketService.isConnected()) {
          ChatWebSocketService.disconnect();
        }
      } else if (!authenticated && isAuthenticated) {
        setIsAuthenticated(false);
        setTotalUnreadCount(0);
        unreadCountsRef.current = {};
        setPollingEnabled(false);
        setWsConnected(false);
        ChatWebSocketService.disconnect();
      }
    }, AUTH_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isAuthenticated, fetchUnreadCounts, connectWebSocket]);

  useEffect(() => {
    const removeListener = ChatWebSocketService.addConnectionListener(
      (nextConnected) => {
        setWsConnected(nextConnected);
        if (nextConnected) {
          reconnectAttemptsRef.current = 0;
        }
      }
    );

    setWsConnected(ChatWebSocketService.isConnected());

    return () => {
      removeListener();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setPollingEnabled(false);
      console.log('🛑 [Polling] disabled (not authenticated)');
      return;
    }
    setPollingEnabled(!wsConnected);
    console.log('🔁 [Polling] wsConnected changed', {
      wsConnected,
      pollingEnabled: !wsConnected,
    });
  }, [isAuthenticated, wsConnected]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleResume = () => {
      if (!ChatWebSocketService.isConnected()) {
        if (isChatOpen) {
          connectWebSocket();
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAuthenticated, connectWebSocket]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isChatOpen) return;
    if (wsConnected) return;

    const intervalId = setInterval(async () => {
      if (ChatWebSocketService.isConnected()) {
        return;
      }
      const success = await connectWebSocket();
      if (!success) {
        reconnectAttemptsRef.current += 1;
        if (reconnectAttemptsRef.current >= RECONNECT_RETRY_LIMIT) {
          setPollingEnabled(true);
        }
      } else {
        reconnectAttemptsRef.current = 0;
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isAuthenticated, wsConnected, connectWebSocket]);

  useEffect(() => {
    if (!isAuthenticated || !pollingEnabled) return;

    console.log('▶️ [Polling] start interval', { intervalMs: POLL_INTERVAL_MS });
    fetchUnreadCounts();
    const intervalId = setInterval(() => {
      console.log('⏱️ [Polling] tick');
      fetchUnreadCounts();
    }, POLL_INTERVAL_MS);

    return () => {
      console.log('⏹️ [Polling] stop interval');
      clearInterval(intervalId);
    };
  }, [isAuthenticated, pollingEnabled, fetchUnreadCounts]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubscribeUnread = ChatWebSocketService.subscribeToGlobalUnreadUpdates(
      (unreadData) => {
        const payload = unreadData.payload || unreadData;
        const readerType = payload?.readerType || payload?.messageReaderType;
        if (readerType && readerType !== 'USER') {
          return;
        }
        const roomCode = payload?.roomCode || unreadData?.roomCode;
        const unreadCount =
          typeof payload?.unreadCount === 'number'
            ? payload.unreadCount
            : typeof payload?.unReadCount === 'number'
            ? payload.unReadCount
            : null;

        if (!roomCode || typeof unreadCount !== 'number') {
          return;
        }

        const prevCount = unreadCountsRef.current[roomCode] || 0;
        if (prevCount === unreadCount) {
          return;
        }

        unreadCountsRef.current = {
          ...unreadCountsRef.current,
          [roomCode]: unreadCount,
        };

        setTotalUnreadCount((prev) => {
          const next = prev - prevCount + unreadCount;
          return next < 0 ? 0 : next;
        });
      }
    );

    return () => {
      if (typeof unsubscribeUnread === 'function') {
        unsubscribeUnread();
      }
    };
  }, [isAuthenticated]);

  const handleChatClick = () => {
    setIsChatOpen(true);
  };

  const handleChatClose = () => {
    setIsChatOpen(false);
    if (ChatWebSocketService.isConnected()) {
      ChatWebSocketService.disconnect();
    }
    setPollingEnabled(true);
    fetchUnreadCounts();
  };

  return (
    <>
      <button 
        onClick={handleChatClick} 
        className={`${styles.fab} ${styles.loginHint}`}
        title={isAuthenticated ? "상담 채팅 열기" : "로그인 후 상담 서비스를 이용하세요"}
      >
        <span className={styles.icon}>
          <BsFillChatDotsFill size={22} />
        </span>
        {isAuthenticated && totalUnreadCount > 0 && (
          <span className={styles.badge}>{totalUnreadCount}</span>
        )}
      </button>
      
      {/* Show different modals based on authentication */}
      {isAuthenticated ? (
        <ChatModal 
          isOpen={isChatOpen} 
          onClose={handleChatClose}
        />
      ) : (
        <LoginPromptModal 
          isOpen={isChatOpen} 
          onClose={handleChatClose}
        />
      )}
    </>
  );
}
