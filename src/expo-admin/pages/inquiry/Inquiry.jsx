import { useParams } from "react-router-dom";
import styles from "./Inquiry.module.css";
import SharedChatArea from "../../../components/shared/chat/SharedChatArea";
import SharedChatRoomList from "../../../components/shared/chat/SharedChatRoomList";
import { useExpoAdminChatController } from "../../../features/chat/controllers/useExpoAdminChatController";

function Inquiry() {
  const { expoId } = useParams();
  const {
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
    isInitialLoad,
    setNewMessage,
    loadChatRooms,
    handleRoomSelect,
    handleSendMessage,
    getRoomTitle,
    getRoomSubtitle,
    getRoomAvatar,
  } = useExpoAdminChatController(expoId);

  const renderChatHeader = () => (
    <div className={styles.defaultHeader}>
      <h3>{selectedRoom.otherMemberName || "익명"}님과의 상담</h3>
      <div className={styles.connectionStatus}>
        <span
          className={`${styles.statusDot} ${
            wsConnected ? styles.connected : styles.disconnected
          }`}
        />
        {wsConnected ? "실시간 연결됨" : "연결 끊김"}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={styles.inquiryWrapper}>
        <div className={styles.sectionTitle}>문의 내역</div>
        <div className={styles.loadingMessage}>채팅방을 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className={styles.inquiryWrapper}>
      <div className={styles.sectionTitle}>
        문의 내역
        {wsConnected && (
          <span className={styles.connectionStatus}>● 실시간 연결됨</span>
        )}
      </div>

      {error && <div className={styles.errorMessage}>{error}</div>}

      <div className={styles.chatContainer}>
        <aside className={styles.sidebar}>
          <SharedChatRoomList
            chatRooms={chatRooms}
            selectedRoom={selectedRoom}
            loading={loading}
            error={error}
            unreadCounts={{}}
            onRoomSelect={handleRoomSelect}
            onRefresh={loadChatRooms}
            title={`상담자 목록 (${chatRooms.length})`}
            emptyMessage="문의가 없습니다"
            getRoomTitle={getRoomTitle}
            getRoomSubtitle={getRoomSubtitle}
            getRoomAvatar={getRoomAvatar}
          />
        </aside>

        <section className={styles.chatArea}>
          <SharedChatArea
            messages={messages}
            loading={loadingMessages}
            loadingOlder={loadingOlder}
            hasMore={hasMore}
            isInitialLoad={isInitialLoad}
            error={messageError}
            currentUserId={currentUserId}
            currentUserType="ADMIN"
            alignBySenderType
            selectedRoom={selectedRoom}
            newMessage={newMessage}
            onMessageChange={setNewMessage}
            onSendMessage={handleSendMessage}
            placeholder="메시지를 입력해주세요"
            messagesContainerRef={messagesContainerRef}
            messagesEndRef={messagesEndRef}
            onScroll={handleScroll}
            onScrollToBottom={scrollToBottom}
            headerContent={selectedRoom ? renderChatHeader() : null}
            isConnected={wsConnected}
          />
        </section>
      </div>
    </div>
  );
}

export default Inquiry;
