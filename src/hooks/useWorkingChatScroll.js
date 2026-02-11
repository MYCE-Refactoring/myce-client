import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';

/**
 * REAL working chat scroll implementation based on Stack Overflow and StackBlitz examples
 * 
 * Based on: https://stackoverflow.com/questions/65277683/react-js-chat-when-scrolling-up-load-old-messages
 * And: https://stackblitz.com/edit/react-fnqbh9
 */
export function useWorkingChatScroll(loadMessagesFn) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  
  const containerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const currentRoomCode = useRef(null);
  const currentPage = useRef(0);
  const isFirstLoad = useRef(true);
  
  // For proper scroll position restoration (Facebook Messenger pattern)
  const previousScrollHeight = useRef(0);
  const previousScrollTop = useRef(0);
  const isLoadingOlderMessages = useRef(false);
  
  // Preloading for smoother experience
  const preloadedMessages = useRef(null);
  const isPreloading = useRef(false);

  const logUnreadSnapshot = useCallback((label, messageList) => {
    if (!Array.isArray(messageList)) {
      return;
    }

    const unreadMessages = messageList
      .filter((message) => (message?.unreadCount || 0) > 0)
      .map((message) => ({
        id: message.id || message.messageId,
        senderType: message.senderType,
        senderId: message.senderId,
        unreadCount: message.unreadCount,
        sentAt: message.sentAt,
      }));

    if (unreadMessages.length > 0) {
      console.log(`[ChatDebug] ${label} unread snapshot`, unreadMessages);
    }
  }, []);
  
  /**
   * Load initial messages (fast, instant appearance)
   */
  const loadInitialMessages = useCallback(async (roomCode) => {
    if (!roomCode || !loadMessagesFn) return [];
    const requestedRoom = roomCode;
    
    try {
      setLoading(true);
      setError(null);
      currentRoomCode.current = roomCode;
      currentPage.current = 0;
      isFirstLoad.current = true; // Mark as first load
      
      console.log('🚀 Loading initial 10 messages for instant appearance:', roomCode);
      
      // Fewer messages so viewport starts at bottom
      const response = await loadMessagesFn(roomCode, 0, 10);
      console.log('🚀 Initial message response:', response);
      const initialMessages = response.data?.content || response.data || [];
      
      if (currentRoomCode.current !== requestedRoom) {
        return initialMessages.length > 0 ? initialMessages : [];
      }

      if (initialMessages.length > 0) {
        // Sort chronologically (oldest first)
        const sortedMessages = initialMessages.sort((a, b) =>
          a.seq - b.seq
        );

        logUnreadSnapshot(`loadInitialMessages ${roomCode}`, sortedMessages);

        setMessages(sortedMessages);
        setHasMore(initialMessages.length === 10); // Has more if exactly 8
        
        // IMPORTANT: Scroll to bottom after DOM updates - multiple attempts for reliability
        setTimeout(() => {
          scrollToBottom('instant');
        }, 0);
        
        // Backup scroll - ensure it happens after CSS layout
        setTimeout(() => {
          scrollToBottom('instant');
        }, 100);
        
        // Final fallback - for slow loading scenarios
        setTimeout(() => {
          scrollToBottom('instant');
        }, 500);
      } else {
        setMessages([]);
        setHasMore(false);
        isFirstLoad.current = false;
      }
      return initialMessages.length > 0 ? initialMessages : [];
    } catch (err) {
      console.error('Failed to load initial messages:', err);
      if (currentRoomCode.current === requestedRoom) {
        setError(err.message || 'Failed to load messages');
        setMessages([]);
      }
      return [];
    } finally {
      if (currentRoomCode.current === requestedRoom) {
        setLoading(false);
      }
    }
  }, [loadMessagesFn]);
  

  /**
   * Load older messages (use preloaded if available for instant loading)
   */
  const loadOlderMessages = useCallback(async () => {
    if (!currentRoomCode.current || !loadMessagesFn || !hasMore || loadingOlder) return;
    
    try {
      setLoadingOlder(true);
      isLoadingOlderMessages.current = true;
      
      // 🎯 CRITICAL: Capture scroll position BEFORE loading messages
      const container = containerRef.current;
      if (container) {
        previousScrollHeight.current = container.scrollHeight;
        previousScrollTop.current = container.scrollTop;
        console.log('📸 Captured scroll state:', {
          scrollHeight: previousScrollHeight.current,
          scrollTop: previousScrollTop.current
        });
      }
      
      // Use preloaded messages if available (instant!)
      if (preloadedMessages.current && preloadedMessages.current.length > 0) {
        console.log('⚡ Using preloaded messages - instant!');
        const preloaded = [...preloadedMessages.current]; // Make a copy
        setMessages(prev => [...preloaded, ...prev]);
        setHasMore(preloaded.length === 5);
        currentPage.current += 1;
        preloadedMessages.current = null;
        
        // Preload next batch will be triggered by scroll handler
      } else {
        // Fall back to loading from API
        currentPage.current += 1;
        console.log('📜 Loading page', currentPage.current, 'from API...');
        
        const response = await loadMessagesFn(currentRoomCode.current, currentPage.current, 5);
        const olderMessages = response.data?.content || response.data || [];
        
        if (olderMessages.length > 0) {
          const sortedOlderMessages = olderMessages.sort((a, b) => 
            new Date(a.sentAt) - new Date(b.sentAt)
          );
          setMessages(prev => [...sortedOlderMessages, ...prev]);
          setHasMore(olderMessages.length === 5);
        } else {
          setHasMore(false);
        }
      }
      
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
      // Note: isLoadingOlderMessages.current is reset in useLayoutEffect
    }
  }, [hasMore, loadingOlder, loadMessagesFn]);
  
  /**
   * Handle scroll events (Stack Overflow approach)
   */
  // Track scroll direction for smoother loading
  const lastScrollTop = useRef(0);
  
  const handleScroll = useCallback((e) => {
    const container = e.target;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    
    // Detect scroll direction
    const isScrollingUp = scrollTop < lastScrollTop.current;
    lastScrollTop.current = scrollTop;
    
    // Only load when scrolling UP (not down) for smoother experience
    if (!isScrollingUp) return;
    
    const scrollPercentage = scrollTop / (scrollHeight - containerHeight);
    
    // Start preloading at 40% (early, in background)
    if (scrollPercentage <= 0.4 && scrollPercentage > 0.2 && hasMore && !preloadedMessages.current && !isPreloading.current) {
      console.log('🔮 At', Math.round(scrollPercentage * 100), '% - preloading next batch...');
      // Call preloadNextBatch without adding it to dependencies to avoid circular reference
      const preload = async () => {
        if (!currentRoomCode.current || !loadMessagesFn || !hasMore || isPreloading.current || preloadedMessages.current) return;
        
        try {
          isPreloading.current = true;
          const nextPage = currentPage.current + 1;
          const response = await loadMessagesFn(currentRoomCode.current, nextPage, 5);
          const messages = response.data?.content || response.data || [];
          
          if (messages.length > 0) {
            preloadedMessages.current = messages.sort((a, b) => 
              new Date(a.sentAt) - new Date(b.sentAt)
            );
            console.log('✨ Preloaded', messages.length, 'messages ready');
          }
        } catch (err) {
          console.error('Preload failed:', err);
        } finally {
          isPreloading.current = false;
        }
      };
      preload();
    }
    
    // Actually load at 20% (messages should be preloaded by now)
    if (scrollPercentage <= 0.2 && hasMore && !loadingOlder) {
      console.log('📜 At', Math.round(scrollPercentage * 100), '% - loading messages...');
      loadOlderMessages();
    }
  }, [hasMore, loadingOlder, loadOlderMessages]);
  
  /**
   * Scroll to bottom with debug logging
   */
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    } else if (containerRef.current) {
      const container = containerRef.current;
      
      // Fallback: scroll container to bottom if messagesEndRef not available
      container.scrollTop = container.scrollHeight;
      
      console.log('📍 After scroll - scrollTop:', container.scrollTop);
    } else {
      console.log('❌ No scroll target available');
    }
  }, []);
  
  /**
   * Check if user is near bottom of chat (within 100px)
   */
  const isNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      console.log('📍 isNearBottom: No container, defaulting to true');
      return true; // Default to true if container not ready
    }
    
    const threshold = 100; // pixels from bottom
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const isNear = distanceFromBottom <= threshold;
    
    
    return isNear;
  }, []);

  /**
   * Add new real-time message with smart scroll behavior
   */
  const addMessage = useCallback((newMessage) => {
    // Check if user is near bottom BEFORE adding message
    const shouldAutoScroll = isNearBottom();
    
    console.log('💬 addMessage called:', {
      messageId: newMessage.id,
      content: newMessage.content?.substring(0, 30),
      shouldAutoScroll,
      isNearBottomResult: shouldAutoScroll
    });
    
    setMessages(prev => {
      const newId = newMessage.id || newMessage.messageId;
      const newSeq =
        newMessage.seq === null || newMessage.seq === undefined
          ? null
          : String(newMessage.seq);
      const exists = prev.some(msg => {
        const existingId = msg.id || msg.messageId;
        // 1) id 일치
        if (newId && existingId && existingId === newId) {
          return true;
        }
        // 2) seq 일치
        const existingSeq =
          msg.seq === null || msg.seq === undefined ? null : String(msg.seq);
        if (newSeq && existingSeq && existingSeq === newSeq) {
          return true;
        }
        // 3) clientTemp 메시지와 서버 메시지 중복 방지:
        //    같은 senderId + 같은 content + 5초 이내 sentAt
        if (msg.clientTemp && newMessage.content && msg.content === newMessage.content) {
          if (msg.senderId != null && newMessage.senderId != null &&
              String(msg.senderId) === String(newMessage.senderId)) {
            const msgTime = msg.sentAt ? new Date(msg.sentAt).getTime() : null;
            const newTime = newMessage.sentAt ? new Date(newMessage.sentAt).getTime() : null;
            if (!msgTime || !newTime || Math.abs(msgTime - newTime) <= 5000) {
              return true;
            }
          }
        }
        return false;
      });
      if (exists) {
        console.log('⚠️ Message already exists, skipping:', newMessage.id);
        return prev;
      }
      console.log('✅ Adding new message to list');
      return [...prev, newMessage];
    });
    
    // Auto-scroll to bottom if user was near bottom
    if (shouldAutoScroll) {
      console.log('🔽 Auto-scrolling because user was near bottom');
      // Use multiple timeouts to ensure DOM and layout are ready
      setTimeout(() => {
        scrollToBottom('smooth');
      }, 0);
      
      setTimeout(() => {
        scrollToBottom('smooth');
      }, 100);
    } else {
      console.log('🚫 Not auto-scrolling - user is reading old messages');
    }
    // If user is scrolled up, don't auto-scroll (they might be reading old messages)
    // The scroll-to-bottom button will appear instead for manual scrolling
  }, [isNearBottom, scrollToBottom]);
  
  /**
   * Update existing message
   */
  const updateMessage = useCallback((messageId, updates) => {
    if (!messageId) {
      return;
    }
    console.log("[ChatDebug] updateMessage", { messageId, updates });
    setMessages(prev => 
      prev.map(msg => 
        (msg.id === messageId || msg.messageId === messageId) ? { ...msg, ...updates } : msg
      )
    );
  }, []);
  
  /**
   * 🎯 CRITICAL: Restore scroll position after messages are prepended
   * This MUST run synchronously to prevent any other code from scrolling
   */
  useLayoutEffect(() => {
    if (!isLoadingOlderMessages.current) return;
    
    const container = containerRef.current;
    if (container && previousScrollHeight.current > 0) {
      // Calculate how much the content height increased
      const heightDiff = container.scrollHeight - previousScrollHeight.current;
      
      // Restore scroll position: add the height difference to previous scroll position
      const newScrollTop = previousScrollTop.current + heightDiff;
      
      // IMMEDIATELY set scroll position - no delays, no RAF
      container.scrollTop = newScrollTop;
      
      console.log('📍 Scroll restored to:', newScrollTop, 'from:', previousScrollTop.current);
      
      // Reset tracking variables
      isLoadingOlderMessages.current = false;
      previousScrollHeight.current = 0;
      previousScrollTop.current = 0;
    }
  }, [messages]); // Trigger on messages change, not just length
  
  /**
   * Reset state
   *   - setLoadingOlder = 사용자에게 보여주기 위한 상태
   *   - isLoadingOlderMessages = 스크롤 복원/로직 제어용 내부 플래그
   */
  const reset = useCallback(() => {
    setMessages([]); // 화면의 메시지 목록
    setLoading(false); // 최초 / 일반 로딩 상태 해제 
    setLoadingOlder(false); // 스크롤 위로 올릴 때 이전 메시지 로딩 상태 해제
    setHasMore(true); // 더 불러올 메시지가 있다 플레그 ???
    setError(null); // 메시지 로딩 에러 상태 제거 
    currentRoomCode.current = null; // 현재 방 코드 초기화
    currentPage.current = 0; // 페이지 인덱스 초기화
    
    // Reset scroll position tracking
    previousScrollHeight.current = 0; // 스크롤 높이 리셋
    previousScrollTop.current = 0; // 스크롤 위치 리셋
    isLoadingOlderMessages.current = false; // 이전 메시지 로딩 중 플레그 리셋
    isFirstLoad.current = true; // 첫 로드 여부 다시 true 세팅
    
    // Reset preloading
    preloadedMessages.current = null; // 미리 로딩해둔 메시지 캐싱 삭제
    isPreloading.current = false; // 프리로드 진행 중 상태 해제
  }, []);
  
  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    error,
    containerRef,
    messagesEndRef,
    loadInitialMessages,
    handleScroll,
    scrollToBottom,
    addMessage,
    updateMessage,
    reset,
    isNearBottom
  };
}
